// Lists and their entries (spec 0004, AC-6; spec 0048). A list collects
// records of one object; each entry has its own id, values and history,
// separate from the record's. Removing an entry hides it for 30 days, like a
// deleted record. Every entry write locks in one order: the list, then the
// record, then the entry (lockEntry skips the list), so two of them never wait
// on each other.
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { ListTemplate, ViewConfig } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { decodeValue } from './columns.ts';
import {
  audit,
  checkLook,
  checkName,
  checkSlug,
  definitionGuard,
  insertAttribute,
  touched,
  type InitialOption,
} from './definitions.ts';
import { RESTORE_WINDOW, takeEntrySlots, takeList } from './limits.ts';
import { bucketItems, initialValues, writeAll, type AttributeResult } from './records.ts';
import { canonicalId, checkId, isUuid, isUuidV7, newId } from './ids.ts';
import { isRefusal, postgresError, refuse, refuseOn, type RefusalError } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { setEntryKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import { checkEntryAccess, currentItems, loadListAttributes, lockRecord } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { attributeVisible, checkList, checkObject, visibleRecords } from '../access/visibility.ts';

const { attributes, listEntries, lists, objects, records, views } = schema;

/** What a new list needs. `allowsDuplicates` false lets each record in once. */
export interface ListInput {
  /** A UUID v7 the client minted (spec 0048): the retry key. The same create again answers the list already made. */
  readonly id?: string;
  readonly objectId: string;
  readonly apiSlug: string;
  readonly name: string;
  /** An `OBJECT_ICONS` name and a hue token (spec 0048); `list` and `gray` when absent. */
  readonly icon?: string;
  readonly hue?: string;
  readonly allowsDuplicates?: boolean;
  /** What it starts as (spec 0048, decision 4): Blank when absent. */
  readonly template?: ListTemplate;
}

/** A list a write made (or a retry found): its id and the view everyone lands on. */
export interface InsertedList {
  readonly listId: string;
  readonly defaultViewId: string;
  /** The same create came again after a lost answer: nothing was written this time. */
  readonly replayed: boolean;
}

/** What a new entry needs: its list, its record, and its first values by list attribute id. */
export interface EntryInput {
  /** A UUID v7 the client minted (spec 0048, AC-4816): the retry key. */
  readonly id?: string;
  readonly listId: string;
  readonly recordId: string;
  readonly values?: Readonly<Record<string, unknown>>;
  /** The creator's time zone, for date defaults (UTC when absent). */
  readonly timeZone?: string;
}

/** An entry as screens and services read it: its own values (system fields included) and each cell's version. */
export interface EntryView {
  readonly id: string;
  readonly listId: string;
  readonly recordId: string;
  readonly createdAt: string;
  readonly createdBy: Actor;
  readonly updatedAt: string;
  readonly updatedBy: Actor;
  readonly values: Readonly<Record<string, unknown>>;
  readonly versions: Readonly<Record<string, string>>;
}

/** The read only fields every list has (spec 0048, AC-4802): when an entry was added, and by whom. */
const SYSTEM_LIST_ATTRIBUTES = [
  { apiSlug: 'added', title: 'Added', type: 'timestamp', systemColumn: 'created_at' },
  { apiSlug: 'added_by', title: 'Added by', type: 'actor_reference', systemColumn: 'created_by' },
] as const;

/** The view every list has, its default unless it is a pipeline (spec 0048, AC-4802). */
export const ALL_ENTRIES_VIEW = 'All entries';

/** A pipeline's board view (spec 0048, AC-4802). */
export const PIPELINE_VIEW = 'Pipeline';

/**
 * A pipeline's stages, in order (spec 0048, AC-4802): the open ones first, then
 * Won and Lost. Their hues read as a pipeline does (grey to blue, then green and
 * red), rather than the next hue rule's run through the palette.
 */
export const PIPELINE_STAGES: readonly Omit<InitialOption, 'id'>[] = [
  { label: 'Lead', hue: 'gray', outcome: 'open' },
  { label: 'Qualified', hue: 'sky', outcome: 'open' },
  { label: 'Proposal', hue: 'blue', outcome: 'open' },
  { label: 'Won', hue: 'green', outcome: 'won' },
  { label: 'Lost', hue: 'red', outcome: 'lost' },
];

/** What a name another list holds answers (spec 0048, AC-4803). */
export const listNameTaken = (name: string) => `A list named ${name.trim()} already exists.`;

/**
 * `definitionGuard` for a list's own row: a name another list holds (ignoring
 * case, archived ones included) is `CONFIG_INVALID` on `name`, an API name
 * `SLUG_TAKEN` on `apiSlug`, an id `ID_TAKEN`.
 */
async function listGuard<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await definitionGuard(work);
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'SLUG_TAKEN' && error.refusal.field === undefined) {
      throw refuseOn('SLUG_TAKEN', 'A list already uses this API name. Pick another.', 'apiSlug');
    }
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'lists_name') {
      throw refuseOn('CONFIG_INVALID', listNameTaken(name), 'name');
    }
    if (pg?.code === '23505' && pg.constraint === 'lists_pkey') {
      throw refuse('ID_TAKEN', 'A list with that id already exists.');
    }
    throw error;
  }
}

/** A view's starting config: every list field and the object's name, one pinned, Added newest first. */
function listViewConfig(addedId: string, board?: ViewConfig['board']): ViewConfig {
  return {
    columns: [],
    showNewAttributes: true,
    pinnedCount: 1,
    sorts: [{ attributeId: addedId, direction: 'descending' }],
    ...(board === undefined ? {} : { board }),
  };
}

/** Inserts a view the workspace seeds on a list (no creator, so it stays shared). */
async function seedListView(
  context: Pick<WriteContext, 'tx' | 'scope'>,
  listId: string,
  view: {
    readonly name: string;
    readonly kind: 'table' | 'board';
    readonly position: number;
    readonly config: ViewConfig;
  },
): Promise<string> {
  const [row] = await context.tx
    .insert(views)
    .values({
      workspaceId: context.scope.workspaceId,
      listId,
      name: view.name,
      kind: view.kind,
      visibility: 'workspace',
      position: view.position,
      config: view.config,
      createdByType: 'system',
      updatedByType: 'system',
    })
    .returning({ id: views.id });
  if (row === undefined) throw new Error('The list view was not created.');
  return row.id;
}

/**
 * The list a create with this id already made (spec 0048): undefined when no
 * list holds the id, the list when this actor made it over the same object,
 * else `ID_TAKEN`.
 */
async function earlierList(
  tx: WorkspaceTx,
  scope: EngineScope,
  id: string,
  objectId: string,
): Promise<InsertedList | undefined> {
  const [row] = await tx
    .select({
      objectId: lists.objectId,
      defaultViewId: lists.defaultViewId,
      createdByType: lists.createdByType,
      createdById: lists.createdById,
    })
    .from(lists)
    .where(eq(lists.id, id));
  if (row === undefined) return undefined;
  const isOwnTry =
    row.objectId === objectId && row.createdByType === scope.actor.type && row.createdById === scope.actor.id;
  if (!isOwnTry || row.defaultViewId === null) throw refuse('ID_TAKEN', 'A list with that id already exists.');
  return { listId: id, defaultViewId: row.defaultViewId, replayed: true };
}

/**
 * Inserts a list, inside a write (spec 0048, AC-4801 to AC-4803): its row, the
 * read only Added and Added by fields, the template's fields (Pipeline: Stage
 * and Owner), its views (Blank: "All entries"; Pipeline: the "Pipeline" board
 * grouped by Stage, its default, then "All entries"), and the workspace's list
 * slot, which a full workspace refuses (`LIMIT_REACHED`, rolling it all back).
 */
export async function insertList(context: WriteContext, input: ListInput): Promise<InsertedList> {
  const { tx, scope } = context;
  checkSlug(input.apiSlug);
  checkName(input.name, 'list name', 'name');
  checkLook(input.icon, input.hue);
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (input.id !== undefined && !isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The list id must be a UUID v7.');
  const [object] = await tx
    .select({ archivedAt: objects.archivedAt })
    .from(objects)
    .where(eq(objects.id, objectId))
    .for('key share');
  if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  if (object.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
  const id = input.id?.toLowerCase();
  if (id !== undefined) {
    const earlier = await earlierList(tx, scope, id, objectId);
    if (earlier !== undefined) return earlier;
  }
  const name = input.name.trim();
  const listId = await listGuard(name, async () => {
    const [row] = await tx
      .insert(lists)
      .values({
        ...(id === undefined ? {} : { id }),
        workspaceId: scope.workspaceId,
        objectId,
        apiSlug: input.apiSlug,
        name,
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.hue === undefined ? {} : { hue: input.hue }),
        allowsDuplicates: input.allowsDuplicates ?? true,
        ...audit(scope),
      })
      .returning({ id: lists.id });
    if (row === undefined) throw new Error('The list was not created.');
    return row.id;
  });
  const system = await tx
    .insert(attributes)
    .values(
      SYSTEM_LIST_ATTRIBUTES.map((attribute, position) => ({
        workspaceId: scope.workspaceId,
        listId,
        ...attribute,
        isSystem: true,
        position,
        ...audit(scope),
      })),
    )
    .returning({ id: attributes.id, systemColumn: attributes.systemColumn });
  const addedId = system.find((attribute) => attribute.systemColumn === 'created_at')?.id;
  if (addedId === undefined) throw new Error('The list has no Added field.');
  let defaultViewId: string;
  if (input.template === 'pipeline') {
    const stages = PIPELINE_STAGES.map((stage) => ({ ...stage, id: newId() }));
    const stage = await insertAttribute(context, {
      listId,
      apiSlug: 'stage',
      title: 'Stage',
      type: 'status',
      options: stages,
    });
    // A new entry lands in the first column (AC-4802): Lead, not required, no target times.
    const lead = stages[0]?.id;
    if (lead !== undefined) {
      await tx
        .update(attributes)
        .set({ defaultValue: { kind: 'static', value: lead } })
        .where(eq(attributes.id, stage.attributeId));
    }
    const owner = await insertAttribute(context, {
      listId,
      apiSlug: 'owner',
      title: 'Owner',
      type: 'actor_reference',
    });
    defaultViewId = await seedListView(context, listId, {
      name: PIPELINE_VIEW,
      kind: 'board',
      position: 0,
      config: listViewConfig(addedId, {
        groupByAttributeId: stage.attributeId,
        cardFields: [owner.attributeId, addedId],
        showEmptyColumns: true,
      }),
    });
    await seedListView(context, listId, {
      name: ALL_ENTRIES_VIEW,
      kind: 'table',
      position: 1,
      config: listViewConfig(addedId),
    });
  } else {
    defaultViewId = await seedListView(context, listId, {
      name: ALL_ENTRIES_VIEW,
      kind: 'table',
      position: 0,
      config: listViewConfig(addedId),
    });
  }
  await tx.update(lists).set({ defaultViewId }).where(eq(lists.id, listId));
  // The list slot last, as every write takes the workspace counter row; a full workspace rolls the list back.
  await takeList(tx, scope);
  context.record({ definitions: [{ listId, objectId, attributeIds: [] }] });
  return { listId, defaultViewId, replayed: false };
}

/** Defines a list of one object's records (AC-6, AC-16): `lists.manage` and write on the object (spec 0048). */
export async function defineList(scope: EngineScope, input: ListInput, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'lists.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      // A hidden object answers as an unknown one; a read only one can't hold a new list (decision 2).
      await checkObject(context.tx, scope.access, checkId(input.objectId, 'That object does not exist.'), 'write');
      return insertList(context, input);
    },
    hooks,
  );
  return result;
}

/** Refuses a second live entry for a record in a list that lets each record in once. */
async function checkOnce(tx: WorkspaceTx, listId: string, recordId: string, except?: string): Promise<void> {
  const [existing] = await tx
    .select({ id: listEntries.id })
    .from(listEntries)
    .where(
      and(
        eq(listEntries.listId, listId),
        eq(listEntries.recordId, recordId),
        isNull(listEntries.deletedAt),
        except === undefined ? undefined : ne(listEntries.id, except),
      ),
    )
    .limit(1);
  if (existing !== undefined) throw refuse('ENTRY_EXISTS', 'That record is already in this list.');
}

/** What an entry id another entry holds answers (AC-4816). */
const ENTRY_ID_USED = 'That entry id is already used.';

/**
 * Adds a record to a list, with the entry's first values (defaults filled in,
 * required ones checked). The list row is locked first, so its count and the
 * once only rule hold under concurrent adds (AC-6, AC-16). With a client id,
 * the same add again answers the live entry already made for that list and
 * record, writing nothing; an id any other entry holds is `CONFIG_INVALID`
 * (spec 0048, AC-4816).
 */
export async function addEntry(
  scope: EngineScope,
  input: EntryInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ entryId: string; versions: Record<string, AttributeResult> }> {
  const listId = checkId(input.listId, 'That list does not exist.');
  const recordId = checkId(input.recordId, 'That record does not exist.');
  if (input.id !== undefined && !isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The entry id must be a UUID v7.');
  const id = input.id?.toLowerCase();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [list] = await tx
        .select({
          objectId: lists.objectId,
          name: lists.name,
          allowsDuplicates: lists.allowsDuplicates,
          archivedAt: lists.archivedAt,
        })
        .from(lists)
        .where(eq(lists.id, listId))
        .for('update');
      if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
      // A hidden list answers as an unknown one, before anything says it is archived; a read only one is 403.
      checkList(scope.access, { id: listId, objectId: list.objectId, name: list.name }, 'write');
      if (list.archivedAt !== null) throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
      if (id !== undefined) {
        // Under the list's lock, so a concurrent try with the same id has committed or not started.
        const [earlier] = await tx
          .select({ listId: listEntries.listId, recordId: listEntries.recordId, deletedAt: listEntries.deletedAt })
          .from(listEntries)
          .where(eq(listEntries.id, id));
        if (earlier !== undefined) {
          if (earlier.listId === listId && earlier.recordId === recordId && earlier.deletedAt === null) {
            return { entryId: id, versions: {} };
          }
          throw refuse('CONFIG_INVALID', ENTRY_ID_USED);
        }
      }
      // The record must be one the principal sees (spec 0009, AC-143); adding it changes the list, not the record.
      const record = await lockRecord(tx, recordId, scope.access);
      if (record.objectId !== list.objectId) {
        throw refuse('CONFIG_INVALID', "That record can't go in this list; it holds another object's records.");
      }
      if (!list.allowsDuplicates) await checkOnce(tx, listId, recordId);
      const listAttributes = await loadListAttributes(tx, listId);
      const parsed = await initialValues(tx, scope, listAttributes, input.values ?? {}, input.timeZone ?? 'UTC');
      await takeEntrySlots(tx, scope, listId, 1);
      const [row] = await tx
        .insert(listEntries)
        .values({
          ...(id === undefined ? {} : { id }),
          workspaceId: scope.workspaceId,
          listId,
          recordId,
          ...audit(scope),
        })
        .returning({ id: listEntries.id });
      if (row === undefined) throw new Error('The entry was not created.');
      context.record({ createdEntries: [{ entryId: row.id, listId, recordId, objectId: list.objectId }] });
      const versions = await writeAll(context, 'entry', row.id, parsed);
      return { entryId: row.id, versions };
    },
    hooks,
  );
  return result;
}

/**
 * An entry's list, record and the list's object, unlocked: none of them ever
 * changes, so a write can lock them first.
 */
async function entryParents(
  tx: WorkspaceTx,
  entryId: string,
): Promise<{ listId: string; recordId: string; objectId: string }> {
  checkId(entryId, 'That entry does not exist.');
  const [entry] = await tx
    .select({ listId: listEntries.listId, recordId: listEntries.recordId, objectId: lists.objectId })
    .from(listEntries)
    .innerJoin(lists, and(eq(lists.workspaceId, listEntries.workspaceId), eq(lists.id, listEntries.listId)))
    .where(eq(listEntries.id, entryId));
  if (entry === undefined) throw refuse('NOT_FOUND', 'That entry does not exist.');
  return entry;
}

/** Locks an entry's row whatever its state, after its list and record (the one lock order). */
async function lockAnyEntry(tx: WorkspaceTx, entryId: string) {
  const [entry] = await tx
    .select({
      deletedAt: listEntries.deletedAt,
      expired: sql<boolean>`${listEntries.deletedAt} < now() - ${RESTORE_WINDOW}::interval`,
    })
    .from(listEntries)
    .where(eq(listEntries.id, entryId))
    .for('update');
  if (entry === undefined) throw refuse('NOT_FOUND', 'That entry does not exist.');
  return entry;
}

/** Locks a list's row for the rest of the transaction, returning whether it lets each record in once. */
async function lockList(tx: WorkspaceTx, listId: string): Promise<{ allowsDuplicates: boolean; archived: boolean }> {
  const [list] = await tx
    .select({ allowsDuplicates: lists.allowsDuplicates, archivedAt: lists.archivedAt })
    .from(lists)
    .where(eq(lists.id, listId))
    .for('update');
  if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
  return { allowsDuplicates: list.allowsDuplicates, archived: list.archivedAt !== null };
}

/** Takes one entry out of its list inside a write; one already out changes nothing. */
async function removeIn(context: WriteContext, entryId: string): Promise<void> {
  const { tx, scope } = context;
  const { listId, recordId, objectId } = await entryParents(tx, entryId);
  await checkEntryAccess(tx, scope.access, { listId, recordId }, 'write');
  // The list, then the record (share, as lockEntry takes it), then the entry: a restore of the record
  // waits for this removal or this one for it, so neither leaves the entry's keys or unique values showing.
  const list = await lockList(tx, listId);
  if (list.archived) throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
  await tx.execute(sql`select 1 from records where id = ${recordId} for share`);
  const entry = await lockAnyEntry(tx, entryId);
  if (entry.deletedAt !== null) return;
  const by = actorRow(scope.actor);
  await tx
    .update(listEntries)
    .set({
      deletedAt: sql`clock_timestamp()`,
      deletedByType: by.type,
      deletedById: by.id,
      deletedByMemberId: by.memberId,
    })
    .where(eq(listEntries.id, entryId));
  await holdUniqueKeys(tx, [entryId]);
  await setEntryKeysLive(tx, entryId, false);
  await takeEntrySlots(tx, scope, listId, -1);
  context.record({ removedEntries: [{ entryId, listId, recordId, objectId }] });
}

/** Brings one entry back inside a write; one already live changes nothing. */
async function restoreIn(context: WriteContext, entryId: string): Promise<void> {
  const { tx, scope } = context;
  const { listId, recordId, objectId } = await entryParents(tx, entryId);
  await checkEntryAccess(tx, scope.access, { listId, recordId }, 'write');
  // The same lock order as addEntry: the list, then the record, then the entry.
  const list = await lockList(tx, listId);
  if (list.archived) throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
  const [record] = await tx
    .select({ deletedAt: records.deletedAt })
    .from(records)
    .where(eq(records.id, recordId))
    .for('no key update');
  const entry = await lockAnyEntry(tx, entryId);
  if (entry.deletedAt === null) return;
  if (entry.expired) throw refuse('NOT_FOUND', 'That entry was removed more than 30 days ago.');
  if (record === undefined) throw refuse('NOT_FOUND', 'That record does not exist.');
  if (record.deletedAt !== null) throw refuse('RECORD_DELETED', 'That record is in the trash. Restore it first.');
  if (!list.allowsDuplicates) await checkOnce(tx, listId, recordId, entryId);
  await takeEntrySlots(tx, scope, listId, 1);
  await releaseUniqueKeys(tx, scope.access, [entryId]);
  await tx
    .update(listEntries)
    .set({ deletedAt: null, deletedByType: null, deletedById: null, deletedByMemberId: null, ...touched(scope) })
    .where(eq(listEntries.id, entryId));
  await setEntryKeysLive(tx, entryId, true);
  context.record({ restoredEntries: [{ entryId, listId, recordId, objectId }] });
}

/** Removes an entry from its list. Its values stay, and it can come back for 30 days (AC-6). */
export async function removeEntry(
  scope: EngineScope,
  input: { readonly entryId: string },
  hooks: readonly AfterWrite[] = [],
) {
  const entryId = checkId(input.entryId, 'That entry does not exist.');
  await runWrite(scope, (context) => removeIn(context, entryId), hooks);
}

/** Brings a removed entry back within 30 days, unless its record is in the trash or the list now has it once already. */
export async function restoreEntry(
  scope: EngineScope,
  input: { readonly entryId: string },
  hooks: readonly AfterWrite[] = [],
) {
  const entryId = checkId(input.entryId, 'That entry does not exist.');
  await runWrite(scope, (context) => restoreIn(context, entryId), hooks);
}

/** The most entries one batch removes or restores (spec 0048). */
export const MAX_ENTRY_BATCH = 500;

/** One entry's outcome in a batch: done, or the refusal that kept it as it was. */
export interface EntryOutcome {
  readonly entryId: string;
  readonly refusal?: RefusalError['refusal'];
}

/**
 * Removes or restores up to 500 entries in one write (spec 0048, AC-4817,
 * AC-4818), answering each in the order asked. A refusal for one entry (a
 * hidden or unknown entry, a record in the trash, a record in an "Each record
 * once" list again, a full list) keeps that entry as it was and never fails the
 * others: every check refuses before that entry's first change. Entries are
 * taken list by list, then record by record, so two batches lock in one order.
 */
export async function changeEntries(
  scope: EngineScope,
  input: { readonly entryIds: readonly string[]; readonly action: 'remove' | 'restore' },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly EntryOutcome[]> {
  if (input.entryIds.length > MAX_ENTRY_BATCH) {
    throw refuse('CONFIG_INVALID', `Change at most ${String(MAX_ENTRY_BATCH)} entries at once.`);
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const ids = [...new Set(input.entryIds.filter(isUuid).map(canonicalId))];
      const parents =
        ids.length === 0
          ? []
          : await tx
              .select({ id: listEntries.id, listId: listEntries.listId, recordId: listEntries.recordId })
              .from(listEntries)
              .where(inArray(listEntries.id, ids));
      const ordered = [...parents].sort((a, b) =>
        a.listId !== b.listId ? (a.listId < b.listId ? -1 : 1) : a.recordId < b.recordId ? -1 : 1,
      );
      const outcomes = new Map<string, EntryOutcome>();
      for (const entry of ordered) {
        try {
          await (input.action === 'remove' ? removeIn(context, entry.id) : restoreIn(context, entry.id));
          outcomes.set(entry.id, { entryId: entry.id });
        } catch (error) {
          if (!isRefusal(error)) throw error;
          outcomes.set(entry.id, { entryId: entry.id, refusal: error.refusal });
        }
      }
      const missing = { code: 'NOT_FOUND' as const, message: 'That entry does not exist.' };
      return input.entryIds.map(
        (raw): EntryOutcome => outcomes.get(isUuid(raw) ? canonicalId(raw) : raw) ?? { entryId: raw, refusal: missing },
      );
    },
    hooks,
  );
  return result;
}

/** A read entry row, before its values. */
interface EntryRow {
  readonly id: string;
  readonly listId: string;
  readonly recordId: string;
  readonly createdAt: Date;
  readonly createdByType: Actor['type'];
  readonly createdById: string | null;
  readonly updatedAt: Date;
  readonly updatedByType: Actor['type'];
  readonly updatedById: string | null;
}

/**
 * Reads live entries (not removed, record not in the trash) with their own
 * values, in the order asked. Hidden is absent (spec 0009): an entry whose
 * list or object the principal can't see, or whose record is outside a record
 * rule, is left out, and so are the list attributes they can't see.
 */
async function readEntries(
  tx: WorkspaceTx,
  access: Access,
  where: ReturnType<typeof and>,
  visibleAlready = false,
): Promise<readonly EntryView[]> {
  const found: readonly EntryRow[] = await tx
    .select({
      id: listEntries.id,
      listId: listEntries.listId,
      recordId: listEntries.recordId,
      createdAt: listEntries.createdAt,
      createdByType: listEntries.createdByType,
      createdById: listEntries.createdById,
      updatedAt: listEntries.updatedAt,
      updatedByType: listEntries.updatedByType,
      updatedById: listEntries.updatedById,
    })
    .from(listEntries)
    .innerJoin(
      records,
      and(
        eq(records.workspaceId, listEntries.workspaceId),
        eq(records.id, listEntries.recordId),
        isNull(records.deletedAt),
      ),
    )
    .where(and(isNull(listEntries.deletedAt), where))
    .orderBy(asc(listEntries.id));
  const rows = isOpen(access) || visibleAlready ? found : await visibleEntries(tx, access, found);
  const listIds = [...new Set(rows.map((row) => row.listId))];
  const attributesByList = new Map(
    await Promise.all(listIds.map(async (id) => [id, await loadListAttributes(tx, id)] as const)),
  );
  const items = await currentItems(
    tx,
    rows.map((row) => row.id),
    undefined,
    { withCleared: true },
  );
  const itemsOf = bucketItems(items.filter((item) => !item.isCleared));
  // A cell's version is its newest row's (uuid v7, so the greatest), a cleared marker's included.
  const versionOf = new Map<string, string>();
  for (const item of items) {
    const key = `${item.ownerId}:${item.attributeId}`;
    const seen = versionOf.get(key);
    if (seen === undefined || item.versionId > seen) versionOf.set(key, item.versionId);
  }
  return rows.map((row): EntryView => {
    const createdBy: Actor = { type: row.createdByType, id: row.createdById };
    const updatedBy: Actor = { type: row.updatedByType, id: row.updatedById };
    const system: Record<string, unknown> = {
      id: row.id,
      created_at: row.createdAt.toISOString(),
      created_by: createdBy,
      updated_at: row.updatedAt.toISOString(),
      updated_by: updatedBy,
    };
    const values: Record<string, unknown> = {};
    const versions: Record<string, string> = {};
    for (const attribute of attributesByList.get(row.listId)?.values() ?? []) {
      if (!attributeVisible(access, attribute)) continue;
      if (attribute.systemColumn !== null) {
        values[attribute.id] = system[attribute.systemColumn];
        continue;
      }
      values[attribute.id] = decodeValue(attribute.type, attribute.isMulti, itemsOf(row.id, attribute.id));
      const version = versionOf.get(`${row.id}:${attribute.id}`);
      if (version !== undefined) versions[attribute.id] = version;
    }
    return {
      id: row.id,
      listId: row.listId,
      recordId: row.recordId,
      createdAt: row.createdAt.toISOString(),
      createdBy,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy,
      values,
      versions,
    };
  });
}

/** The entries among `rows` the principal may see: list and object not at `none`, record inside any record rule. */
export async function visibleEntries<T extends { readonly listId: string; readonly recordId: string }>(
  tx: WorkspaceTx,
  access: Access,
  rows: readonly T[],
): Promise<readonly T[]> {
  const listIds = [...new Set(rows.map((row) => row.listId))];
  if (listIds.length === 0) return rows;
  const parents = await tx
    .select({ id: lists.id, objectId: lists.objectId })
    .from(lists)
    .where(inArray(lists.id, listIds));
  const objectOf = new Map(parents.map((list) => [list.id, list.objectId]));
  const shown = (listId: string) => {
    const objectId = objectOf.get(listId);
    return objectId !== undefined && objectLevel(access, listId) !== 'none' && objectLevel(access, objectId) !== 'none';
  };
  const candidates = rows.filter((row) => shown(row.listId));
  const seen = await visibleRecords(
    tx,
    access,
    candidates.map((row) => ({ objectId: objectOf.get(row.listId) ?? '', recordId: row.recordId })),
  );
  return candidates.filter((row) => seen.has(row.recordId));
}

/** Reads live entries by id inside an open transaction, in the order of `ids`, as the principal may see them. */
export async function readEntriesById(
  tx: WorkspaceTx,
  access: Access,
  ids: readonly string[],
  /** The ids came from a page that already kept only entries the principal may see. */
  visibleAlready = false,
): Promise<readonly EntryView[]> {
  if (ids.length === 0) return [];
  // Keyed by the canonical spelling, the one the entries come back with.
  const order = new Map(ids.map((id, index) => [canonicalId(id), index]));
  const entries = await readEntries(tx, access, inArray(listEntries.id, [...ids]), visibleAlready);
  return [...entries].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Reads live entries by id, up to 500 at once. A malformed id names nothing, so it is left out like a missing one. */
export async function getEntries(scope: EngineScope, input: { readonly ids: readonly string[] }) {
  if (input.ids.length > 500) throw refuse('CONFIG_INVALID', 'Read at most 500 entries at once.');
  const ids = input.ids.filter(isUuid).map(canonicalId);
  if (ids.length === 0) return [];
  return inWorkspace(scope, (tx) => readEntries(tx, scope.access, inArray(listEntries.id, ids)));
}

/** Every live entry of one record, across its lists (a record page's "Lists" panel). */
export async function getRecordEntries(scope: EngineScope, input: { readonly recordId: string }) {
  const recordId = checkId(input.recordId, 'That record does not exist.');
  return inWorkspace(scope, (tx) => readEntries(tx, scope.access, eq(listEntries.recordId, recordId)));
}
