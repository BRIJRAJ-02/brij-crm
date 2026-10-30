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
import { limitsOf, RESTORE_WINDOW, takeEntrySlots, takeList } from './limits.ts';
import { bucketItems, initialValues, writeAll, type AttributeResult } from './records.ts';
import { canonicalId, checkId, isUuid, isUuidV7, newId, uuidArray } from './ids.ts';
import { isRefusal, postgresError, refuse, refuseOn, type RefusalError } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { setEntryKeysLive, syncNewSortKeys } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import { checkEntryAccess, currentItems, loadListAttributes, lockRecord } from './values.ts';
import { runWrite, type AfterWrite, type ValueChange, type WriteContext } from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { attributeVisible, checkList, checkObject, UNKNOWN_LIST, visibleRecords } from '../access/visibility.ts';
import { canManageList, listManagersSentence } from '../lists/manager.ts';

const { attributes, listEntries, lists, members, objects, records, views } = schema;

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

/** What a list's settings may change (AC-4829): its name, tile and the once only rule. */
export interface ListUpdate {
  readonly listId: string;
  readonly name?: string | undefined;
  readonly icon?: string | undefined;
  readonly hue?: string | undefined;
  readonly allowsDuplicates?: boolean | undefined;
}

/** The words of the once only refusal (AC-4830). Without an open view of every record, no count is named. */
const duplicatesWords = (count: number | undefined) =>
  count === undefined
    ? 'Some records are in this list more than once. Remove the extra entries first.'
    : `${count.toLocaleString('en')} ${count === 1 ? 'record is' : 'records are'} in this list more than once. Remove the extra entries first.`;

/**
 * A list's row locked for a change, with the caller known to manage it (AC-4834):
 * a list the caller can't read answers as an unknown one, a manager check
 * failing is 403 naming who may. Archived ones refuse unless `allowArchived`.
 */
async function lockManagedList(context: WriteContext, listId: string, allowArchived: boolean) {
  const { tx, scope } = context;
  const [list] = await tx
    .select({
      objectId: lists.objectId,
      name: lists.name,
      archivedAt: lists.archivedAt,
      createdByMemberId: lists.createdByMemberId,
      makerStatus: members.status,
      objectArchivedAt: sql<Date | null>`(select o.archived_at from objects o where o.workspace_id = ${lists.workspaceId} and o.id = ${lists.objectId})`,
    })
    .from(lists)
    .leftJoin(members, and(eq(members.workspaceId, lists.workspaceId), eq(members.id, lists.createdByMemberId)))
    .where(eq(lists.id, listId))
    .for('update', { of: lists });
  if (list === undefined) throw refuse('NOT_FOUND', UNKNOWN_LIST);
  // A list the caller can't read is an unknown one (AC-4835); a manager of it can read it.
  if (
    !isOpen(scope.access) &&
    (objectLevel(scope.access, list.objectId) === 'none' || objectLevel(scope.access, listId) === 'none')
  ) {
    throw refuse('NOT_FOUND', UNKNOWN_LIST);
  }
  if (!canManageList(scope, list, list.makerStatus === 'active')) {
    throw refuse('FORBIDDEN', await listManagersSentence(tx, scope, listId));
  }
  if (!allowArchived && (list.archivedAt !== null || list.objectArchivedAt !== null)) {
    throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
  }
  return list;
}

/**
 * Changes a list's name, tile or once only rule (spec 0048, AC-4829, AC-4830),
 * under the list's row lock, and records a `definitions` change naming the list.
 * The API name never changes. Refuses `FORBIDDEN` (not a manager),
 * `NOT_FOUND`, and `CONFIG_INVALID` for a name another list holds or turning
 * "Each record once" on while a record has two live entries.
 */
export async function changeList(scope: EngineScope, input: ListUpdate, hooks: readonly AfterWrite[] = []) {
  const listId = checkId(input.listId, UNKNOWN_LIST);
  if (input.name !== undefined) checkName(input.name, 'list name', 'name');
  checkLook(input.icon, input.hue);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const list = await lockManagedList(context, listId, false);
      if (input.allowsDuplicates === false) {
        const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(
          tx
            .select({ recordId: listEntries.recordId })
            .from(listEntries)
            .where(and(eq(listEntries.listId, listId), isNull(listEntries.deletedAt)))
            .groupBy(listEntries.recordId)
            .having(sql`count(*) > 1`)
            .as('repeated'),
        );
        const repeated = row?.count ?? 0;
        if (repeated > 0) {
          throw refuseOn(
            'CONFIG_INVALID',
            duplicatesWords(isOpen(scope.access) ? repeated : undefined),
            'allowsDuplicates',
          );
        }
      }
      const name = input.name?.trim();
      await listGuard(name ?? list.name, async () => {
        await tx
          .update(lists)
          .set({
            ...(name === undefined ? {} : { name }),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.hue === undefined ? {} : { hue: input.hue }),
            ...(input.allowsDuplicates === undefined ? {} : { allowsDuplicates: input.allowsDuplicates }),
            ...touched(scope),
          })
          .where(eq(lists.id, listId));
      });
      context.record({ definitions: [{ listId, objectId: list.objectId, attributeIds: [] }] });
      return { listId };
    },
    hooks,
  );
  return result;
}

/**
 * Archives a list or restores it (spec 0048, AC-4831): it leaves every
 * sidebar, picker and record page, and its entries are kept. Archived ones
 * still count toward the 500. Archiving an archived list or restoring a live
 * one changes nothing. Restoring a list whose object is archived is `NOT_FOUND`
 * ("Restore <object> first.").
 */
export async function setListArchived(
  scope: EngineScope,
  input: { readonly listId: string; readonly archived: boolean },
  hooks: readonly AfterWrite[] = [],
) {
  const listId = checkId(input.listId, UNKNOWN_LIST);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const list = await lockManagedList(context, listId, true);
      if (!input.archived && list.objectArchivedAt !== null) {
        throw refuse('NOT_FOUND', "That list's object is archived. Restore it first.");
      }
      const isArchived = list.archivedAt !== null;
      if (isArchived === input.archived) return { listId };
      await tx
        .update(lists)
        .set({ archivedAt: input.archived ? sql`clock_timestamp()` : null, ...touched(scope) })
        .where(eq(lists.id, listId));
      context.record({ definitions: [{ listId, objectId: list.objectId, attributeIds: [] }] });
      return { listId };
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

/** The list row an add reads while it holds the list's lock. */
interface LockedList {
  readonly objectId: string;
  readonly name: string;
  readonly allowsDuplicates: boolean;
  readonly entryCount: number;
}

/**
 * Locks a list's row for the rest of the write and checks the caller may add
 * to it: a hidden list answers as an unknown one, a read only one is 403, an
 * archived one (or one whose object is archived, AC-4832) `NOT_FOUND`.
 */
async function lockWritableList(context: WriteContext, listId: string): Promise<LockedList> {
  const { tx, scope } = context;
  const [list] = await tx
    .select({
      objectId: lists.objectId,
      name: lists.name,
      allowsDuplicates: lists.allowsDuplicates,
      entryCount: lists.entryCount,
      archivedAt: lists.archivedAt,
      objectArchivedAt: sql<Date | null>`(select o.archived_at from objects o where o.workspace_id = ${lists.workspaceId} and o.id = ${lists.objectId})`,
    })
    .from(lists)
    .where(eq(lists.id, listId))
    .for('update', { of: lists });
  if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
  // A hidden list answers as an unknown one, before anything says it is archived; a read only one is 403.
  checkList(scope.access, { id: listId, objectId: list.objectId, name: list.name }, 'write');
  // A list whose object is archived reads as archived too (AC-4832).
  if (list.archivedAt !== null || list.objectArchivedAt !== null) {
    throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
  }
  return list;
}

/**
 * One record into a locked list, inside a write: the record's lock, the retry
 * check, the object and once only rules, the entry's first values and its
 * slot. Refuses before its first change, so a batch can take it in a savepoint.
 */
async function addIn(
  context: WriteContext,
  input: {
    readonly listId: string;
    readonly recordId: string;
    readonly id: string | undefined;
    readonly values: Readonly<Record<string, unknown>> | undefined;
    readonly timeZone: string | undefined;
  },
  list: LockedList,
): Promise<{ entryId: string; versions: Record<string, AttributeResult> }> {
  const { tx, scope } = context;
  const { listId, recordId, id } = input;
  // The record must be one the principal sees (spec 0009, AC-143); adding it changes the list, not the record.
  const record = await lockRecord(tx, recordId, scope.access);
  if (id !== undefined) {
    // Under the list's lock, so a concurrent try with the same id has committed or not started. Only the add's
    // own maker gets the entry back, so an id never tells anyone else what a list holds.
    const [earlier] = await tx
      .select({
        listId: listEntries.listId,
        recordId: listEntries.recordId,
        deletedAt: listEntries.deletedAt,
        createdByType: listEntries.createdByType,
        createdById: listEntries.createdById,
      })
      .from(listEntries)
      .where(eq(listEntries.id, id));
    if (earlier !== undefined) {
      const isOwnTry =
        earlier.listId === listId &&
        earlier.recordId === recordId &&
        earlier.deletedAt === null &&
        earlier.createdByType === scope.actor.type &&
        earlier.createdById === scope.actor.id;
      if (isOwnTry) return { entryId: id, versions: {} };
      throw refuse('CONFIG_INVALID', ENTRY_ID_USED);
    }
  }
  if (record.objectId !== list.objectId) {
    throw refuse('CONFIG_INVALID', "That record can't go in this list; it holds another object's records.");
  }
  if (!list.allowsDuplicates) await checkOnce(tx, listId, recordId);
  const listAttributes = await loadListAttributes(tx, listId);
  const parsed = await initialValues(tx, scope, listAttributes, input.values ?? {}, input.timeZone ?? 'UTC');
  await takeEntrySlots(tx, scope, listId, 1);
  // An id another workspace's entry holds is invisible to the check above yet taken in the table: that is this
  // entry's refusal, never the whole batch's failure.
  const [row] = await tx
    .insert(listEntries)
    .values({
      ...(id === undefined ? {} : { id }),
      workspaceId: scope.workspaceId,
      listId,
      recordId,
      ...audit(scope),
    })
    .returning({ id: listEntries.id })
    .catch((error: unknown) => {
      if (postgresError(error)?.code === '23505') throw refuse('CONFIG_INVALID', ENTRY_ID_USED);
      throw error;
    });
  if (row === undefined) throw new Error('The entry was not created.');
  context.record({ createdEntries: [{ entryId: row.id, listId, recordId, objectId: list.objectId }] });
  const versions = await writeAll(context, 'entry', row.id, parsed);
  return { entryId: row.id, versions };
}

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
      const list = await lockWritableList(context, listId);
      return addIn(context, { listId, recordId, id, values: input.values, timeZone: input.timeZone }, list);
    },
    hooks,
  );
  return result;
}

/** The most records one batch adds (spec 0048). */
export const MAX_ADD_BATCH = 500;

/** One record's outcome in an add batch: its entry, or the refusal that kept it out. */
export interface AddOutcome {
  readonly recordId: string;
  readonly entryId?: string;
  readonly refusal?: RefusalError['refusal'];
}

/**
 * Adds up to 500 records to one list in one write (spec 0048, AC-4825). Each
 * record answers on its own: one the caller can't see answers `NOT_FOUND`
 * exactly as an unknown id, before anything else is said of it, so a hidden
 * record never reads as "already in"; then one in the trash, another
 * object's, one already in an "Each record once" list (`ENTRY_EXISTS`), a
 * missing required list field, or a full list keeps that record out and says
 * why, never failing the rest. The list's own checks (hidden, read only,
 * archived) refuse the call. `ids` are the entries' client minted UUID v7s,
 * one per record: the same batch again answers the entries it made.
 *
 * Set based: the list is locked once, then the records (in id order, the one
 * lock order), their visibility, earlier ids and existing entries are read in
 * one statement each, every new entry is inserted in one, and the list's
 * defaults are written for all of them in a few more, so a batch of 500 costs
 * about ten statements rather than eight a record.
 */
export async function addEntries(
  scope: EngineScope,
  input: {
    readonly listId: string;
    readonly recordIds: readonly string[];
    readonly ids?: readonly string[] | undefined;
    readonly timeZone?: string | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly AddOutcome[]> {
  if (input.recordIds.length > MAX_ADD_BATCH) {
    throw refuse('CONFIG_INVALID', `Add at most ${String(MAX_ADD_BATCH)} records at once.`);
  }
  if (input.ids !== undefined && input.ids.length !== input.recordIds.length) {
    throw refuse('CONFIG_INVALID', 'Give one entry id for each record.');
  }
  const listId = checkId(input.listId, 'That list does not exist.');
  const asked = input.recordIds.map((raw, index) => ({ raw, id: input.ids?.[index]?.toLowerCase() }));
  for (const each of asked) {
    if (each.id !== undefined && !isUuidV7(each.id)) throw refuse('CONFIG_INVALID', 'The entry id must be a UUID v7.');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const list = await lockWritableList(context, listId);
      const outcomes = await addMany(context, list, listId, asked, input.timeZone ?? 'UTC');
      const unknown = { code: 'NOT_FOUND' as const, message: 'That record does not exist.' };
      return asked.map(
        (each): AddOutcome =>
          (isUuid(each.raw) ? outcomes.get(canonicalId(each.raw)) : undefined) ?? {
            recordId: each.raw,
            refusal: unknown,
          },
      );
    },
    hooks,
  );
  return result;
}

/** One record a batch add was asked for: as given, and its entry's client id. */
interface AskedAdd {
  readonly raw: string;
  readonly id: string | undefined;
}

/** The parsed defaults every new entry of a list starts with. */
type Defaults = Awaited<ReturnType<typeof initialValues>>;

/**
 * The set based body of `addEntries`, inside its write with the list locked:
 * each record's outcome by its canonical id. A record named twice is added once.
 */
async function addMany(
  context: WriteContext,
  list: LockedList,
  listId: string,
  asked: readonly AskedAdd[],
  timeZone: string,
): Promise<ReadonlyMap<string, AddOutcome>> {
  const { tx, scope } = context;
  const outcomes = new Map<string, AddOutcome>();
  const refuseOne = (recordId: string, code: RefusalError['refusal']['code'], message: string) =>
    outcomes.set(recordId, { recordId, refusal: { code, message } });
  // The first client id given for each record.
  const clientId = new Map<string, string | undefined>();
  for (const each of asked) {
    if (!isUuid(each.raw)) continue;
    const recordId = canonicalId(each.raw);
    if (!clientId.has(recordId)) clientId.set(recordId, each.id);
  }
  const recordIds = [...clientId.keys()].sort();
  if (recordIds.length === 0) return outcomes;

  // 1. The records, locked as lockRecord locks one, in id order.
  const found = await tx
    .select({ id: records.id, objectId: records.objectId, deletedAt: records.deletedAt })
    .from(records)
    .where(inArray(records.id, recordIds))
    .orderBy(asc(records.id))
    .for('no key update');
  const foundById = new Map(found.map((row) => [row.id, row]));
  // 2. Which the caller may see. A hidden record answers as a missing one, before any other check names it.
  const seen = await visibleRecords(
    tx,
    scope.access,
    found.map((row) => ({ objectId: row.objectId, recordId: row.id })),
  );
  const open: string[] = [];
  for (const recordId of recordIds) {
    const row = foundById.get(recordId);
    if (row === undefined || !seen.has(recordId)) refuseOne(recordId, 'NOT_FOUND', 'That record does not exist.');
    else if (row.deletedAt !== null) {
      refuseOne(recordId, 'RECORD_DELETED', 'That record is in the trash. Restore it first.');
    } else open.push(recordId);
  }

  // 3. Client ids used before: the caller's own try answers its entry; any other is refused.
  const givenIds = open.flatMap((recordId) => {
    const id = clientId.get(recordId);
    return id === undefined ? [] : [id];
  });
  const earlier =
    givenIds.length === 0
      ? []
      : await tx
          .select({
            id: listEntries.id,
            listId: listEntries.listId,
            recordId: listEntries.recordId,
            deletedAt: listEntries.deletedAt,
            createdByType: listEntries.createdByType,
            createdById: listEntries.createdById,
          })
          .from(listEntries)
          .where(inArray(listEntries.id, givenIds));
  const earlierById = new Map(earlier.map((row) => [row.id, row]));
  const fresh: string[] = [];
  for (const recordId of open) {
    const id = clientId.get(recordId);
    const before = id === undefined ? undefined : earlierById.get(id);
    if (id !== undefined && before !== undefined) {
      const isOwnTry =
        before.listId === listId &&
        before.recordId === recordId &&
        before.deletedAt === null &&
        before.createdByType === scope.actor.type &&
        before.createdById === scope.actor.id;
      if (isOwnTry) outcomes.set(recordId, { recordId, entryId: id });
      else refuseOne(recordId, 'CONFIG_INVALID', ENTRY_ID_USED);
    } else if (foundById.get(recordId)?.objectId !== list.objectId) {
      refuseOne(recordId, 'CONFIG_INVALID', "That record can't go in this list; it holds another object's records.");
    } else fresh.push(recordId);
  }

  // 4. Each record once: those already in, in one statement. The list's lock holds the answer until commit.
  const alreadyIn = new Set<string>();
  if (!list.allowsDuplicates && fresh.length > 0) {
    const rows = await tx
      .selectDistinct({ recordId: listEntries.recordId })
      .from(listEntries)
      .where(and(eq(listEntries.listId, listId), inArray(listEntries.recordId, fresh), isNull(listEntries.deletedAt)));
    for (const row of rows) alreadyIn.add(row.recordId);
  }
  const toAdd: string[] = [];
  for (const recordId of fresh) {
    if (alreadyIn.has(recordId)) refuseOne(recordId, 'ENTRY_EXISTS', 'That record is already in this list.');
    else toAdd.push(recordId);
  }
  if (toAdd.length === 0) return outcomes;

  // 5. The list's defaults, the same for every new entry; a missing required field refuses them all.
  const refuseAllOf = (ids: readonly string[], refusals: readonly RefusalError['refusal'][]) => {
    const [first] = refusals;
    for (const recordId of ids)
      outcomes.set(recordId, { recordId, ...(first === undefined ? {} : { refusal: first }) });
  };
  let defaults: Defaults;
  try {
    defaults = await initialValues(tx, scope, await loadListAttributes(tx, listId), {}, timeZone);
  } catch (error) {
    if (!isRefusal(error)) throw error;
    refuseAllOf(toAdd, error.refusals);
    return outcomes;
  }
  // A unique or linking default can't be copied from one entry to the next: such a list takes one record at a time.
  if (defaults.some(({ attribute }) => attribute.isUnique || attribute.type === 'record_reference')) {
    for (const recordId of toAdd) {
      const done = await context.perRecord((part) =>
        addIn(part, { listId, recordId, id: clientId.get(recordId), values: undefined, timeZone }, list),
      );
      const [refusal] = done.ok ? [] : done.refusals;
      outcomes.set(
        recordId,
        done.ok
          ? { recordId, entryId: done.value.entryId }
          : { recordId, ...(refusal === undefined ? {} : { refusal }) },
      );
    }
    return outcomes;
  }

  // 6. A full list keeps the ones past its room out, in id order.
  const limit = limitsOf(scope).entriesPerList;
  const room = Math.max(0, limit - list.entryCount);
  const fits = toAdd.slice(0, room);
  for (const recordId of toAdd.slice(room)) {
    refuseOne(recordId, 'LIMIT_REACHED', `A list holds at most ${limit.toLocaleString('en')} entries.`);
  }
  if (fits.length === 0) return outcomes;

  // 7. Every entry in one insert, their slots in one update, the defaults for all of them in a few more.
  const done = await context.perRecord(async (part) => {
    const rows = await part.tx
      .insert(listEntries)
      .values(
        fits.map((recordId) => {
          const id = clientId.get(recordId);
          return {
            ...(id === undefined ? {} : { id }),
            workspaceId: scope.workspaceId,
            listId,
            recordId,
            ...audit(scope),
          };
        }),
      )
      .returning({ id: listEntries.id, recordId: listEntries.recordId });
    await takeEntrySlots(part.tx, scope, listId, rows.length);
    part.record({
      createdEntries: rows.map((row) => ({ entryId: row.id, listId, recordId: row.recordId, objectId: list.objectId })),
    });
    await writeDefaults(
      part,
      rows.map((row) => row.id),
      defaults,
    );
    return rows;
  });
  if (!done.ok) {
    refuseAllOf(fits, done.refusals);
    return outcomes;
  }
  for (const row of done.value) outcomes.set(row.recordId, { recordId: row.recordId, entryId: row.id });
  return outcomes;
}

/**
 * Writes the same default values onto many new entries: the first through
 * the one value write (its checks, its hold on the definitions, its sort
 * keys), then every other entry's rows copied from the first's in one
 * statement, each (entry, attribute) under a version of its own, and their
 * sort keys in one more.
 */
async function writeDefaults(context: WriteContext, entryIds: readonly string[], defaults: Defaults): Promise<void> {
  const [first, ...rest] = entryIds;
  if (first === undefined || defaults.length === 0) return;
  const { tx } = context;
  const results = await writeAll(context, 'entry', first, defaults);
  const written = defaults.filter(({ attribute }) => results[attribute.id]?.versionId !== undefined);
  if (rest.length === 0 || written.length === 0) return;
  const attributeIds = written.map(({ attribute }) => attribute.id);
  const copied = await tx.execute<{ owner_id: string; attribute_id: string; version_id: string }>(sql`
    with targets as (
      select owner_id, attribute_id, uuidv7() as version_id
      from unnest(${uuidArray(rest)}) as owner_id
      cross join unnest(${uuidArray(attributeIds)}) as attribute_id
    ), inserted as (
      insert into "values" (
        workspace_id, version_id, attribute_id, entry_id, owner_id, position, is_cleared, text_value, number_value,
        date_value, timestamp_value, bool_value, option_id, actor_type, actor_id, actor_member_id, json_value,
        active_from, set_by_type, set_by_id, set_by_member_id
      )
      select v.workspace_id, t.version_id, v.attribute_id, t.owner_id, t.owner_id, v.position, v.is_cleared,
        v.text_value, v.number_value, v.date_value, v.timestamp_value, v.bool_value, v.option_id, v.actor_type,
        v.actor_id, v.actor_member_id, v.json_value, v.active_from, v.set_by_type, v.set_by_id, v.set_by_member_id
      from "values" v join targets t on t.attribute_id = v.attribute_id
      where v.owner_id = ${first}::uuid and v.attribute_id = any(${uuidArray(attributeIds)}) and v.active_until is null
      returning owner_id, attribute_id, version_id
    )
    select distinct owner_id::text, attribute_id::text, version_id::text from inserted
  `);
  await syncNewSortKeys(
    tx,
    rest,
    written.map(({ attribute }) => attribute),
  );
  const listOf = new Map(written.map(({ attribute }) => [attribute.id, attribute.listId ?? '']));
  context.record({
    values: copied.rows.map((row): ValueChange => ({
      ownerKind: 'entry',
      ownerId: row.owner_id,
      attributeId: row.attribute_id,
      versionId: row.version_id,
      listId: listOf.get(row.attribute_id) ?? '',
    })),
  });
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
    .select({
      allowsDuplicates: lists.allowsDuplicates,
      archivedAt: lists.archivedAt,
      objectArchivedAt: sql<Date | null>`(select o.archived_at from objects o where o.workspace_id = ${lists.workspaceId} and o.id = ${lists.objectId})`,
    })
    .from(lists)
    .where(eq(lists.id, listId))
    .for('update', { of: lists });
  if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
  // A list whose object is archived reads as archived too (AC-4832).
  return {
    allowsDuplicates: list.allowsDuplicates,
    archived: list.archivedAt !== null || list.objectArchivedAt !== null,
  };
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
        // Its own savepoint: a refusal after a change (a unique value taken meanwhile, past the count's move) rolls
        // that entry back whole, and the others go on.
        const done = await context.perRecord((part) =>
          input.action === 'remove' ? removeIn(part, entry.id) : restoreIn(part, entry.id),
        );
        const [refusal] = done.ok ? [] : done.refusals;
        outcomes.set(entry.id, refusal === undefined ? { entryId: entry.id } : { entryId: entry.id, refusal });
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
