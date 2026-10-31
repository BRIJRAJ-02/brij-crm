// The link page's blocks (spec 0051, built as blocks; one page per workspace since spec 0056): a person's ordered
// list at `/<handle>` in ONE workspace, kept with their account in schema auth (migrations 0098 and 0113), out of the
// app role's reach. Every definer takes the session's own workspace beside the owner and refuses unless the owner is
// an active member of it, so a person's pages in their other workspaces are never read or written from here. These are its only ways there, each one of
// crm_handle's definers, run inside the caller's workspace transaction with the session's own user id: no input names
// the owner, so no role in any workspace reaches another person's page. A booking page block names a page by its
// workspace and id; which of the person's pages it may name, and what the editor shows of one, comes through the
// door (`enterOwnPages`), each read as the page's read only `booking` actor in its own workspace.
//
// No audit row: the blocks are the person's, not the workspace's, and a workspace's history is read by its admins.
// (The identity login keeps the default grant every auth table gets; the app reaches the table only through here.)
import {
  csvLine,
  CSV_BOM,
  HUES,
  MEDIA_LINK_REFUSAL,
  MEDIA_PROVIDER_NAMES,
  PAGE_THEME_REFUSAL,
  PROFILE_BLOCK_KINDS,
  PROFILE_CSV_MAX_DAYS,
  PROFILE_OTHER,
  PROFILE_VIEW_FACTS,
  ProfileQrStyle,
  PageTheme,
  ProfileBlock,
  ProfileItem,
  profileLimitSentence,
  profileSharePath,
  SHARE_IMAGE_MAX_BYTES,
  SHARE_IMAGE_TYPES,
  SkippedImportRow,
  PROFILE_COUNT_DAYS,
  type MediaProvider,
  type ProfileCounts,
  type ProfileDay,
  type ProfileFactValue,
  type ProfileImageKind,
  type ProfileImageType,
  type ProfileInsightDays,
  type ProfileItems,
  type ProfileViewFact,
  type ProfileFormChoice,
  type ProfileFormFacts,
  type ProfilePageChoice,
  type ProfileLinkImportResult,
  type ProfilePageFacts,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { enterOwnForms, enterOwnPages, ownUserId, type OwnedFormEntry, type OwnedPageEntry } from '../access/door.ts';
import { showLinkPage } from '../booking/handles.ts';
import { workspaceAddressProblem } from '../booking/workspace-addresses.ts';
import { isUuid, newId } from '../engine/ids.ts';
import { imageTypeOf } from '../booking/image-type.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { mediaShareUrl, parseMediaLink } from './embeds.ts';

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

// Every edit an owner makes to their link page here also shows it (`showLinkPage`, 27 Oct 2026): a page made with
// a membership is private until its owner first edits it or shares its link. Two writes don't: search engines on or
// off, since turning them off says "keep this quiet", not "publish it"; and `placeProfilePage`, which puts a booking
// page on the link page as a side effect of making that page Public, not as an edit of the link page.

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

function itemOf(row: ItemRow, facts: BlockFacts, outside: ReadonlySet<string> = new Set()): ProfileItem | undefined {
  const data = typeof row.data === 'object' && row.data !== null ? row.data : {};
  const stored = {
    id: row.id,
    updatedAt: iso(row.updated_at),
    ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }),
  };
  let candidate: unknown;
  if (row.kind === 'page' || row.kind === 'times') {
    const found = row.page_id === null ? undefined : facts.pages.get(row.page_id);
    candidate = {
      ...data,
      kind: row.kind,
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
    candidate = {
      hue: 'blue',
      ...data,
      kind: 'link',
      ...stored,
      ...(outside.has(row.id) ? { outsideWorkspace: true } : {}),
    };
  } else if (row.kind === 'media') {
    // The share link is rebuilt from the provider and id (spec 0061, AC-6105): what was pasted was never kept.
    const provider = 'provider' in data && typeof data.provider === 'string' ? data.provider : '';
    const ref = 'ref' in data && typeof data.ref === 'string' ? data.ref : '';
    const known = Object.keys(MEDIA_PROVIDER_NAMES).find((each) => each === provider) as MediaProvider | undefined;
    if (known === undefined) return undefined;
    candidate = { ...data, kind: 'media', url: mediaShareUrl(known, ref), ...stored };
  } else {
    candidate = { ...data, kind: row.kind, ...stored };
  }
  const parsed = ProfileItem.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function readRows(
  tx: WorkspaceTx,
  owner: string,
  workspace: string,
  archived: boolean,
): Promise<readonly ItemRow[]> {
  const found = await tx.execute<ItemRow>(
    archived
      ? sql`select ${ITEM_COLUMNS} from crm_profile_items_archived(${owner}::uuid, ${workspace}::uuid)`
      : sql`select ${ITEM_COLUMNS} from crm_profile_items(${owner}::uuid, ${workspace}::uuid)`,
  );
  return found.rows;
}

/** The facts of every booking page the rows name, as the door lets the owner place them now. */
async function factsForRows(scope: EngineScope, rows: readonly ItemRow[]): Promise<BlockFacts> {
  const pageIds = [
    ...new Set(
      rows.flatMap((row) =>
        (row.kind === 'page' || row.kind === 'times') && row.page_id !== null ? [row.page_id] : [],
      ),
    ),
  ];
  const formIds = rows.flatMap((row) => (row.kind === 'form' && row.form_id !== null ? [row.form_id] : []));
  return {
    pages: pageIds.length === 0 ? new Map() : await factsOf(await enterOwnPages(scope, pageIds)),
    forms: formIds.length === 0 ? new Map() : await formFactsOf(await enterOwnForms(scope, formIds)),
  };
}

/** Whether the options name any of our own origins, which is what makes an address one of ours to check. */
interface AddressOptions {
  readonly publicOrigins?: readonly string[];
}

/** Both lists, read in one transaction, with their pages' facts and the links that have left the workspace. */
async function readAll(scope: EngineScope, owner: string, options: AddressOptions = {}): Promise<ProfileItems> {
  const origins = options.publicOrigins ?? [];
  const [live, archived, outside] = await inWorkspace(scope, async (tx) => {
    const liveRows = await readRows(tx, owner, scope.workspaceId, false);
    const archivedRows = await readRows(tx, owner, scope.workspaceId, true);
    // A link to one of our own pages that no longer resolves in this workspace (AC-5612), marked for the editor.
    const gone = new Set<string>();
    if (origins.length > 0) {
      for (const row of [...liveRows, ...archivedRows]) {
        const url =
          row.kind === 'link' && typeof row.data === 'object' && row.data !== null && 'url' in row.data
            ? row.data.url
            : undefined;
        if (
          typeof url === 'string' &&
          (await workspaceAddressProblem(tx, scope.workspaceId, url, origins)) !== undefined
        ) {
          gone.add(row.id);
        }
      }
    }
    return [liveRows, archivedRows, gone] as const;
  });
  const facts = await factsForRows(scope, [...live, ...archived]);
  const items = (rows: readonly ItemRow[]) =>
    rows.flatMap((row) => {
      const item = itemOf(row, facts, outside);
      return item === undefined ? [] : [item];
    });
  return { items: items(live), archived: items(archived) };
}

/** The caller's link page: its live blocks in order, and its archived ones, newest first (the editor's read). */
export async function readProfileItems(scope: EngineScope, options: AddressOptions = {}): Promise<ProfileItems> {
  return readAll(scope, ownerOf(scope), options);
}

/**
 * The booking pages the caller may still place (AC-5117, AC-5606): their Public pages in the workspace they are in,
 * live or paused, without the ones a live block holds already, by title. Never another workspace's.
 */
export async function listProfilePageChoices(scope: EngineScope): Promise<readonly ProfilePageChoice[]> {
  const owner = ownerOf(scope);
  const live = await inWorkspace(scope, (tx) => readRows(tx, owner, scope.workspaceId, false));
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
  const live = await inWorkspace(scope, (tx) => readRows(tx, owner, scope.workspaceId, false));
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
        sql`select theme from crm_save_profile_theme(${owner}::uuid, ${scope.workspaceId}::uuid, ${JSON.stringify(parsed.data)}::jsonb) as theme`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
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
        sql`select crm_save_profile_indexable(${owner}::uuid, ${scope.workspaceId}::uuid, ${indexable}) as indexable`,
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

/** The sentence for a booking page or form that is not in the workspace the block is written in (AC-5605). */
const NOT_IN_WORKSPACE = 'That page isn’t in this workspace.';

/**
 * The picture a pasted link to the caller's own page shows instead of the card we draw (spec 0055, AC-5511), or
 * `undefined` to clear it back to the drawn one. Answers the path our own origin serves it from.
 *
 * What a browser said the file was is not taken: the bytes are read for their own signature (`imageTypeOf`), and
 * anything that is not a PNG or a JPEG is refused whatever the picker called it. The size is bounded here and
 * again by the column's check, so neither alone is load bearing. The version in the path is the definer's own,
 * never a caller's. One column write, through the one definer.
 */
export async function saveProfileShareImage(
  scope: EngineScope,
  image: { readonly type: string; readonly base64: string } | undefined,
): Promise<{ readonly shareImage?: string }> {
  const owner = ownerOf(scope);
  const workspace = scope.workspaceId;
  let bytes: Buffer | undefined;
  if (image !== undefined) {
    bytes = Buffer.from(image.base64, 'base64');
    if (bytes.byteLength === 0) throw refuseOn('CONFIG_INVALID', 'Add a picture.', 'image');
    if (bytes.byteLength > SHARE_IMAGE_MAX_BYTES) {
      throw refuseOn('CONFIG_INVALID', 'That picture is over 500 kB. Use a smaller one.', 'image');
    }
    const found = imageTypeOf(bytes);
    // The bytes decide, not the picker: a renamed file, or a type nothing here can draw, is refused as one thing.
    if (found === undefined || !SHARE_IMAGE_TYPES.some((kind) => kind === found)) {
      throw refuseOn('CONFIG_INVALID', 'A share image has to be a PNG or a JPEG.', 'image');
    }
  }
  const { handle, version } = await inWorkspace(scope, async (tx) => {
    try {
      const answered = await tx.execute<{ handle: string; version: string | null }>(
        sql`select p.handle, crm_save_profile_share_image(${owner}::uuid, ${workspace}::uuid, ${bytes ?? null}, ${image?.type ?? null}) as version
            from crm_public_profiles_of(array[${owner}::uuid], ${workspace}::uuid) p`,
      );
      const row = answered.rows[0];
      // No row is no page: a person who has not picked a handle has nothing for a share image to belong to,
      // and is refused the same way choosing a look refuses them, rather than quietly saving nothing.
      if (row === undefined) throw refuse('NOT_FOUND', 'Pick a handle before you choose a share image.');
      await showLinkPage(tx, owner, workspace);
      return { handle: row.handle, version: row.version };
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'Pick a handle before you choose a share image.');
      if (pg?.code === '23514') throw refuseOn('CONFIG_INVALID', 'That picture can’t be a share image.', 'image');
      throw error;
    }
  });
  // A null version is the picture taken away, which is a save like any other: the drawn card stands again.
  return version === null ? {} : { shareImage: profileSharePath(handle, version) };
}

/** A refusal for what a definer raised, or the error itself. */
function refusalOf(error: unknown): unknown {
  const pg = postgresError(error);
  if (pg === undefined) return error;
  if (pg.code === '54000') {
    const kind = [...PROFILE_BLOCK_KINDS, 'featured' as const].find((each) => each === pg.detail);
    return refuse('LIMIT_REACHED', profileLimitSentence(kind ?? 'items'));
  }
  // A picture the block names that isn't one of the owner's own on this page (spec 0061, AC-6129).
  if (pg.code === '42704' && pg.detail === 'image') {
    return refuse('NOT_FOUND', 'That picture isn’t on your link page. Add it again.');
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_heading_once') {
    return refuseOn('CONFIG_INVALID', 'You already have a heading called that.', 'title');
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_page_once') {
    return refuse('CONFIG_INVALID', 'That booking page is on your link page already.');
  }
  if (pg.code === '23505' && pg.constraint === 'profile_items_form_once') {
    return refuse('CONFIG_INVALID', 'That form is on your link page already.');
  }
  // A booking page or form that is not the person's own in this workspace (AC-5605): another workspace's, a deleted
  // one, a guessed id. One answer for all of them.
  if (pg.code === '42704') return refuse('NOT_FOUND', NOT_IN_WORKSPACE);
  if (pg.code === '42501') return refuse('FORBIDDEN', 'You’re not a member of this workspace.');
  if (pg.code === 'P0002') return refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  if (pg.code === '22023') return refuse('CONFIG_INVALID', 'That block can’t be saved as it is.');
  return error;
}

/** The hue a new link's letter takes: the next of the nine after the person's links so far, gray last. */
function nextHue(links: number): (typeof HUES)[number] {
  const ring = [...HUES.filter((hue) => hue !== 'gray'), 'gray' as const];
  return ring[links % ring.length] ?? 'blue';
}

/** A media block's provider, id and what was read of it once, ready to store (spec 0061, AC-6105). */
export interface ResolvedMedia {
  readonly provider: MediaProvider;
  readonly ref: string;
  readonly title?: string;
  readonly poster?: string;
}

/** An object without its undefined and empty string fields: a field a person left empty is never stored. */
function compact(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== ''));
}

/**
 * The fields every kind but a heading may share (spec 0061): its window, and on the kinds that take one its tile
 * size, `small` (the default) left out so a block stored before grids is the same block.
 */
function sharedOf(block: ProfileBlock): Record<string, unknown> {
  if (block.kind === 'heading') return {};
  const size = 'size' in block && block.size !== 'small' ? block.size : undefined;
  return compact({ showFrom: block.showFrom, hideAfter: block.hideAfter, size });
}

/** A block's fields as the definer stores them: its kind, its data, and the page or form it names, if any. */
function storedOf(block: ProfileBlock, hue: (typeof HUES)[number], media?: ResolvedMedia) {
  const shared = sharedOf(block);
  if (block.kind === 'page' || block.kind === 'times') {
    return { kind: block.kind, data: shared, workspaceId: block.workspaceId, pageId: block.pageId, formId: null };
  }
  if (block.kind === 'media') {
    if (media === undefined) throw new Error('A media block is stored only once its link is read.');
    return {
      kind: block.kind,
      data: compact({ ...shared, provider: media.provider, ref: media.ref, title: media.title, poster: media.poster }),
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
  if (block.kind === 'socials' || block.kind === 'image' || block.kind === 'gallery' || block.kind === 'banner') {
    const { kind, showFrom: _from, hideAfter: _after, ...fields } = block;
    const kept = compact({ ...fields, ...shared });
    // A gallery's `row` is its default, left out as a size's `small` is.
    if (kind === 'gallery' && kept.display === 'row') delete kept.display;
    return { kind, data: kept, workspaceId: null, pageId: null, formId: null };
  }
  if (block.kind === 'form') {
    return {
      kind: block.kind,
      data: { label: block.label, ...shared },
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
    const { kind, showFrom: _from, hideAfter: _after, ...data } = block;
    return { kind, data: { ...compact(data), ...shared }, workspaceId: null, pageId: null, formId: null };
  }
  if (block.kind === 'testimonial') {
    return {
      kind: block.kind,
      data: {
        quote: block.quote,
        author: block.author,
        ...(block.role === undefined || block.role === '' ? {} : { role: block.role }),
        ...shared,
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
        ...shared,
      },
      workspaceId: null,
      pageId: null,
      formId: null,
    };
  }
  if (block.kind === 'text') {
    return {
      kind: block.kind,
      data: {
        body: block.body,
        ...(block.title === undefined || block.title === '' ? {} : { title: block.title }),
        ...shared,
      },
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
      // Spec 0061: its picture, the featured card (a row is the default, left out) and its notice.
      ...compact({
        thumb: block.thumb,
        style: block.style === 'featured' ? 'featured' : undefined,
        notice: block.notice,
      }),
      ...shared,
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
  options: {
    readonly publicOrigins?: readonly string[];
    /**
     * Reads a media block's title and poster once, on save (spec 0061, AC-6105): the api's outside fetch behind it,
     * the poster stored as one of the owner's pictures (`addProfileImage`). Absent, or failing, the block keeps the
     * provider's name as its title and no poster.
     */
    readonly readMedia?: (
      provider: MediaProvider,
      ref: string,
    ) => Promise<{ readonly title?: string; readonly poster?: string }>;
  } = {},
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
  // A block belongs to the workspace the session is in, whatever the block says (AC-5604); the definer checks the
  // page or form against that workspace again, from its own rows.
  if (
    (block.kind === 'page' || block.kind === 'form' || block.kind === 'times') &&
    block.workspaceId !== scope.workspaceId
  ) {
    throw refuse('NOT_FOUND', NOT_IN_WORKSPACE);
  }
  if (block.kind === 'page' || block.kind === 'times') {
    const [entry] = await enterOwnPages(scope, [block.pageId]);
    if (entry === undefined) throw refuse('NOT_FOUND', NOT_IN_WORKSPACE);
  }
  if (block.kind === 'form') {
    const [entry] = await enterOwnForms(scope, [block.formId]);
    if (entry === undefined) throw refuse('NOT_FOUND', NOT_IN_WORKSPACE);
  }
  // A media block's link read into a provider and an id (AC-6105); what was pasted is never stored.
  let media: ResolvedMedia | undefined;
  if (block.kind === 'media') {
    const parsedLink = parseMediaLink(block.url);
    if (!parsedLink.ok) throw refuseOn('CONFIG_INVALID', MEDIA_LINK_REFUSAL, 'url');
    media = await resolveMedia(scope, owner, input.id, block, parsedLink, options.readMedia);
  }
  const row = await inWorkspace(scope, async (tx) => {
    // A link to one of our own pages stays inside this workspace (spec 0056, AC-5610): another workspace's page, and
    // one that is nowhere, are refused alike. A link to any other site is untouched.
    if (block.kind === 'link') {
      const problem = await workspaceAddressProblem(tx, scope.workspaceId, block.url, options.publicOrigins ?? []);
      if (problem !== undefined) throw refuseOn('CONFIG_INVALID', problem, 'url');
    }
    // The live blocks only when they are needed: an edit's existence, or a new link's colour.
    const needsRows = input.isEdit === true || (block.kind === 'link' && block.hue === undefined);
    const live = needsRows ? await readRows(tx, owner, scope.workspaceId, false) : [];
    if (input.isEdit === true && !live.some((each) => each.id === input.id)) {
      const archived = await readRows(tx, owner, scope.workspaceId, true);
      if (!archived.some((each) => each.id === input.id)) {
        throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
      }
    }
    const stored = storedOf(block, nextHue(live.filter((each) => each.kind === 'link').length), media);
    try {
      const saved = await tx.execute<ItemRow>(
        sql`select ${ITEM_COLUMNS} from crm_save_profile_item(${owner}::uuid, ${scope.workspaceId}::uuid, ${input.id}::uuid, ${stored.kind}, ${JSON.stringify(stored.data)}::jsonb, ${stored.pageId}::uuid, ${stored.formId}::uuid)`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
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
 * A media block's stored fields (AC-6105): the same video again keeps the title and poster it has, so an edit never
 * reads the provider again; a new one is read once through `readMedia`. The owner's own title always wins, and with
 * none the provider's own, else the provider's name.
 */
async function resolveMedia(
  scope: EngineScope,
  owner: string,
  id: string,
  block: Extract<ProfileBlock, { kind: 'media' }>,
  link: { readonly provider: MediaProvider; readonly ref: string },
  readMedia?: (provider: MediaProvider, ref: string) => Promise<{ readonly title?: string; readonly poster?: string }>,
): Promise<ResolvedMedia> {
  const rows = await inWorkspace(scope, async (tx) => [
    ...(await readRows(tx, owner, scope.workspaceId, false)),
    ...(await readRows(tx, owner, scope.workspaceId, true)),
  ]);
  const held = rows.find((row) => row.id === id && row.kind === 'media');
  const data: Readonly<Record<string, unknown>> =
    typeof held?.data === 'object' && held.data !== null ? (held.data as Readonly<Record<string, unknown>>) : {};
  const same = data.provider === link.provider && data.ref === link.ref;
  const read: { readonly title?: string; readonly poster?: string } = same
    ? {
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
        ...(typeof data.poster === 'string' ? { poster: data.poster } : {}),
      }
    : await (readMedia?.(link.provider, link.ref) ?? Promise.resolve({})).catch(() => ({}));
  const title = block.title ?? read.title ?? MEDIA_PROVIDER_NAMES[link.provider];
  return {
    provider: link.provider,
    ref: link.ref,
    title,
    ...(read.poster === undefined ? {} : { poster: read.poster }),
  };
}

/**
 * Sets the caller's whole order at once (AC-5116): `ids` must be exactly their live blocks, each once. An order from
 * a tab that missed a change is `CONFIG_INVALID`, and the editor puts its rows back. Answers both lists.
 */
export async function orderProfileItems(
  scope: EngineScope,
  ids: readonly string[],
  options: AddressOptions = {},
): Promise<ProfileItems> {
  const owner = ownerOf(scope);
  if (ids.length === 0 || !ids.every((id) => isUuid(id))) {
    throw refuse('CONFIG_INVALID', 'Your link page changed somewhere else. It now shows the latest order.');
  }
  await inWorkspace(scope, async (tx) => {
    try {
      await tx.execute(
        sql`select crm_order_profile_items(${owner}::uuid, ${scope.workspaceId}::uuid, ${`{${ids.join(',')}}`}::uuid[])`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '22023') {
        throw refuse('CONFIG_INVALID', 'Your link page changed somewhere else. It now shows the latest order.');
      }
      throw refusalOf(error);
    }
  });
  return readAll(scope, owner, options);
}

/**
 * Archives one block (it leaves the public page at once and keeps everything it held), or restores it to the end
 * under an add's limits and rules (AC-5106). Archiving a heading archives nothing under it. Answers both lists.
 */
export async function archiveProfileItem(
  scope: EngineScope,
  input: { readonly id: string; readonly archived: boolean },
  options: AddressOptions = {},
): Promise<ProfileItems> {
  const owner = ownerOf(scope);
  const found = await inWorkspace(scope, async (tx) => {
    // A link restored to the page is checked as a new one is (spec 0056, AC-5610): one that now names a page outside
    // this workspace stays archived.
    if (!input.archived) {
      const origins = options.publicOrigins ?? [];
      const row = (await readRows(tx, owner, scope.workspaceId, true)).find((each) => each.id === input.id);
      const url =
        row?.kind === 'link' && typeof row.data === 'object' && row.data !== null && 'url' in row.data
          ? row.data.url
          : undefined;
      if (typeof url === 'string' && origins.length > 0) {
        const problem = await workspaceAddressProblem(tx, scope.workspaceId, url, origins);
        if (problem !== undefined) throw refuse('CONFIG_INVALID', problem);
      }
    }
    try {
      const answer = await tx.execute<{ found: boolean }>(
        sql`select crm_archive_profile_item(${owner}::uuid, ${scope.workspaceId}::uuid, ${input.id}::uuid, ${input.archived}) as found`,
      );
      const found = answer.rows[0]?.found === true;
      // Only a change that happened publishes: a stale tab archiving a block already gone leaves the page as it was.
      if (found) await showLinkPage(tx, owner, scope.workspaceId);
      return found;
    } catch (error) {
      throw refusalOf(error);
    }
  });
  if (!found) throw refuse('NOT_FOUND', 'That block isn’t on your link page any more.');
  return readAll(scope, owner, options);
}

/** Deletes one block for good (AC-5106; the editor asks first). */
export async function deleteProfileItem(scope: EngineScope, id: string): Promise<{ readonly id: string }> {
  const owner = ownerOf(scope);
  const found = await inWorkspace(scope, async (tx) => {
    const answer = await tx.execute<{ found: boolean }>(
      sql`select crm_delete_profile_item(${owner}::uuid, ${scope.workspaceId}::uuid, ${id}::uuid) as found`,
    );
    const found = answer.rows[0]?.found === true;
    if (found) await showLinkPage(tx, owner, scope.workspaceId);
    return found;
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

/** One row of `crm_profile_insights`: a day, a metric and its key, and up to two counts. */
interface InsightRow extends Record<string, unknown> {
  readonly day: string;
  readonly metric: string;
  readonly key: string | null;
  readonly views: string | number | null;
  readonly visitors: string | number | null;
}

/** The rows of one range from `crm_profile_insights`, the day as `YYYY-MM-DD`. */
async function insightsIn(
  tx: WorkspaceTx,
  owner: string,
  workspace: string,
  from: string,
  to: string,
): Promise<readonly InsightRow[]> {
  const found = await tx.execute<InsightRow>(
    sql`select day::text as day, metric, key, views, visitors from crm_profile_insights(${owner}::uuid, ${workspace}::uuid, ${from}::date, ${to}::date)`,
  );
  return found.rows;
}

/** Every UTC day from `from` to `to`, both included. */
function daysFrom(from: string, to: string): readonly string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/** Each day's views and visitors over a range, every day present, oldest first. */
function seriesOf(rows: readonly InsightRow[], from: string, to: string): ProfileDay[] {
  const byDay = new Map(
    rows
      .filter((row) => row.metric === 'traffic')
      .map((row) => [row.day, { views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) }]),
  );
  return daysFrom(from, to).map((day) => ({ day, ...(byDay.get(day) ?? { views: 0, visitors: 0 }) }));
}

/** How many values of each fact Insights names before the rest are summed as `Other` (AC-6118). */
const TOP_VALUES = 5;

/** A fact's values over the period, the top 5 by views, then the rest (and the days' own `Other`) as `Other`. */
function topValues(rows: readonly InsightRow[], fact: ProfileViewFact): ProfileFactValue[] {
  const sums = new Map<string, { views: number; visitors: number }>();
  for (const row of rows) {
    if (row.metric !== fact || row.key === null) continue;
    const held = sums.get(row.key) ?? { views: 0, visitors: 0 };
    sums.set(row.key, {
      views: held.views + Number(row.views ?? 0),
      visitors: held.visitors + Number(row.visitors ?? 0),
    });
  }
  const ranked = [...sums]
    .filter(([value]) => value !== PROFILE_OTHER)
    .map(([value, counts]) => ({ value, ...counts }))
    .sort(
      (left, right) =>
        right.views - left.views || right.visitors - left.visitors || (left.value < right.value ? -1 : 1),
    );
  const top = ranked.slice(0, TOP_VALUES);
  const rest = [
    ...ranked.slice(TOP_VALUES),
    { value: PROFILE_OTHER, ...(sums.get(PROFILE_OTHER) ?? { views: 0, visitors: 0 }) },
  ];
  const other = rest.reduce(
    (sum, each) => ({ views: sum.views + each.views, visitors: sum.visitors + each.visitors }),
    {
      views: 0,
      visitors: 0,
    },
  );
  return other.views > 0 || other.visitors > 0 ? [...top, { value: PROFILE_OTHER, ...other }] : top;
}

/** The sum of one metric's `views` column over a set of rows. */
function sumOf(rows: readonly InsightRow[], metric: string, column: 'views' | 'visitors' = 'views'): number {
  return rows.reduce((sum, row) => (row.metric === metric ? sum + Number(row[column] ?? 0) : sum), 0);
}

/**
 * The caller's link page figures (spec 0051, AC-5127; spec 0061, AC-6118, AC-6119): over the last 7, 30 or 90 UTC
 * days, today included, the page's views and visitors, the same span before them as the comparison, each live
 * block's presses, each day's series for both spans, the top values of each fact, and the funnel from views to
 * presses to bookings. Their own only: the owner is the session's identity. Reads two ranges in one transaction;
 * writes nothing.
 */
export async function readProfileCounts(
  scope: EngineScope,
  now: Date = new Date(),
  days: ProfileInsightDays = PROFILE_COUNT_DAYS,
): Promise<ProfileCounts> {
  const owner = ownerOf(scope);
  const today = now.toISOString().slice(0, 10);
  const from = dayBefore(today, days - 1);
  const beforeFrom = dayBefore(from, days);
  const beforeTo = dayBefore(from, 1);
  const [current, before] = await inWorkspace(scope, async (tx) => [
    await insightsIn(tx, owner, scope.workspaceId, from, today),
    await insightsIn(tx, owner, scope.workspaceId, beforeFrom, beforeTo),
  ]);
  const presses = new Map<string, number>();
  for (const row of current) {
    if (row.metric === 'press' && row.key !== null)
      presses.set(row.key, (presses.get(row.key) ?? 0) + Number(row.views ?? 0));
  }
  const views = sumOf(current, 'traffic');
  const pressed = [...presses.values()].reduce((sum, count) => sum + count, 0);
  return {
    days,
    views,
    visitors: sumOf(current, 'traffic', 'visitors'),
    before: { views: sumOf(before, 'traffic'), visitors: sumOf(before, 'traffic', 'visitors') },
    presses: [...presses].flatMap(([id, count]) => (count < 1 ? [] : [{ id, presses: count }])),
    series: seriesOf(current, from, today),
    seriesBefore: seriesOf(before, beforeFrom, beforeTo),
    facts: {
      referrer: topValues(current, 'referrer'),
      source: topValues(current, 'source'),
      country: topValues(current, 'country'),
      device: topValues(current, 'device'),
    },
    funnel: { views, presses: pressed, bookings: sumOf(current, 'bookings') },
  };
}

/** A UTC day as Insights takes it: `YYYY-MM-DD`, a real day. */
function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** What one block is called in the CSV: its own words, else its kind. */
function blockLabel(item: ProfileItem): string {
  if ('title' in item && typeof item.title === 'string' && item.title !== '') return item.title;
  if (item.kind === 'contact') return item.fullName;
  if (item.kind === 'banner') return item.text;
  if (item.kind === 'form') return item.label;
  if ((item.kind === 'page' || item.kind === 'times') && item.page !== undefined) return item.page.title;
  return item.kind;
}

/**
 * The Insights CSV (spec 0061, AC-6120): one row per day, metric and key over `from` to `to` (both UTC days, at most
 * 365 days), as `day,metric,key,count`: views, visitors, each block's presses (named by its words), bookings, and each
 * fact's values' views and visitors. Every text cell goes through the formula guard (`csvLine`), so a title starting
 * with `=` is written with a leading `'`. A range that isn't one is `CONFIG_INVALID`.
 */
export async function profileInsightsCsv(
  scope: EngineScope,
  range: { readonly from: string; readonly to: string },
): Promise<string> {
  const owner = ownerOf(scope);
  if (!isDay(range.from) || !isDay(range.to) || range.from > range.to) {
    throw refuse('CONFIG_INVALID', 'Pick a start day on or before the end day.');
  }
  const span = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > PROFILE_CSV_MAX_DAYS) throw refuse('CONFIG_INVALID', 'Download up to 365 days at a time.');
  const rows = await inWorkspace(scope, (tx) => insightsIn(tx, owner, scope.workspaceId, range.from, range.to));
  const items = await readAll(scope, owner);
  const labels = new Map([...items.items, ...items.archived].map((item) => [item.id, blockLabel(item)]));
  const lines: string[] = [csvLine(['day', 'metric', 'key', 'count'])];
  const sorted = [...rows].sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0));
  for (const row of sorted) {
    const views = Number(row.views ?? 0);
    const visitors = Number(row.visitors ?? 0);
    if (row.metric === 'traffic') {
      lines.push(csvLine([row.day, 'views', '', views]), csvLine([row.day, 'visitors', '', visitors]));
    } else if (row.metric === 'bookings') {
      lines.push(csvLine([row.day, 'bookings', '', views]));
    } else if (row.metric === 'press' && row.key !== null) {
      lines.push(csvLine([row.day, 'presses', labels.get(row.key) ?? row.key, views]));
    } else if (PROFILE_VIEW_FACTS.some((fact) => fact === row.metric) && row.key !== null) {
      lines.push(
        csvLine([row.day, `${row.metric} views`, row.key, views]),
        csvLine([row.day, `${row.metric} visitors`, row.key, visitors]),
      );
    }
  }
  return `${CSV_BOM}${lines.join('')}`;
}

/**
 * Keeps one picture of the caller's own link page (spec 0061, AC-6101, AC-6108): its bytes are in the store already
 * at `path`, made by the server for this person, this workspace and this id. Through `crm_add_profile_image`, which
 * checks the membership, the page, and the limits (300 kept, 60 an hour).
 */
export async function addProfileImage(
  scope: EngineScope,
  image: {
    readonly id: string;
    readonly kind: ProfileImageKind;
    readonly path: string;
    readonly type: ProfileImageType;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
  },
): Promise<void> {
  const owner = ownerOf(scope);
  await inWorkspace(scope, async (tx) => {
    try {
      await tx.execute(
        sql`select crm_add_profile_image(${owner}::uuid, ${scope.workspaceId}::uuid, ${image.id}::uuid, ${image.kind}, ${image.path}, ${image.type}, ${image.bytes}::integer, ${image.width}::integer, ${image.height}::integer)`,
      );
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '54000') {
        throw refuse(
          'LIMIT_REACHED',
          pg.detail === 'hour'
            ? 'You’ve added a lot of pictures in the last hour. Try again later.'
            : 'Your link page holds as many pictures as it can. Delete a few blocks with pictures first.',
        );
      }
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'Pick a handle before you add a picture.');
      if (pg?.code === '42501') throw refuse('FORBIDDEN', 'You’re not a member of this workspace.');
      throw error;
    }
  });
}

/** One of the caller's own pictures, for their editor: where it is stored, or undefined when it isn't theirs here. */
export async function readOwnProfileImage(
  scope: EngineScope,
  imageId: string,
): Promise<{ readonly path: string; readonly type: string } | undefined> {
  const owner = ownerOf(scope);
  if (!isUuid(imageId)) return undefined;
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<{ path: string; content_type: string }>(
      sql`select path, content_type from crm_profile_image_of(${owner}::uuid, ${scope.workspaceId}::uuid, ${imageId}::uuid)`,
    ),
  );
  const row = found.rows[0];
  return row === undefined ? undefined : { path: row.path, type: row.content_type };
}

/**
 * The saved address of one of the caller's own links (spec 0061, AC-6101): what "Use the site's picture" reads, so
 * the server only ever reads an address the owner saved, never one in the request. Undefined for anything else.
 */
export async function readOwnLinkAddress(scope: EngineScope, itemId: string): Promise<string | undefined> {
  const owner = ownerOf(scope);
  if (!isUuid(itemId)) return undefined;
  const rows = await inWorkspace(scope, async (tx) => [
    ...(await readRows(tx, owner, scope.workspaceId, false)),
    ...(await readRows(tx, owner, scope.workspaceId, true)),
  ]);
  const row = rows.find((each) => each.id === itemId && each.kind === 'link');
  const data = typeof row?.data === 'object' && row.data !== null ? row.data : {};
  return 'url' in data && typeof data.url === 'string' && /^https:\/\//i.test(data.url) ? data.url : undefined;
}

/** The caller's share QR style (spec 0061, AC-6124): what was saved, or the plain code. */
export async function readQrStyle(scope: EngineScope): Promise<ProfileQrStyle> {
  const owner = ownerOf(scope);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<{ style: unknown }>(
      sql`select crm_profile_qr_style(${owner}::uuid, ${scope.workspaceId}::uuid) as style`,
    ),
  );
  return ProfileQrStyle.safeParse(found.rows[0]?.style ?? {}).data ?? {};
}

/**
 * Saves the caller's share QR style (spec 0061, AC-6124), whole, or clears it with `null`. The colour's contrast
 * against the light background is checked by the schema (refused with its hint); a centre picture must be one of the
 * owner's own on this page, which the definer checks again.
 */
export async function saveQrStyle(scope: EngineScope, style: ProfileQrStyle | null): Promise<ProfileQrStyle> {
  const owner = ownerOf(scope);
  const parsed = style === null ? undefined : ProfileQrStyle.safeParse(style);
  if (parsed !== undefined && !parsed.success) {
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === 'string' ? issue.path[0] : undefined;
    const message = issue?.message ?? 'That style can’t be saved.';
    throw field === undefined ? refuse('CONFIG_INVALID', message) : refuseOn('CONFIG_INVALID', message, field);
  }
  const kept = parsed?.data;
  const empty = kept === undefined || Object.keys(kept).length === 0;
  const saved = await inWorkspace(scope, async (tx) => {
    try {
      const answered = await tx.execute<{ style: unknown }>(
        sql`select crm_save_profile_qr_style(${owner}::uuid, ${scope.workspaceId}::uuid, ${empty ? null : JSON.stringify(kept)}::jsonb) as style`,
      );
      return answered.rows[0]?.style;
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'Pick a handle before you style its code.');
      if (pg?.code === '22023') throw refuseOn('CONFIG_INVALID', 'That picture isn’t on your link page.', 'picture');
      if (pg?.code === '42501') throw refuse('FORBIDDEN', 'You’re not a member of this workspace.');
      throw error;
    }
  });
  return ProfileQrStyle.safeParse(saved ?? {}).data ?? {};
}

/**
 * Keeps one link in bio page's rows as hidden blocks (spec 0055, AC-5524 to AC-5528). The reading of the page is
 * not here: `readImportedPage` in `../booking/link-import.ts` turns HTML into rows with no network and no
 * database, and the api's bounded fetch brings it. This is the write, and all it does is land what it was given.
 *
 * Every row lands hidden, in the order the page had them, so an import that is never reviewed changes nothing a
 * visitor sees. `id` is the import's own: the same import again adds nothing and answers what it already holds.
 */
export async function importProfileLinks(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly source: string;
    readonly rows: readonly { readonly title: string; readonly url: string }[];
    readonly skipped: readonly SkippedImportRow[];
  },
  options: AddressOptions = {},
): Promise<ProfileLinkImportResult> {
  const owner = ownerOf(scope);
  // A row naming one of our own pages outside this workspace never lands (spec 0056, AC-5610): it stays behind,
  // shown with why, like every other row the import could not make.
  const origins = options.publicOrigins ?? [];
  const foreign =
    origins.length === 0
      ? new Set<number>()
      : await inWorkspace(scope, async (tx) => {
          const found = new Set<number>();
          for (const [index, row] of input.rows.entries()) {
            if ((await workspaceAddressProblem(tx, scope.workspaceId, row.url, origins)) !== undefined)
              found.add(index);
          }
          return found;
        });
  const kept = input.rows.filter((_, index) => !foreign.has(index));
  const left = input.rows.flatMap((row, index) =>
    foreign.has(index) ? [{ title: row.title, url: row.url, reason: 'not-in-workspace' as const }] : [],
  );
  // One import archives its rows at one moment, so the archived list (newest first, then by id) orders them by id:
  // ids handed out in ascending order keep the page's own order there.
  const ids = kept.map(() => newId()).sort();
  const blocks = kept.map((row, index) => ({
    id: ids[index] ?? newId(),
    // The hue ring runs over the import itself, so one import's rows read as a set rather than all one colour.
    data: { title: row.title, url: row.url, hue: nextHue(index) },
  }));
  // At most 100 kept, as the row's own check allows.
  const skipped = [...left, ...input.skipped].slice(0, 100).map((row) => SkippedImportRow.parse(row));
  const made = await inWorkspace(scope, async (tx) => {
    try {
      const answered = await tx.execute<{ existed: boolean; made: number }>(
        sql`select existed, made from crm_import_profile_links(${owner}::uuid, ${scope.workspaceId}::uuid, ${input.id}::uuid, ${input.source}, ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(skipped)}::jsonb)`,
      );
      await showLinkPage(tx, owner, scope.workspaceId);
      return answered.rows[0];
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '54000' && pg.detail === 'imports') {
        throw refuse('LIMIT_REACHED', 'You’ve brought across five pages in the last hour. Try again later.');
      }
      if (pg?.code === 'P0002') throw refuse('NOT_FOUND', 'That import isn’t yours.');
      throw refusalOf(error);
    }
  });
  const items = await readAll(scope, owner);
  const existed = made?.existed ?? false;
  return {
    ...items,
    import: {
      id: input.id,
      source: input.source,
      made: made?.made ?? 0,
      existed,
      // A retry answers the page as it now stands and claims none of it: the ids are this call's only when it made them.
      itemIds: existed ? [] : blocks.map((block) => block.id),
      skipped,
    },
  };
}
