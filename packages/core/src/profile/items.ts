// The link page's blocks (spec 0051, built as blocks): a person's one ordered list at `/<handle>`, kept with their
// account in schema auth (migration 0098), out of the app role's reach. These are its only ways there, each one of
// crm_handle's definers, run inside the caller's workspace transaction with the session's own user id: no input names
// the owner, so no role in any workspace reaches another person's page. A booking page block names a page by its
// workspace and id; which of the person's pages it may name, and what the editor shows of one, comes through the
// door (`enterOwnPages`), each read as the page's read only `booking` actor in its own workspace.
//
// No audit row: the blocks are the person's, not the workspace's, and a workspace's history is read by its admins.
// (The identity login keeps the default grant every auth table gets; the app reaches the table only through here.)
import {
  HUES,
  PAGE_THEME_REFUSAL,
  PageTheme,
  ProfileBlock,
  ProfileItem,
  profileLimitSentence,
  PROFILE_COUNT_DAYS,
  type ProfileCounts,
  type ProfileItems,
  type ProfileFormChoice,
  type ProfileFormFacts,
  type ProfilePageChoice,
  type ProfilePageFacts,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { enterOwnForms, enterOwnPages, ownUserId, type OwnedFormEntry, type OwnedPageEntry } from '../access/door.ts';
import { isUuid } from '../engine/ids.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';

const { bookingPages, forms, workspaces } = schema;

/** One block as the editor's definers answer it. */
interface ItemRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: string;
  readonly position: number | null;
  readonly data: unknown;
  readonly workspace_id: string | null;
  readonly page_id: string | null;
  readonly form_id: string | null;
  readonly archived_at: string | Date | null;
  readonly updated_at: string | Date;
}

/** The columns every definer here answers, as text where the api wants text. */
const ITEM_COLUMNS = sql.raw(
  `id::text as id, kind, position, data, workspace_id::text as workspace_id, page_id::text as page_id, form_id::text as form_id, archived_at, updated_at`,
);

/** The caller's identity, which their link page belongs to; a member made without one has none. */
function ownerOf(scope: EngineScope): string {
  return ownUserId(scope);
}

function iso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** What a page block's page shows in the editor, by page id. */
type FactsByPage = ReadonlyMap<string, { readonly workspaceId: string; readonly facts: ProfilePageFacts }>;

/** What a form block's form shows in the editor, by form id. */
type FactsByForm = ReadonlyMap<string, { readonly workspaceId: string; readonly facts: ProfileFormFacts }>;

/** Both, read together: one block list may hold pages and forms from several workspaces. */
interface BlockFacts {
  readonly pages: FactsByPage;
  readonly forms: FactsByForm;
}

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
        .select({ name: workspaces.name, slug: workspaces.slug })
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
            workspaceSlug: workspace.slug,
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
/**
 * Each form's facts for the editor, read inside its own workspace through the entry the door minted: the form's
 * name as its workspace lists it, its public key, and the workspace's own name and address. A form the read can't
 * see has no facts, and its block says Unavailable rather than disappearing (AC-5214).
 */
async function formFactsOf(entries: readonly OwnedFormEntry[]): Promise<FactsByForm> {
  const byWorkspace = new Map<string, OwnedFormEntry[]>();
  for (const entry of entries) {
    const group = byWorkspace.get(entry.scope.workspaceId) ?? [];
    group.push(entry);
    byWorkspace.set(entry.scope.workspaceId, group);
  }
  const facts = new Map<string, { readonly workspaceId: string; readonly facts: ProfileFormFacts }>();
  for (const [workspaceId, group] of byWorkspace) {
    const [first] = group;
    if (first === undefined) continue;
    const live = new Map(group.map((entry) => [entry.formId, entry.isLive]));
    const keys = new Map(group.map((entry) => [entry.formId, entry.key]));
    await inWorkspace(first.scope, async (tx) => {
      const [workspace] = await tx
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
      if (workspace === undefined) return;
      const rows = await tx
        .select({ id: forms.id, name: forms.name })
        .from(forms)
        .where(
          and(
            inArray(
              forms.id,
              group.map((entry) => entry.formId),
            ),
            isNull(forms.archivedAt),
          ),
        );
      for (const row of rows) {
        const key = keys.get(row.id);
        if (key === undefined) continue;
        facts.set(row.id, {
          workspaceId,
          facts: {
            name: row.name,
            key,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
            status: live.get(row.id) === true ? 'live' : 'paused',
          },
        });
      }
    });
  }
  return facts;
}

function itemOf(row: ItemRow, facts: BlockFacts): ProfileItem | undefined {
  const data = typeof row.data === 'object' && row.data !== null ? row.data : {};
  const stored = {
    id: row.id,
    updatedAt: iso(row.updated_at),
    ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }),
  };
  let candidate: unknown;
  if (row.kind === 'page') {
    const found = row.page_id === null ? undefined : facts.pages.get(row.page_id);
    candidate = {
      kind: 'page',
      workspaceId: row.workspace_id,
      pageId: row.page_id,
      ...stored,
      ...(found === undefined || found.workspaceId !== row.workspace_id ? {} : { page: found.facts }),
    };
  } else if (row.kind === 'form') {
    const found = row.form_id === null ? undefined : facts.forms.get(row.form_id);
    candidate = {
      ...data,
      kind: 'form',
      workspaceId: row.workspace_id,
      formId: row.form_id,
      ...stored,
      ...(found === undefined || found.workspaceId !== row.workspace_id ? {} : { form: found.facts }),
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
async function factsForRows(scope: EngineScope, rows: readonly ItemRow[]): Promise<BlockFacts> {
  const pageIds = rows.flatMap((row) => (row.kind === 'page' && row.page_id !== null ? [row.page_id] : []));
  const formIds = rows.flatMap((row) => (row.kind === 'form' && row.form_id !== null ? [row.form_id] : []));
  return {
    pages: pageIds.length === 0 ? new Map() : await factsOf(await enterOwnPages(scope, pageIds)),
    forms: formIds.length === 0 ? new Map() : await formFactsOf(await enterOwnForms(scope, formIds)),
  };
}

/** Both lists, read in one transaction, with their pages' facts. */
async function readAll(scope: EngineScope, owner: string): Promise<ProfileItems> {
  const [live, archived] = await inWorkspace(scope, async (tx) => [
    await readRows(tx, owner, false),
    await readRows(tx, owner, true),
  ]);
  const facts = await factsForRows(scope, [...live, ...archived]);
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
  const entries = (await enterOwnPages(scope)).filter((entry) => !placed.has(entry.pageId));
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

/**
 * The forms the caller may place on their link page (spec 0052, AC-5213): their own, as the door names them, less
 * the ones already on the page, by workspace then name. The same shape and the same rule as the booking pages'.
 */
export async function listProfileFormChoices(scope: EngineScope): Promise<readonly ProfileFormChoice[]> {
  const owner = ownerOf(scope);
  const live = await inWorkspace(scope, (tx) => readRows(tx, owner, false));
  const placed = new Set(live.flatMap((row) => (row.kind === 'form' && row.form_id !== null ? [row.form_id] : [])));
  const entries = (await enterOwnForms(scope)).filter((entry) => !placed.has(entry.formId));
  const facts = await formFactsOf(entries);
  return [...facts]
    .map(([formId, found]) => ({ workspaceId: found.workspaceId, formId, facts: found.facts }))
    .sort(
      (left, right) =>
        left.facts.workspaceName.localeCompare(right.facts.workspaceName) ||
        left.facts.name.localeCompare(right.facts.name) ||
        (left.formId < right.formId ? -1 : 1),
    );
}

/**
 * Replaces the look of the caller's own link page (spec 0054, AC-5401), whole. The six names are checked here too,
 * so a caller in core gets the contract's refusal, and the column's own check constraint refuses anything that got
 * past both. A person with no profile row has no handle either, so there is nothing to theme.
 */
export async function saveProfileTheme(scope: EngineScope, theme: PageTheme): Promise<PageTheme> {
  const owner = ownerOf(scope);
  const parsed = PageTheme.safeParse(theme);
  if (!parsed.success) throw refuse('CONFIG_INVALID', PAGE_THEME_REFUSAL);
  const saved = await inWorkspace(scope, async (tx) => {
    try {
      const answered = await tx.execute<{ theme: unknown }>(
        sql`select theme from crm_save_profile_theme(${owner}::uuid, ${JSON.stringify(parsed.data)}::jsonb) as theme`,
      );
      return answered.rows[0]?.theme;
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'Pick a handle before you choose a look.');
      if (pg?.code === '23514') throw refuse('CONFIG_INVALID', PAGE_THEME_REFUSAL);
      throw error;
    }
  });
  return PageTheme.safeParse(saved).data ?? parsed.data;
}

/**
 * Whether search engines may show the caller's own link page (spec 0055, AC-5506). One column, written through the
 * one definer; a person with no profile row has no handle either, so there is no page for anyone to show.
 */
export async function setProfileIndexable(scope: EngineScope, indexable: boolean): Promise<{ indexable: boolean }> {
  const owner = ownerOf(scope);
  const kept = await inWorkspace(scope, async (tx) => {
    try {
      const answered = await tx.execute<{ indexable: boolean }>(
        sql`select crm_save_profile_indexable(${owner}::uuid, ${indexable}) as indexable`,
      );
      return answered.rows[0]?.indexable;
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'Pick a handle before you choose this.');
      throw error;
    }
  });
  return { indexable: kept ?? indexable };
}

/** A refusal for what a definer raised, or the error itself. */
function refusalOf(error: unknown): unknown {
  const pg = postgresError(error);
  if (pg === undefined) return error;
  if (pg.code === '54000') {
    const kind = (['link', 'heading', 'page', 'contact', 'text', 'faq', 'form', 'testimonial'] as const).find(
      (each) => each === pg.detail,
    );
    return refuse('LIMIT_REACHED', profileLimitSentence(kind ?? 'items'));
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_heading_once') {
    return refuseOn('CONFIG_INVALID', 'You already have a heading called that.', 'title');
  }
  // One live contact card (AC-5102): a second, or one restored beside another, is refused as the limit it is.
  if (pg.code === '23505' && pg.constraint === 'profile_items_contact_once') {
    return refuse('LIMIT_REACHED', profileLimitSentence('contact'));
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_page_once') {
    return refuse('CONFIG_INVALID', 'That booking page is on your link page already.');
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_form_once') {
    return refuse('CONFIG_INVALID', 'That form is on your link page already.');
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

/** A block's fields as the definer stores them: its kind, its data, and the page or form it names, if any. */
function storedOf(block: ProfileBlock, hue: (typeof HUES)[number]) {
  if (block.kind === 'page') {
    return { kind: block.kind, data: {}, workspaceId: block.workspaceId, pageId: block.pageId, formId: null };
  }
  if (block.kind === 'form') {
    return {
      kind: block.kind,
      data: { label: block.label },
      workspaceId: block.workspaceId,
      pageId: null,
      formId: block.formId,
    };
  }
  if (block.kind === 'heading') {
    // `open` is the page's own heading, so it is left out rather than stored: one shape for every heading written
    // before folders and every one written since (AC-5415).
    return {
      kind: block.kind,
      data: { title: block.title, ...(block.group === 'folder' ? { group: 'folder' } : {}) },
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
  if (block.kind === 'contact') {
    // The card's fields as the schema kept them: an empty one was refused there, never stored.
    const { kind, ...data } = block;
    return { kind, data, workspaceId: null, pageId: null, formId: null };
  }
  if (block.kind === 'testimonial') {
    return {
      kind: block.kind,
      data: {
        quote: block.quote,
        author: block.author,
        ...(block.role === undefined || block.role === '' ? {} : { role: block.role }),
      },
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
  if (block.kind === 'faq') {
    return {
      kind: block.kind,
      data: {
        items: block.items,
        ...(block.title === undefined || block.title === '' ? {} : { title: block.title }),
      },
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
  if (block.kind === 'text') {
    return {
      kind: block.kind,
      data: { body: block.body, ...(block.title === undefined || block.title === '' ? {} : { title: block.title }) },
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
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
    formId: null,
  };
}

/**
 * Adds or edits one block of the caller's link page (AC-5101 to AC-5107), idempotent on `id`: the same add again
 * answers the block already made. The fields are checked against their kind's schema here too, so a caller in core
 * gets the contract's refusals; a booking page must be one the caller may place (`enterOwnPages`). A new block goes
 * at the end. Past a limit, `LIMIT_REACHED` with the limit's sentence; a repeated heading, or a page already there,
 * `CONFIG_INVALID`; another person's id, `NOT_FOUND`.
 */
export async function saveProfileItem(
  scope: EngineScope,
  input: { readonly id: string; readonly block: ProfileBlock; readonly isEdit?: boolean },
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
    const [entry] = await enterOwnPages(scope, [block.pageId]);
    if (entry?.scope.workspaceId !== block.workspaceId) {
      throw refuse('NOT_FOUND', 'That booking page can’t go on your link page.');
    }
  }
  if (block.kind === 'form') {
    const [entry] = await enterOwnForms(scope, [block.formId]);
    if (entry?.scope.workspaceId !== block.workspaceId) {
      throw refuse('NOT_FOUND', 'That form can’t go on your link page.');
    }
  }
  const row = await inWorkspace(scope, async (tx) => {
    // The live blocks only when they are needed: an edit's existence, or a new link's colour.
    const needsRows = input.isEdit === true || (block.kind === 'link' && block.hue === undefined);
    const live = needsRows ? await readRows(tx, owner, false) : [];
    if (input.isEdit === true && !live.some((each) => each.id === input.id)) {
      const archived = await readRows(tx, owner, true);
      if (!archived.some((each) => each.id === input.id)) {
        throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
      }
    }
    const stored = storedOf(block, nextHue(live.filter((each) => each.kind === 'link').length));
    try {
      const saved = await tx.execute<ItemRow>(
        sql`select ${ITEM_COLUMNS} from crm_save_profile_item(${owner}::uuid, ${input.id}::uuid, ${stored.kind}, ${JSON.stringify(stored.data)}::jsonb, ${stored.workspaceId}::uuid, ${stored.pageId}::uuid, ${stored.formId}::uuid)`,
      );
      return saved.rows[0];
    } catch (error) {
      throw refusalOf(error);
    }
  });
  if (row === undefined) throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  const item = itemOf(row, await factsForRows(scope, [row]));
  if (item === undefined) throw new Error('A saved block read back as nothing.');
  return item;
}

/**
 * Sets the caller's whole order at once (AC-5116): `ids` must be exactly their live blocks, each once. An order from
 * a tab that missed a change is `CONFIG_INVALID`, and the editor puts its rows back. Answers both lists.
 */
export async function orderProfileItems(scope: EngineScope, ids: readonly string[]): Promise<ProfileItems> {
  const owner = ownerOf(scope);
  if (ids.length === 0 || !ids.every((id) => isUuid(id))) {
    throw refuse('CONFIG_INVALID', 'Your link page changed somewhere else. It now shows the latest order.');
  }
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

/**
 * Puts a booking page at the end of its owner's link page as it is made Public (created so, or changed from Link
 * only), as the profile always did with a new page (`crm_place_profile_page`): once, never when a block of theirs
 * already names it (they took it off on purpose), and silently not past a limit. Only for the caller's own page, in
 * the page write's own transaction; a member made without a sign in has no link page.
 */
export async function placeNewPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  page: { readonly id: string; readonly ownerMemberId: string },
): Promise<void> {
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.userId === undefined) return;
  if (principal.memberId !== page.ownerMemberId) return;
  await tx.execute(
    sql`select crm_place_profile_page(${principal.userId}::uuid, ${scope.workspaceId}::uuid, ${page.id}::uuid)`,
  );
}

/** A UTC day `back` days before `day`, `YYYY-MM-DD`. */
function dayBefore(day: string, back: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
}

interface CountRow extends Record<string, unknown> {
  readonly item_id: string | null;
  readonly presses: string | number | null;
  readonly views: string | number | null;
  readonly visitors: string | number | null;
}

/** One period's rows from `crm_profile_counts`. */
async function countsIn(tx: WorkspaceTx, owner: string, from: string, to: string): Promise<readonly CountRow[]> {
  const found = await tx.execute<CountRow>(
    sql`select item_id::text as item_id, presses, views, visitors from crm_profile_counts(${owner}::uuid, ${from}::date, ${to}::date)`,
  );
  return found.rows;
}

/**
 * The caller's link page figures (spec 0051, AC-5127): over the last 30 UTC days, today included, the page's views
 * and visitors, the 30 days before them as the comparison, and each live block's presses. Their own only: the owner
 * is the session's identity. Reads two periods in one transaction; writes nothing.
 */
export async function readProfileCounts(scope: EngineScope, now: Date = new Date()): Promise<ProfileCounts> {
  const owner = ownerOf(scope);
  const days = PROFILE_COUNT_DAYS;
  const today = now.toISOString().slice(0, 10);
  const from = dayBefore(today, days - 1);
  const [current, before] = await inWorkspace(scope, async (tx) => [
    await countsIn(tx, owner, from, today),
    await countsIn(tx, owner, dayBefore(from, days), dayBefore(from, 1)),
  ]);
  const traffic = (rows: readonly CountRow[]) => {
    const row = rows.find((each) => each.item_id === null);
    return { views: Number(row?.views ?? 0), visitors: Number(row?.visitors ?? 0) };
  };
  return {
    days,
    ...traffic(current),
    before: traffic(before),
    presses: current.flatMap((row) =>
      row.item_id === null || Number(row.presses ?? 0) < 1 ? [] : [{ id: row.item_id, presses: Number(row.presses) }],
    ),
  };
}
