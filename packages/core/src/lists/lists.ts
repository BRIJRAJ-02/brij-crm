// Lists and their entries as the screens and the API read and write them
// (spec 0048): the workspace's lists, making one, and a list's entries as
// windows, counts, membership, adds, edits, removals and restores. A list
// follows its object (decision 2): reading it needs read on the object,
// changing its entries write. Every read and write goes through the scope the
// access door made, and the engine's own checks.
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { ListTemplate, ListView } from '@crm/contracts';
import { freeApiSlug, toApiSlug, type FilterGroup, type SortRules } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { canonicalId, checkId, isUuid } from '../engine/ids.ts';
import {
  addEntries,
  addEntry,
  changeEntries,
  changeList,
  insertList,
  readEntriesById,
  setListArchived,
  visibleEntries,
  type AddOutcome,
  type EntryOutcome,
  type EntryView,
  type ListUpdate,
} from '../engine/lists.ts';
import { countMatches, queryPage, type MatchCount } from '../engine/query/page.ts';
import { readRecords, setValues, type AttributeResult, type RecordView, type ValueInput } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { can, isOpen, objectLevel, recordRule, type Access } from '../access/policy.ts';
import { canManageList } from './manager.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_LIST } from '../access/visibility.ts';

const { lists, listEntries, members, objects, records } = schema;

/** A list's row as the reads need it. */
interface ListRow {
  readonly id: string;
  readonly objectId: string;
  readonly apiSlug: string;
  readonly name: string;
  readonly icon: string;
  readonly hue: string;
  readonly allowsDuplicates: boolean;
  readonly archivedAt: Date | null;
  readonly objectArchivedAt: Date | null;
  readonly defaultViewId: string | null;
  readonly createdByMemberId: string | null;
  readonly entryCount: number;
}

const LIST_COLUMNS = {
  id: lists.id,
  objectId: lists.objectId,
  apiSlug: lists.apiSlug,
  name: lists.name,
  icon: lists.icon,
  hue: lists.hue,
  allowsDuplicates: lists.allowsDuplicates,
  archivedAt: lists.archivedAt,
  objectArchivedAt: objects.archivedAt,
  defaultViewId: lists.defaultViewId,
  createdByMemberId: lists.createdByMemberId,
  entryCount: lists.entryCount,
};

/** Whether the caller may read the list: its object and the list itself above `none`. */
function readsList(access: Access, list: Pick<ListRow, 'id' | 'objectId'>): boolean {
  return isOpen(access) || (objectLevel(access, list.objectId) !== 'none' && objectLevel(access, list.id) !== 'none');
}

/** Whether the caller may change the list's entries: write on the object and on the list (decision 2). */
function writesList(access: Access, list: Pick<ListRow, 'id' | 'objectId'>): boolean {
  return isOpen(access) || (objectLevel(access, list.objectId) === 'write' && objectLevel(access, list.id) === 'write');
}

/** A list's row as the caller sees it. `makers` names the members still active. */
function viewOf(scope: EngineScope, row: ListRow, activeMakers: ReadonlySet<string>): ListView {
  // The stored count counts entries a record rule may hide (decision 13): only those no rule limits, and who
  // manage the schema (owners and admins), are told it.
  const toldCount = can(scope.access, 'schema.manage') && recordRule(scope.access, row.objectId) === undefined;
  return {
    id: row.id,
    objectId: row.objectId,
    apiSlug: row.apiSlug,
    name: row.name,
    icon: row.icon as ListView['icon'],
    hue: row.hue as ListView['hue'],
    allowsDuplicates: row.allowsDuplicates,
    isArchived: row.archivedAt !== null || row.objectArchivedAt !== null,
    ...(row.defaultViewId === null ? {} : { defaultViewId: row.defaultViewId }),
    ...(row.createdByMemberId === null ? {} : { createdByMemberId: row.createdByMemberId }),
    canWrite: writesList(scope.access, row),
    canManage: canManageList(scope, row, row.createdByMemberId !== null && activeMakers.has(row.createdByMemberId)),
    ...(toldCount ? { entryCount: row.entryCount } : {}),
  };
}

/** The makers among these lists still active in the workspace (a gone maker manages nothing, AC-4834). */
async function activeMakers(tx: WorkspaceTx, rows: readonly ListRow[]): Promise<ReadonlySet<string>> {
  const ids = [...new Set(rows.flatMap((row) => (row.createdByMemberId === null ? [] : [row.createdByMemberId])))];
  if (ids.length === 0) return new Set();
  const active = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, ids), eq(members.status, 'active')));
  return new Set(active.map((row) => row.id));
}

/**
 * The workspace's lists the caller may read (spec 0048, AC-4804), oldest
 * first: a list whose object they can't see is absent, and so is one whose
 * object is archived (it reads as archived, AC-4832). With `includeArchived`,
 * the archived ones follow the live ones.
 */
export async function listLists(
  scope: EngineScope,
  options: { readonly includeArchived?: boolean } = {},
): Promise<ListView[]> {
  return inWorkspace(scope, async (tx) => {
    const rows: readonly ListRow[] = await tx
      .select(LIST_COLUMNS)
      .from(lists)
      .innerJoin(objects, and(eq(objects.workspaceId, lists.workspaceId), eq(objects.id, lists.objectId)))
      .where(
        options.includeArchived === true
          ? eq(lists.workspaceId, scope.workspaceId)
          : and(eq(lists.workspaceId, scope.workspaceId), isNull(lists.archivedAt), isNull(objects.archivedAt)),
      )
      .orderBy(asc(lists.id));
    const readable = rows.filter((row) => readsList(scope.access, row));
    const makers = await activeMakers(tx, readable);
    const shown = readable.map((row) => viewOf(scope, row, makers));
    return [...shown.filter((list) => !list.isArchived), ...shown.filter((list) => list.isArchived)];
  });
}

/** One list the caller may read, inside `tx`, or `NOT_FOUND` as an unknown list (AC-4835). */
async function readList(tx: WorkspaceTx, scope: EngineScope, listId: string): Promise<ListRow> {
  const id = checkId(listId, UNKNOWN_LIST);
  const [row] = await tx
    .select(LIST_COLUMNS)
    .from(lists)
    .innerJoin(objects, and(eq(objects.workspaceId, lists.workspaceId), eq(objects.id, lists.objectId)))
    .where(and(eq(lists.workspaceId, scope.workspaceId), eq(lists.id, id)));
  if (row === undefined || !readsList(scope.access, row)) throw refuse('NOT_FOUND', UNKNOWN_LIST);
  return row;
}

/** One list as the caller sees it, or `NOT_FOUND`. */
export async function getList(scope: EngineScope, listId: string): Promise<ListView> {
  return inWorkspace(scope, async (tx) => {
    const row = await readList(tx, scope, listId);
    return viewOf(scope, row, await activeMakers(tx, [row]));
  });
}

/** A new list (AC-4801): the browser's UUID v7, its object, its name and tile, and what it starts as. */
export interface CreateListInput {
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly icon?: string | undefined;
  readonly hue?: string | undefined;
  readonly template: ListTemplate;
  readonly allowsDuplicates?: boolean | undefined;
}

/** The API names other lists hold that a new list's could clash with: `base` and `base_<n>`. */
async function takenSlugs(tx: WorkspaceTx, scope: EngineScope, base: string): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ apiSlug: lists.apiSlug })
    .from(lists)
    .where(
      and(
        eq(lists.workspaceId, scope.workspaceId),
        or(eq(lists.apiSlug, base), like(lists.apiSlug, `${base.replaceAll('_', '\\_')}\\_%`)),
      ),
    );
  return new Set(rows.map((row) => row.apiSlug));
}

/**
 * Makes a list (spec 0048, AC-4801 to AC-4805) and answers it: `lists.manage`
 * and write on the object (403 `FORBIDDEN`), the object live and visible
 * (`NOT_FOUND`). Its API name is `toApiSlug(name)`, with `_2`, `_3` on a clash
 * with another list's; each record goes in once unless asked otherwise
 * (decision 3). The same create again answers the list already made.
 */
export async function createList(
  scope: EngineScope,
  input: CreateListInput,
  hooks: readonly AfterWrite[] = [],
): Promise<ListView> {
  requirePermission(scope, 'lists.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  const base = toApiSlug(input.name, 'attribute');
  const { result } = await runWrite(
    scope,
    async (context) => {
      await checkObject(context.tx, scope.access, objectId, 'write');
      const apiSlug = freeApiSlug(base, await takenSlugs(context.tx, scope, base));
      return insertList(context, {
        id: input.id,
        objectId,
        apiSlug,
        name: input.name,
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.hue === undefined ? {} : { hue: input.hue }),
        template: input.template,
        allowsDuplicates: input.allowsDuplicates ?? false,
      });
    },
    hooks,
  );
  return getList(scope, result.listId);
}

/** What a list's settings change (AC-4829): any of its name, tile and the once only rule. */
export type UpdateListInput = ListUpdate;

/**
 * Changes a list's name, tile or "Each record once" rule (spec 0048, AC-4829,
 * AC-4830) and answers it: its managers only (403 `FORBIDDEN` naming who may).
 */
export async function updateList(
  scope: EngineScope,
  input: UpdateListInput,
  hooks: readonly AfterWrite[] = [],
): Promise<ListView> {
  const { listId } = await changeList(scope, input, hooks);
  return getList(scope, listId);
}

/** Archives a list (AC-4831): its managers only. It leaves every sidebar, picker and record page. */
export async function archiveList(
  scope: EngineScope,
  input: { readonly listId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ListView> {
  const { listId } = await setListArchived(scope, { listId: input.listId, archived: true }, hooks);
  return getList(scope, listId);
}

/** Restores an archived list with everything in it (AC-4831): its managers only. */
export async function restoreList(
  scope: EngineScope,
  input: { readonly listId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ListView> {
  const { listId } = await setListArchived(scope, { listId: input.listId, archived: false }, hooks);
  return getList(scope, listId);
}

/** One window of a list's entries: from a position, or after a cursor (AC-4809). */
export interface EntryWindow {
  readonly listId: string;
  readonly position?: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
  /** The record fields the rows show (the record's name always comes); every list field comes. */
  readonly attributeIds?: readonly string[];
  readonly now?: string;
  readonly timeZone?: string;
}

/** A window of entries in order, their records each once, and the cursor for the next. */
export interface EntryPage {
  readonly entries: readonly EntryView[];
  readonly records: readonly RecordView[];
  readonly nextCursor?: string;
}

/**
 * One window of a list's live entries in order (AC-4809), each read with its
 * record: entry order (the order they were added) with no sort. Refuses as
 * `queryPage` does; a list the caller can't read is `NOT_FOUND`.
 */
export async function queryEntries(scope: EngineScope, window: EntryWindow, signal?: AbortSignal): Promise<EntryPage> {
  const page = await queryPage(
    scope,
    {
      listId: window.listId,
      ...(window.position === undefined ? {} : { position: window.position }),
      ...(window.cursor === undefined ? {} : { cursor: window.cursor }),
      ...(window.limit === undefined ? {} : { limit: window.limit }),
      ...(window.filter === undefined ? {} : { filter: window.filter }),
      ...(window.sorts === undefined ? {} : { sorts: window.sorts }),
      ...(window.attributeIds === undefined ? {} : { attributeIds: window.attributeIds }),
      ...(window.now === undefined ? {} : { now: window.now }),
      ...(window.timeZone === undefined ? {} : { timeZone: window.timeZone }),
    },
    signal === undefined ? {} : { signal },
  );
  const answer = { entries: page.entries ?? [], records: page.records };
  return page.nextCursor === undefined ? answer : { ...answer, nextCursor: page.nextCursor };
}

/**
 * How many of a list's live entries match (AC-4809): exact when unfiltered
 * and no record rule limits the caller (the stored count), otherwise counted
 * through the rule and the filter, stopping at 10,000.
 */
export async function countEntries(
  scope: EngineScope,
  query: { readonly listId: string; readonly filter?: FilterGroup; readonly now?: string; readonly timeZone?: string },
  signal?: AbortSignal,
): Promise<MatchCount> {
  return countMatches(
    scope,
    {
      listId: query.listId,
      ...(query.filter === undefined ? {} : { filter: query.filter }),
      ...(query.now === undefined ? {} : { now: query.now }),
      ...(query.timeZone === undefined ? {} : { timeZone: query.timeZone }),
    },
    signal,
  );
}

/**
 * Live entries by id (up to 500) with their records, in the order asked: what
 * a live event's ids are read back through. Unknown, removed and hidden ids
 * are left out (AC-4836).
 */
export async function readEntryPage(
  scope: EngineScope,
  ids: readonly string[],
  attributeIds?: readonly string[],
): Promise<EntryPage> {
  if (ids.length > 500) throw refuse('CONFIG_INVALID', 'Read at most 500 entries at once.');
  const wanted = ids.filter(isUuid).map(canonicalId);
  if (wanted.length === 0) return { entries: [], records: [] };
  return inWorkspace(scope, async (tx) => {
    const entries = await readEntriesById(tx, scope.access, wanted);
    const recordIds = [...new Set(entries.map((entry) => entry.recordId))];
    const read = await readRecords(tx, scope.access, recordIds, {
      ...(attributeIds === undefined ? {} : { attributeIds: attributeIds.filter(isUuid).map(canonicalId) }),
    });
    return { entries, records: read };
  });
}

/**
 * Which of these records (at most 50) already have a live entry in the list
 * (the Add dialog's "Already in this list", AC-4814), as the caller may see
 * them. A list the caller can't read is `NOT_FOUND`.
 */
export async function entryMembership(
  scope: EngineScope,
  input: { readonly listId: string; readonly recordIds: readonly string[] },
): Promise<readonly string[]> {
  if (input.recordIds.length > 50) throw refuse('CONFIG_INVALID', 'Ask about at most 50 records at once.');
  const recordIds = [...new Set(input.recordIds.filter(isUuid).map(canonicalId))];
  return inWorkspace(scope, async (tx) => {
    const list = await readList(tx, scope, input.listId);
    if (recordIds.length === 0) return [];
    const rows = await tx
      .selectDistinct({ listId: listEntries.listId, recordId: listEntries.recordId })
      .from(listEntries)
      .innerJoin(
        records,
        and(
          eq(records.workspaceId, listEntries.workspaceId),
          eq(records.id, listEntries.recordId),
          isNull(records.deletedAt),
        ),
      )
      .where(
        and(eq(listEntries.listId, list.id), inArray(listEntries.recordId, recordIds), isNull(listEntries.deletedAt)),
      );
    const seen = isOpen(scope.access) ? rows : await visibleEntries(tx, scope.access, rows);
    return seen.map((row) => row.recordId);
  });
}

/** Each attribute's new version, from a write's results. */
function writtenOf(results: Readonly<Record<string, AttributeResult>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(results).flatMap(([attributeId, result]) =>
      result.versionId === undefined ? [] : [[attributeId, result.versionId]],
    ),
  );
}

/** An entry a write answers: fresh, its record, and the versions this write made. */
export interface WrittenEntry {
  readonly entry: EntryView;
  readonly record?: RecordView;
  readonly written: Record<string, string>;
}

/** One live entry and its record, read after its write committed, or `RECORD_DELETED` when it went meanwhile. */
async function freshEntry(scope: EngineScope, entryId: string): Promise<{ entry: EntryView; record?: RecordView }> {
  const page = await readEntryPage(scope, [entryId]);
  const [entry] = page.entries;
  if (entry === undefined) throw refuse('RECORD_DELETED', 'That entry was removed from its list.');
  const [record] = page.records;
  return record === undefined ? { entry } : { entry, record };
}

/** A new entry (AC-4813): the browser's UUID v7, the list, the record, its first list values. */
export interface AddListEntryInput {
  readonly id: string;
  readonly listId: string;
  readonly recordId: string;
  readonly values?: Readonly<Record<string, unknown>> | undefined;
  readonly timeZone?: string | undefined;
}

/**
 * Adds a record to a list (AC-4813 to AC-4816) and answers the entry fresh,
 * with its record. The engine refuses as `addEntry` does; the same add again
 * answers the entry already made, writing nothing.
 */
export async function addListEntry(
  scope: EngineScope,
  input: AddListEntryInput,
  hooks: readonly AfterWrite[] = [],
): Promise<WrittenEntry> {
  const { entryId, versions } = await addEntry(
    scope,
    {
      id: input.id,
      listId: input.listId,
      recordId: input.recordId,
      ...(input.values === undefined ? {} : { values: input.values }),
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
    },
    hooks,
  );
  return { ...(await freshEntry(scope, entryId)), written: writtenOf(versions) };
}

/** New list values for one entry (AC-4810). */
export interface EditEntryInput {
  readonly entryId: string;
  readonly values: Readonly<Record<string, ValueInput>>;
}

/**
 * Sets an entry's own values, all or none, as a record's are set (AC-4810:
 * the last save wins, the replaced save named in its event), and answers the
 * entry fresh. An entry the caller can't change refuses as the engine's
 * `setValues` does.
 */
export async function editEntry(
  scope: EngineScope,
  input: EditEntryInput,
  hooks: readonly AfterWrite[] = [],
): Promise<WrittenEntry> {
  const entryId = checkId(input.entryId, 'That entry does not exist.');
  const results = await setValues(scope, { entryId, values: input.values }, hooks);
  return { ...(await freshEntry(scope, entryId)), written: writtenOf(results) };
}

/**
 * Takes up to 500 entries out of their lists (AC-4817), each on its own: a
 * blocked one keeps its place and says why, never failing the rest.
 */
export async function removeEntries(
  scope: EngineScope,
  input: { readonly entryIds: readonly string[] },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly EntryOutcome[]> {
  return changeEntries(scope, { entryIds: input.entryIds, action: 'remove' }, hooks);
}

/**
 * Brings up to 500 removed entries back with their values and history
 * (AC-4818): one whose record is in an "Each record once" list again, or whose
 * list is full, stays out and says so, never failing the rest.
 */
export async function restoreEntries(
  scope: EngineScope,
  input: { readonly entryIds: readonly string[] },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly EntryOutcome[]> {
  return changeEntries(scope, { entryIds: input.entryIds, action: 'restore' }, hooks);
}

/** What adding many records answers (AC-4825): who went in, who was already in, and who was refused and why. */
export interface AddedEntries {
  readonly added: readonly { readonly recordId: string; readonly entryId: string }[];
  readonly alreadyIn: readonly string[];
  readonly refused: readonly { readonly recordId: string; readonly code: string; readonly message: string }[];
}

/** An add batch's outcomes sorted into the three groups the bulk bar's Toast speaks of. */
export function sortAdded(outcomes: readonly AddOutcome[]): AddedEntries {
  const added: { recordId: string; entryId: string }[] = [];
  const alreadyIn: string[] = [];
  const refused: { recordId: string; code: string; message: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.entryId !== undefined) added.push({ recordId: outcome.recordId, entryId: outcome.entryId });
    else if (outcome.refusal?.code === 'ENTRY_EXISTS') alreadyIn.push(outcome.recordId);
    else {
      refused.push({
        recordId: outcome.recordId,
        code: outcome.refusal?.code ?? 'INTERNAL',
        message: outcome.refusal?.message ?? 'That record was not added.',
      });
    }
  }
  return { added, alreadyIn, refused };
}

/**
 * Adds 1 to 500 records to a list in one request (AC-4825), each on its own:
 * a record already in an "Each record once" list is reported, one refused
 * says why, and neither fails the rest. `ids` are the entries' client minted
 * UUID v7s, one per record, so the same call again answers the entries it made.
 */
export async function addListEntries(
  scope: EngineScope,
  input: {
    readonly listId: string;
    readonly recordIds: readonly string[];
    readonly ids?: readonly string[] | undefined;
    readonly timeZone?: string | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<AddedEntries> {
  return sortAdded(await addEntries(scope, input, hooks));
}

/** The most entries one record's page lists (AC-4822). */
export const MAX_RECORD_ENTRIES = 100;

/**
 * Every live entry of one record in a list the caller may read (AC-4822),
 * by list name, then when it was added; at most 100. A list that is archived,
 * or whose object is, is left out, and so is one the caller can't read, with no
 * gap or count. A record the caller can't see is `NOT_FOUND`. One transaction:
 * the record's check, its object's live lists, then the first 100 entries in
 * the readable ones, in order, read with their values.
 */
export async function entriesForRecord(
  scope: EngineScope,
  input: { readonly recordId: string },
): Promise<readonly EntryView[]> {
  const recordId = checkId(input.recordId, 'That record does not exist.');
  return inWorkspace(scope, async (tx) => {
    const [seen] = await readRecords(tx, scope.access, [recordId], { attributeIds: [] });
    if (seen === undefined) throw refuse('NOT_FOUND', 'That record does not exist.');
    const candidates = await tx
      .select({ id: lists.id })
      .from(lists)
      .innerJoin(objects, and(eq(objects.workspaceId, lists.workspaceId), eq(objects.id, lists.objectId)))
      .where(and(eq(lists.objectId, seen.objectId), isNull(lists.archivedAt), isNull(objects.archivedAt)));
    // The record is visible, so its entries are wherever their list is (a list follows its object, decision 2).
    const readable = candidates
      .map((row) => row.id)
      .filter((id) => readsList(scope.access, { id, objectId: seen.objectId }));
    if (readable.length === 0) return [];
    const rows = await tx
      .select({ id: listEntries.id })
      .from(listEntries)
      .innerJoin(lists, and(eq(lists.workspaceId, listEntries.workspaceId), eq(lists.id, listEntries.listId)))
      .where(
        and(eq(listEntries.recordId, recordId), inArray(listEntries.listId, readable), isNull(listEntries.deletedAt)),
      )
      .orderBy(sql`lower(${lists.name})`, asc(listEntries.createdAt), asc(listEntries.id))
      .limit(MAX_RECORD_ENTRIES);
    return readEntriesById(
      tx,
      scope.access,
      rows.map((row) => row.id),
      true,
    );
  });
}
