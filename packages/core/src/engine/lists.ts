// Lists and their entries (spec 0004, AC-6). A list collects records of one
// object; each entry has its own id, values and history, separate from the
// record's. Removing an entry hides it for 30 days, like a deleted record.
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { decodeValue } from './columns.ts';
import { checkName, checkSlug, definitionGuard, audit, touched } from './definitions.ts';
import { RESTORE_WINDOW, takeEntrySlots, takeList } from './limits.ts';
import { initialValues, writeAll, type AttributeResult } from './records.ts';
import { refuse } from './refusals.ts';
import { actorRow, type Actor, type EngineScope } from './scope.ts';
import { setEntryKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import { currentItems, loadListAttributes, lockRecord } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';

const { listEntries, lists, objects, records } = schema;

/** What a new list needs. `allowsDuplicates` false lets each record in once. */
export interface ListInput {
  readonly objectId: string;
  readonly apiSlug: string;
  readonly name: string;
  readonly allowsDuplicates?: boolean;
}

/** What a new entry needs: its list, its record, and its first values by list attribute id. */
export interface EntryInput {
  readonly listId: string;
  readonly recordId: string;
  readonly values?: Readonly<Record<string, unknown>>;
  /** The creator's time zone, for date defaults (UTC when absent). */
  readonly timeZone?: string;
}

/** An entry as screens and services read it: its own values by list attribute id. */
export interface EntryView {
  readonly id: string;
  readonly listId: string;
  readonly recordId: string;
  readonly createdAt: string;
  readonly createdBy: Actor;
  readonly updatedAt: string;
  readonly updatedBy: Actor;
  readonly values: Readonly<Record<string, unknown>>;
}

/** Inserts a list, inside a write. */
export async function insertList(context: WriteContext, input: ListInput): Promise<{ listId: string }> {
  const { tx, scope } = context;
  checkSlug(input.apiSlug);
  checkName(input.name, 'list name');
  const [object] = await tx
    .select({ archivedAt: objects.archivedAt })
    .from(objects)
    .where(eq(objects.id, input.objectId));
  if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
  if (object.archivedAt !== null) throw refuse('NOT_FOUND', 'That object is archived. Restore it first.');
  await takeList(tx, scope);
  return definitionGuard(async () => {
    const [row] = await tx
      .insert(lists)
      .values({
        workspaceId: scope.workspaceId,
        objectId: input.objectId,
        apiSlug: input.apiSlug,
        name: input.name.trim(),
        allowsDuplicates: input.allowsDuplicates ?? true,
        ...audit(scope),
      })
      .returning({ id: lists.id });
    if (row === undefined) throw new Error('The list was not created.');
    return { listId: row.id };
  });
}

/** Defines a list of one object's records (AC-6, AC-16). */
export async function defineList(scope: EngineScope, input: ListInput, hooks: readonly AfterWrite[] = []) {
  const { result } = await runWrite(scope, (context) => insertList(context, input), hooks);
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

/**
 * Adds a record to a list, with the entry's first values (defaults filled in,
 * required ones checked). The list row is locked first, so its count and the
 * once only rule hold under concurrent adds (AC-6, AC-16).
 */
export async function addEntry(
  scope: EngineScope,
  input: EntryInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ entryId: string; versions: Record<string, AttributeResult> }> {
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [list] = await tx
        .select({ objectId: lists.objectId, allowsDuplicates: lists.allowsDuplicates, archivedAt: lists.archivedAt })
        .from(lists)
        .where(eq(lists.id, input.listId))
        .for('update');
      if (list === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
      if (list.archivedAt !== null) throw refuse('NOT_FOUND', 'That list is archived. Restore it first.');
      const record = await lockRecord(tx, input.recordId);
      if (record.objectId !== list.objectId) {
        throw refuse('CONFIG_INVALID', "That record can't go in this list; it holds another object's records.");
      }
      if (!list.allowsDuplicates) await checkOnce(tx, input.listId, input.recordId);
      const attributes = await loadListAttributes(tx, input.listId);
      const parsed = await initialValues(tx, scope, attributes, input.values ?? {}, input.timeZone ?? 'UTC');
      await takeEntrySlots(tx, scope, input.listId, 1);
      const [row] = await tx
        .insert(listEntries)
        .values({ workspaceId: scope.workspaceId, listId: input.listId, recordId: input.recordId, ...audit(scope) })
        .returning({ id: listEntries.id });
      if (row === undefined) throw new Error('The entry was not created.');
      context.record({ createdEntries: [row.id] });
      const versions = await writeAll(context, 'entry', row.id, parsed);
      return { entryId: row.id, versions };
    },
    hooks,
  );
  return result;
}

async function lockAnyEntry(tx: WorkspaceTx, entryId: string) {
  const [entry] = await tx
    .select({
      listId: listEntries.listId,
      recordId: listEntries.recordId,
      deletedAt: listEntries.deletedAt,
      expired: sql<boolean>`${listEntries.deletedAt} < now() - ${RESTORE_WINDOW}::interval`,
    })
    .from(listEntries)
    .where(eq(listEntries.id, entryId))
    .for('update');
  if (entry === undefined) throw refuse('NOT_FOUND', 'That entry does not exist.');
  return entry;
}

/** Removes an entry from its list. Its values stay, and it can come back for 30 days (AC-6). */
export async function removeEntry(
  scope: EngineScope,
  input: { readonly entryId: string },
  hooks: readonly AfterWrite[] = [],
) {
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const entry = await lockAnyEntry(tx, input.entryId);
      if (entry.deletedAt !== null) return;
      // The entry, then its record (share), as lockEntry takes them: a restore of the record waits for this
      // removal or this one for it, so neither leaves the entry's keys or unique values showing.
      await tx.execute(sql`select 1 from records where id = ${entry.recordId} for share`);
      const by = actorRow(scope.actor);
      await tx
        .update(listEntries)
        .set({
          deletedAt: sql`clock_timestamp()`,
          deletedByType: by.type,
          deletedById: by.id,
          deletedByMemberId: by.memberId,
        })
        .where(eq(listEntries.id, input.entryId));
      await holdUniqueKeys(tx, [input.entryId]);
      await setEntryKeysLive(tx, input.entryId, false);
      await takeEntrySlots(tx, scope, entry.listId, -1);
      context.record({ removedEntries: [input.entryId] });
    },
    hooks,
  );
}

/** Brings a removed entry back within 30 days, unless its record is in the trash or the list now has it once already. */
export async function restoreEntry(
  scope: EngineScope,
  input: { readonly entryId: string },
  hooks: readonly AfterWrite[] = [],
) {
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const entry = await lockAnyEntry(tx, input.entryId);
      if (entry.deletedAt === null) return;
      if (entry.expired) throw refuse('NOT_FOUND', 'That entry was removed more than 30 days ago.');
      // The same lock order as addEntry: the list, then the record.
      const [list] = await tx
        .select({ allowsDuplicates: lists.allowsDuplicates })
        .from(lists)
        .where(eq(lists.id, entry.listId))
        .for('update');
      await lockRecord(tx, entry.recordId);
      if (list?.allowsDuplicates === false) await checkOnce(tx, entry.listId, entry.recordId, input.entryId);
      await takeEntrySlots(tx, scope, entry.listId, 1);
      await releaseUniqueKeys(tx, [input.entryId]);
      await tx
        .update(listEntries)
        .set({ deletedAt: null, deletedByType: null, deletedById: null, deletedByMemberId: null, ...touched(scope) })
        .where(eq(listEntries.id, input.entryId));
      await setEntryKeysLive(tx, input.entryId, true);
      context.record({ restoredEntries: [input.entryId] });
    },
    hooks,
  );
}

/** Reads live entries (not removed, record not in the trash) with their own values, in the order asked. */
async function readEntries(tx: WorkspaceTx, where: ReturnType<typeof and>): Promise<readonly EntryView[]> {
  const rows = await tx
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
  const listIds = [...new Set(rows.map((row) => row.listId))];
  const attributesByList = new Map(
    await Promise.all(listIds.map(async (id) => [id, await loadListAttributes(tx, id)] as const)),
  );
  const items = await currentItems(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row): EntryView => {
    const values: Record<string, unknown> = {};
    for (const attribute of attributesByList.get(row.listId)?.values() ?? []) {
      const mine = items.filter((item) => item.ownerId === row.id && item.attributeId === attribute.id);
      values[attribute.id] = decodeValue(attribute.type, attribute.isMulti, mine);
    }
    return {
      id: row.id,
      listId: row.listId,
      recordId: row.recordId,
      createdAt: row.createdAt.toISOString(),
      createdBy: { type: row.createdByType, id: row.createdById },
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: { type: row.updatedByType, id: row.updatedById },
      values,
    };
  });
}

/** Reads live entries by id inside an open transaction, in the order of `ids`. */
export async function readEntriesById(tx: WorkspaceTx, ids: readonly string[]): Promise<readonly EntryView[]> {
  if (ids.length === 0) return [];
  const order = new Map(ids.map((id, index) => [id, index]));
  const entries = await readEntries(tx, inArray(listEntries.id, [...ids]));
  return [...entries].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Reads live entries by id, up to 500 at once. */
export async function getEntries(scope: EngineScope, input: { readonly ids: readonly string[] }) {
  if (input.ids.length > 500) throw refuse('CONFIG_INVALID', 'Read at most 500 entries at once.');
  if (input.ids.length === 0) return [];
  return scope.db.withWorkspace(scope.workspaceId, (tx) => readEntries(tx, inArray(listEntries.id, [...input.ids])));
}

/** Every live entry of one record, across its lists (a record page's "Lists" panel). */
export async function getRecordEntries(scope: EngineScope, input: { readonly recordId: string }) {
  return scope.db.withWorkspace(scope.workspaceId, (tx) => readEntries(tx, eq(listEntries.recordId, input.recordId)));
}
