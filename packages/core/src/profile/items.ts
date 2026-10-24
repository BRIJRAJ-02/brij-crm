// The link page's blocks (spec 0051, built as blocks): a person's one ordered list at `/<handle>`, kept with their
// account in schema auth (migration 0096), out of the app role's reach. These are its only ways there, each one of
// crm_handle's definers, run inside the caller's workspace transaction with the session's own user id: no input names
// the owner, so no role in any workspace reaches another person's page. A booking page block names a page by its
// workspace and id; which of the person's pages it may name, and what the editor shows of one, comes through the
// door (`enterOwnedPages`), each read as the page's read only `booking` actor in its own workspace.
//
// No audit row: the blocks are the person's, not the workspace's, and a workspace's history is read by its admins.
import {
  HUES,
  ProfileBlock,
  ProfileItem,
  profileLimitSentence,
  type ProfileItems,
  type ProfilePageChoice,
  type ProfilePageFacts,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { enterOwnedPages, type OwnedPageEntry } from '../access/door.ts';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';

const { bookingPages, workspaces } = schema;

/** One block as the editor's definers answer it. */
interface ItemRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: string;
  readonly position: number | null;
  readonly data: unknown;
  readonly workspace_id: string | null;
  readonly page_id: string | null;
  readonly archived_at: string | Date | null;
  readonly updated_at: string | Date;
}

/** The columns every definer here answers, as text where the api wants text. */
const ITEM_COLUMNS = sql.raw(
  `id::text as id, kind, position, data, workspace_id::text as workspace_id, page_id::text as page_id, archived_at, updated_at`,
);

/** The caller's identity, which their link page belongs to; a member made without one has none. */
function ownerOf(scope: EngineScope): string {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.userId === undefined) {
    throw refuse('FORBIDDEN', 'Only a signed in person has a link page.');
  }
  return principal.userId;
}

function iso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** What a page block's page shows in the editor, by page id. */
type FactsByPage = ReadonlyMap<string, { readonly workspaceId: string; readonly facts: ProfilePageFacts }>;

/**
 * The facts of the booking pages `entries` name, each workspace's read in one transaction under its first entry's
 * read only scope, and listed again there under row level security: a page made Link only or deleted since the
 * door's definer chose it is left out.
 */
async function factsOf(entries: readonly OwnedPageEntry[]): Promise<FactsByPage> {
  const byWorkspace = new Map<string, OwnedPageEntry[]>();
  for (const entry of entries) {
    const group = byWorkspace.get(entry.scope.workspaceId) ?? [];
    group.push(entry);
    byWorkspace.set(entry.scope.workspaceId, group);
  }
  const facts = new Map<string, { readonly workspaceId: string; readonly facts: ProfilePageFacts }>();
  for (const [workspaceId, group] of byWorkspace) {
    const [first] = group;
    if (first === undefined) continue;
    const live = new Map(group.map((entry) => [entry.pageId, entry.isLive]));
    await inWorkspace(first.scope, async (tx) => {
      const [workspace] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
      if (workspace === undefined) return;
      const rows = await tx
        .select({
          id: bookingPages.id,
          slug: bookingPages.slug,
          title: bookingPages.title,
          durations: bookingPages.durations,
          kind: bookingPages.kind,
          status: bookingPages.status,
        })
        .from(bookingPages)
        .where(
          and(
            inArray(
              bookingPages.id,
              group.map((entry) => entry.pageId),
            ),
            isNull(bookingPages.deletedAt),
            eq(bookingPages.isPrivate, false),
          ),
        );
      for (const row of rows) {
        facts.set(row.id, {
          workspaceId,
          facts: {
            title: row.title,
            slug: row.slug,
            durations: row.durations,
            isTeam: row.kind === 'round_robin',
            workspaceName: workspace.name,
            status: live.get(row.id) === true && row.status === 'live' ? 'live' : 'paused',
          },
        });
      }
    });
  }
  return facts;
}

/**
 * A stored block as the editor reads it, or undefined for a kind this build doesn't know or data its schema no
 * longer accepts: skipped, never a crash. A link always carries a hue (the oldest rows may lack one).
 */
function itemOf(row: ItemRow, facts: FactsByPage): ProfileItem | undefined {
  const data = typeof row.data === 'object' && row.data !== null ? row.data : {};
  const stored = {
    id: row.id,
    updatedAt: iso(row.updated_at),
    ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }),
  };
  let candidate: unknown;
  if (row.kind === 'page') {
    const found = row.page_id === null ? undefined : facts.get(row.page_id);
    candidate = {
      kind: 'page',
      workspaceId: row.workspace_id,
      pageId: row.page_id,
      ...stored,
      ...(found === undefined || found.workspaceId !== row.workspace_id ? {} : { page: found.facts }),
    };
  } else if (row.kind === 'link') {
    candidate = { hue: 'blue', ...data, kind: 'link', ...stored };
  } else {
    candidate = { ...data, kind: row.kind, ...stored };
  }
  const parsed = ProfileItem.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function readRows(tx: WorkspaceTx, owner: string, archived: boolean): Promise<readonly ItemRow[]> {
  const found = await tx.execute<ItemRow>(
    archived
      ? sql`select ${ITEM_COLUMNS} from crm_profile_items_archived(${owner}::uuid)`
      : sql`select ${ITEM_COLUMNS} from crm_profile_items(${owner}::uuid)`,
  );
  return found.rows;
}

/** The facts of every booking page the rows name, as the door lets the owner place them now. */
async function factsForRows(db: Database, owner: string, rows: readonly ItemRow[]): Promise<FactsByPage> {
  const pageIds = rows.flatMap((row) => (row.kind === 'page' && row.page_id !== null ? [row.page_id] : []));
  if (pageIds.length === 0) return new Map();
  return factsOf(await enterOwnedPages({ db }, owner, pageIds));
}

/** Both lists, read in one transaction, with their pages' facts. */
async function readAll(scope: EngineScope, owner: string): Promise<ProfileItems> {
  const [live, archived] = await inWorkspace(scope, async (tx) => [
    await readRows(tx, owner, false),
    await readRows(tx, owner, true),
  ]);
  const facts = await factsForRows(scope.db, owner, [...live, ...archived]);
  const items = (rows: readonly ItemRow[]) =>
    rows.flatMap((row) => {
      const item = itemOf(row, facts);
      return item === undefined ? [] : [item];
    });
  return { items: items(live), archived: items(archived) };
}

/** The caller's link page: its live blocks in order, and its archived ones, newest first (the editor's read). */
export async function readProfileItems(scope: EngineScope): Promise<ProfileItems> {
  return readAll(scope, ownerOf(scope));
}

/**
 * The booking pages the caller may still place (AC-5117): their Public pages in every workspace they are an active
 * member of, live or paused, without the ones a live block holds already, by workspace then title.
 */
export async function listProfilePageChoices(scope: EngineScope): Promise<readonly ProfilePageChoice[]> {
  const owner = ownerOf(scope);
  const live = await inWorkspace(scope, (tx) => readRows(tx, owner, false));
  const placed = new Set(live.flatMap((row) => (row.kind === 'page' && row.page_id !== null ? [row.page_id] : [])));
  const entries = (await enterOwnedPages({ db: scope.db }, owner)).filter((entry) => !placed.has(entry.pageId));
  const facts = await factsOf(entries);
  return [...facts]
    .map(([pageId, found]) => ({ workspaceId: found.workspaceId, pageId, facts: found.facts }))
    .sort(
      (left, right) =>
        left.facts.workspaceName.localeCompare(right.facts.workspaceName) ||
        left.facts.title.localeCompare(right.facts.title) ||
        (left.pageId < right.pageId ? -1 : 1),
    );
}

/** A refusal for what a definer raised, or the error itself. */
function refusalOf(error: unknown): unknown {
  const pg = postgresError(error);
  if (pg === undefined) return error;
  if (pg.code === '54000') {
    const kind = (['link', 'heading', 'page'] as const).find((each) => each === pg.detail);
    return refuse('LIMIT_REACHED', profileLimitSentence(kind ?? 'items'));
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_heading_once') {
    return refuseOn('CONFIG_INVALID', 'You already have a heading called that.', 'title');
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_page_once') {
    return refuse('CONFIG_INVALID', 'That booking page is on your link page already.');
  }
  if (pg.code === 'P0002') return refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  if (pg.code === '22023') return refuse('CONFIG_INVALID', 'That block can’t be saved as it is.');
  return error;
}

/** The hue a new link's letter takes: the next of the nine after the person's links so far, gray last. */
function nextHue(links: number): (typeof HUES)[number] {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[links % ring.length] ?? 'blue';
}

/** A block's fields as the definer stores them: its kind, its data, and the page it names, if any. */
function storedOf(block: ProfileBlock, hue: (typeof HUES)[number]) {
  if (block.kind === 'page') {
    return { kind: block.kind, data: {}, workspaceId: block.workspaceId, pageId: block.pageId };
  }
  if (block.kind === 'heading')
    return { kind: block.kind, data: { title: block.title }, workspaceId: null, pageId: null };
  return {
    kind: block.kind,
    data: {
      title: block.title,
      url: block.url,
      ...(block.note === undefined || block.note === '' ? {} : { note: block.note }),
      ...(block.icon === undefined ? {} : { icon: block.icon }),
      hue: block.hue ?? hue,
    },
    workspaceId: null,
    pageId: null,
  };
}

/**
 * Adds or edits one block of the caller's link page (AC-5101 to AC-5107), idempotent on `id`: the same add again
 * answers the block already made. The fields are checked against their kind's schema here too, so a caller in core
 * gets the contract's refusals; a booking page must be one the caller may place (`enterOwnedPages`). A new block goes
 * at the end. Past a limit, `LIMIT_REACHED` with the limit's sentence; a repeated heading, or a page already there,
 * `CONFIG_INVALID`; another person's id, `NOT_FOUND`.
 */
export async function saveProfileItem(
  scope: EngineScope,
  input: { readonly id: string; readonly block: ProfileBlock },
): Promise<ProfileItem> {
  const owner = ownerOf(scope);
  const parsed = ProfileBlock.safeParse(input.block);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === 'string' ? issue.path[0] : undefined;
    const message = issue?.message ?? 'That block can’t be saved as it is.';
    throw field === undefined ? refuse('CONFIG_INVALID', message) : refuseOn('CONFIG_INVALID', message, field);
  }
  const block = parsed.data;
  if (block.kind === 'page') {
    const [entry] = await enterOwnedPages({ db: scope.db }, owner, [block.pageId]);
    if (entry?.scope.workspaceId !== block.workspaceId) {
      throw refuse('NOT_FOUND', 'That booking page can’t go on your link page.');
    }
  }
  const row = await inWorkspace(scope, async (tx) => {
    const live = await readRows(tx, owner, false);
    const stored = storedOf(block, nextHue(live.filter((each) => each.kind === 'link').length));
    try {
      const saved = await tx.execute<ItemRow>(
        sql`select ${ITEM_COLUMNS} from crm_save_profile_item(${owner}::uuid, ${input.id}::uuid, ${stored.kind}, ${JSON.stringify(stored.data)}::jsonb, ${stored.workspaceId}::uuid, ${stored.pageId}::uuid)`,
      );
      return saved.rows[0];
    } catch (error) {
      throw refusalOf(error);
    }
  });
  if (row === undefined) throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  const item = itemOf(row, await factsForRows(scope.db, owner, [row]));
  if (item === undefined) throw new Error('A saved block read back as nothing.');
  return item;
}

/**
 * Sets the caller's whole order at once (AC-5116): `ids` must be exactly their live blocks, each once. An order from
 * a tab that missed a change is `CONFIG_INVALID`, and the editor puts its rows back. Answers both lists.
 */
export async function orderProfileItems(scope: EngineScope, ids: readonly string[]): Promise<ProfileItems> {
  const owner = ownerOf(scope);
  await inWorkspace(scope, async (tx) => {
    try {
      await tx.execute(sql`select crm_order_profile_items(${owner}::uuid, ${`{${ids.join(',')}}`}::uuid[])`);
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '22023') {
        throw refuse('CONFIG_INVALID', 'Your link page changed somewhere else. It now shows the latest order.');
      }
      throw refusalOf(error);
    }
  });
  return readAll(scope, owner);
}

/**
 * Archives one block (it leaves the public page at once and keeps everything it held), or restores it to the end
 * under an add's limits and rules (AC-5106). Archiving a heading archives nothing under it. Answers both lists.
 */
export async function archiveProfileItem(
  scope: EngineScope,
  input: { readonly id: string; readonly archived: boolean },
): Promise<ProfileItems> {
  const owner = ownerOf(scope);
  const found = await inWorkspace(scope, async (tx) => {
    try {
      const answer = await tx.execute<{ found: boolean }>(
        sql`select crm_archive_profile_item(${owner}::uuid, ${input.id}::uuid, ${input.archived}) as found`,
      );
      return answer.rows[0]?.found === true;
    } catch (error) {
      throw refusalOf(error);
    }
  });
  if (!found) throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  return readAll(scope, owner);
}

/** Deletes one block for good (AC-5106; the editor asks first). */
export async function deleteProfileItem(scope: EngineScope, id: string): Promise<{ readonly id: string }> {
  const owner = ownerOf(scope);
  const found = await inWorkspace(scope, async (tx) => {
    const answer = await tx.execute<{ found: boolean }>(
      sql`select crm_delete_profile_item(${owner}::uuid, ${id}::uuid) as found`,
    );
    return answer.rows[0]?.found === true;
  });
  if (!found) throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  return { id };
}
