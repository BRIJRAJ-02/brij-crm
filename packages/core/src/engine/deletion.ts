// Deleting, restoring, purging and erasing records (spec 0004, AC-8, AC-18).
// A delete hides the record, and with it its links and entries (every read
// joins records and skips deleted ones), without touching the records on the
// other side. A restore within 30 days brings all three back. The purge and
// erasure are the only hard deletes, each counted. Stored sort keys follow:
// hidden on delete, shown on restore, removed before their values. The hooks
// hear about everything that appears or disappears: the record, its entries,
// and the reference values on the records it links to.
//
// The workspace's counters row is the busiest lock in a workspace (every
// create and, from #7, every write's outbox number takes it), so every write
// takes it last (spec 0005, the outbox): each step here does its reads and
// its heavy work first and takes or gives back its record slot at the end,
// holding the row only while its transaction finishes.
import { eq, sql, type SQL } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkInstant } from './history.ts';
import { checkId, newId, uuidArray } from './ids.ts';
import { RESTORE_WINDOW, takeRecordSlots } from './limits.ts';
import { refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { deleteSortKeys, setRecordKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import {
  CHANGE_CAP,
  runWrite,
  type AfterWrite,
  type EntryRef,
  type RecordRef,
  type ReferenceChange,
  type WriteContext,
} from './write.ts';
import { requirePermission } from '../access/check.ts';
import type { Access } from '../access/policy.ts';
import { checkObject, checkRecordVisible, UNKNOWN_RECORD } from '../access/visibility.ts';

const { records } = schema;

/** Where a record stands. */
export type RecordState = 'live' | 'deleted';

/**
 * Locks a record's row whatever its state, or refuses `NOT_FOUND`: also for a
 * record the principal can't see (a hidden object, or outside its record
 * rule), and `FORBIDDEN` on an object they may only read (spec 0009).
 */
async function lockAnyRecord(tx: WorkspaceTx, recordId: string, access: Access) {
  const row = await lockedRecord(tx, recordId);
  await checkObject(tx, access, row.objectId, 'read', UNKNOWN_RECORD);
  await checkRecordVisible(tx, access, { objectId: row.objectId, recordId });
  await checkObject(tx, access, row.objectId, 'write');
  return row;
}

async function lockedRecord(tx: WorkspaceTx, recordId: string) {
  const [row] = await tx
    .select({
      objectId: records.objectId,
      deletedAt: records.deletedAt,
      expired: sql<boolean>`${records.deletedAt} < now() - ${RESTORE_WINDOW}::interval`,
    })
    .from(records)
    .where(eq(records.id, recordId))
    .for('no key update');
  if (row === undefined) throw refuse('NOT_FOUND', 'That record does not exist.');
  return row;
}

/** A record's entries still in their lists: their unique keys go with the record's. */
export async function liveEntries(tx: WorkspaceTx, record: RecordRef): Promise<readonly EntryRef[]> {
  const result = await tx.execute<{ id: string; list_id: string }>(
    sql`select id::text, list_id::text from list_entries where record_id = ${record.recordId} and deleted_at is null`,
  );
  return result.rows.map((row) => ({
    entryId: row.id,
    listId: row.list_id,
    recordId: record.recordId,
    objectId: record.objectId,
  }));
}

/**
 * The most far records `farReferences` collects through one relationship end:
 * one past the cap, enough to know the object goes coarse (spec 0007, AC-83).
 */
export const FAR_LIMIT = CHANGE_CAP + 1;

/**
 * The statement behind `farReferences`, exported for the plan test. `ends`
 * holds, per relationship with an end on the object, the attribute the far
 * record shows this one through when it is the from end (`via_to`, if the
 * to end has an attribute) and when it is the to end (`via_from`, a two way
 * end on its object or a one way reference naming it). Each end reads at most
 * `FAR_LIMIT` live far records (spec 0007, AC-83), each one primary key probe:
 * the limit counts live records, so links to records in the trash are probed
 * and skipped until it is reached (memory stays bounded; time grows with the
 * trashed far records, and runs before the counter row is taken). `end_key`
 * names the end, so the caller knows which ones were cut short.
 */
export function farReferencesQuery(recordId: string, objectId: string): SQL {
  return sql`
    with ends as materialized (
      select rel.workspace_id, rel.id as relationship_id,
        case when fa.object_id = ${objectId}::uuid then rel.to_attribute_id end as via_to,
        case when ta.object_id = ${objectId}::uuid or ${objectId}::uuid = any(rel.target_object_ids)
          then rel.from_attribute_id end as via_from
      from relationships rel
      join attributes fa on fa.workspace_id = rel.workspace_id and fa.id = rel.from_attribute_id
      left join attributes ta on ta.workspace_id = rel.workspace_id and ta.id = rel.to_attribute_id
      where fa.object_id = ${objectId}::uuid or ta.object_id = ${objectId}::uuid
        or ${objectId}::uuid = any(rel.target_object_ids)
    )
    select far.id::text as record_id, far.object_id::text as object_id, e.via_to::text as attribute_id,
      e.relationship_id::text || ':to' as end_key
    from ends e
    cross join lateral (
      select r.id, r.object_id
      from record_links l
      cross join lateral (
        select r.id, r.object_id from records r
        where r.workspace_id = l.workspace_id and r.id = l.to_record_id and r.deleted_at is null
        -- Keeps the lookup its own subquery: one primary key probe per link, never a hash join over all of records.
        offset 0
      ) r
      where l.workspace_id = e.workspace_id and l.relationship_id = e.relationship_id
        and l.from_record_id = ${recordId}::uuid and l.active_until is null
      limit ${FAR_LIMIT}
    ) far
    where e.via_to is not null
    union all
    select far.id::text, far.object_id::text, e.via_from::text, e.relationship_id::text || ':from'
    from ends e
    cross join lateral (
      select r.id, r.object_id
      from record_links l
      cross join lateral (
        select r.id, r.object_id from records r
        where r.workspace_id = l.workspace_id and r.id = l.from_record_id and r.deleted_at is null
        offset 0
      ) r
      where l.workspace_id = e.workspace_id and l.relationship_id = e.relationship_id
        and l.to_record_id = ${recordId}::uuid and l.active_until is null
      limit ${FAR_LIMIT}
    ) far
    where e.via_from is not null
  `;
}

/**
 * The reference values on live records that show this record: the far end of
 * each of its current links, where that end has an attribute. A delete, a
 * restore or an erasure of the record changes them with no new version. At
 * most `FAR_LIMIT` far records per relationship end (spec 0007, AC-83): an end
 * cut short names its object in `coarseObjects`, so the outbox names the
 * object coarse and no hook ever holds every link of a record with 200,000
 * (the audit log, #36, names the record and its link count instead). The
 * read goes per object: first the ends of the
 * relationships on the record's object, worked out once and materialised (a
 * handful of rows), then each end's current links looked up by relationship
 * and record (`record_links_from` and `record_links_to` lead with both), so a
 * record's links cost index lookups, never a scan of `record_links`: stale
 * statistics can't fold the ends into a plan that scans the links once per
 * relationship. Each far record is then one primary key probe: with fresh
 * statistics and a record linked from a great many others, a plain join
 * became a hash join over a scan of all of `records`, and the sort spilled to
 * disk. So the probe is a lateral subquery the planner can't fold into a
 * join, and the rows are sorted here instead of in SQL. A test pins the plan,
 * with sequential scans allowed. Every caller runs it before it takes the
 * workspace counter row, so this read never holds that lock.
 */
export async function farReferences(
  tx: WorkspaceTx,
  record: RecordRef,
): Promise<{ readonly references: readonly ReferenceChange[]; readonly coarseObjects: readonly string[] }> {
  const { recordId, objectId } = record;
  const result = await tx.execute<{ record_id: string; object_id: string; attribute_id: string; end_key: string }>(
    farReferencesQuery(recordId, objectId),
  );
  // An end that came back full was cut short: its object goes coarse.
  const perEnd = new Map<string, { count: number; objectId: string }>();
  for (const row of result.rows) {
    const end = perEnd.get(row.end_key) ?? { count: 0, objectId: row.object_id };
    end.count += 1;
    perEnd.set(row.end_key, end);
  }
  const coarseObjects = [
    ...new Set([...perEnd.values()].flatMap((end) => (end.count >= FAR_LIMIT ? [end.objectId] : []))),
  ];
  // By object, record, then attribute, as the hooks have always seen them. Ids are lower case uuids, so
  // comparing the text compares them as Postgres would.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const references = result.rows
    .map((row) => ({ recordId: row.record_id, objectId: row.object_id, attributeId: row.attribute_id }))
    .sort(
      (a, b) =>
        compare(a.objectId, b.objectId) || compare(a.recordId, b.recordId) || compare(a.attributeId, b.attributeId),
    );
  return { references, coarseObjects };
}

/**
 * Moves a record to the trash: it, its links and its entries disappear from
 * every read at once, its unique values stop blocking others, and its record
 * slot comes back. Deleting a deleted record changes nothing.
 */
export async function deleteRecord(
  scope: EngineScope,
  input: { readonly recordId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ recordId: string; state: RecordState }> {
  const recordId = checkId(input.recordId, 'That record does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const record = await lockAnyRecord(tx, recordId, scope.access);
      if (record.deletedAt !== null) return { recordId, state: 'deleted' as const };
      const by = actorRow(scope.actor);
      await tx
        .update(records)
        // The time after the lock, so no value written before the delete looks later than it.
        .set({
          deletedAt: sql`clock_timestamp()`,
          deletedByType: by.type,
          deletedById: by.id,
          deletedByMemberId: by.memberId,
          // Every delete carries a batch (spec 0022): a delete of one record is a batch of its own.
          deletedBatchId: newId(),
          // Every statement that updates the row moves the revision (spec 0006, AC-44).
          revision: sql`${records.revision} + 1`,
        })
        .where(eq(records.id, recordId));
      const ref = { recordId, objectId: record.objectId };
      const entries = await liveEntries(tx, ref);
      const far = await farReferences(tx, ref);
      await holdUniqueKeys(tx, [recordId, ...entries.map((entry) => entry.entryId)]);
      await setRecordKeysLive(tx, recordId, false);
      // Last, as every write takes the counter row.
      await takeRecordSlots(tx, scope, -1);
      context.record({ deletedRecords: [ref], hiddenEntries: entries, ...far });
      return { recordId, state: 'deleted' as const };
    },
    hooks,
  );
  return result;
}

/**
 * Brings a record back from the trash within 30 days, with its links and
 * entries. Refuses `UNIQUE_CONFLICT`, listing the values, when another record
 * took one of its unique values meanwhile (AC-8).
 */
export async function restoreRecord(
  scope: EngineScope,
  input: { readonly recordId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ recordId: string; state: RecordState }> {
  const recordId = checkId(input.recordId, 'That record does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const record = await lockAnyRecord(tx, recordId, scope.access);
      if (record.deletedAt === null) return { recordId, state: 'live' as const };
      if (record.expired) throw refuse('NOT_FOUND', 'That record was deleted more than 30 days ago.');
      const ref = { recordId, objectId: record.objectId };
      const entries = await liveEntries(tx, ref);
      const far = await farReferences(tx, ref);
      await releaseUniqueKeys(tx, scope.access, [recordId, ...entries.map((entry) => entry.entryId)]);
      await tx
        .update(records)
        .set({
          deletedAt: null,
          deletedByType: null,
          deletedById: null,
          deletedByMemberId: null,
          deletedBatchId: null,
          revision: sql`${records.revision} + 1`,
        })
        .where(eq(records.id, recordId));
      await setRecordKeysLive(tx, recordId, true);
      // Last, as every write takes the counter row (a create checks its slot after its values too). A full
      // workspace refuses here, and the refusal rolls back everything above.
      await takeRecordSlots(tx, scope, 1);
      context.record({ restoredRecords: [ref], shownEntries: entries, ...far });
      return { recordId, state: 'live' as const };
    },
    hooks,
  );
  return result;
}

/** How many rows a hard delete removed, per table. */
export interface RemovedCounts {
  readonly records: number;
  readonly entries: number;
  readonly values: number;
  readonly links: number;
}

const NONE: RemovedCounts = { records: 0, entries: 0, values: 0, links: 0 };

function add(a: RemovedCounts, b: RemovedCounts): RemovedCounts {
  return {
    records: a.records + b.records,
    entries: a.entries + b.entries,
    values: a.values + b.values,
    links: a.links + b.links,
  };
}

/** What a hard delete removed: the counts, and the records and entries that went. */
interface Removed {
  readonly counts: RemovedCounts;
  readonly records: readonly RecordRef[];
  readonly entries: readonly EntryRef[];
}

/** Entries a delete returned (`id`, `list_id`, `record_id`, `object_id`), as refs. */
function entryRefs(
  rows: readonly { id: string; list_id: string; record_id: string; object_id: string }[],
): readonly EntryRef[] {
  return rows.map((row) => ({
    entryId: row.id,
    listId: row.list_id,
    recordId: row.record_id,
    objectId: row.object_id,
  }));
}

/**
 * The statement that hard deletes every value of some records and of their
 * entries, past versions too. The owners are one array, worked out once, so
 * the owner index finds the rows: an `or` with a subquery here scanned all of
 * `values`. A test pins the plan.
 */
export function deleteRecordValues(recordIds: readonly string[]): SQL {
  const ids = uuidArray(recordIds);
  return sql`
    delete from "values" where owner_id = any(array(
      select unnest(${ids}) union all select id from list_entries where record_id = any(${ids})
    ))
  `;
}

/** The statement that hard deletes every value of some entries, past versions too, through the owner index. */
export function deleteEntryValues(entryIds: readonly string[]): SQL {
  return sql`delete from "values" where owner_id = any(${uuidArray(entryIds)})`;
}

/**
 * Hard deletes some records and everything that hangs off them, in foreign
 * key order: values (the records' and their entries'), links, entries, then
 * the records. Entries still in their lists give their slots back: their
 * lists are locked first, in id order, the order erasure and entry writes
 * take lists in, so none of them waits on another holding a list it needs.
 * Every step finds its rows through an index that leads with the owner or
 * record.
 */
async function removeRecords(tx: WorkspaceTx, recordIds: readonly string[]): Promise<Removed> {
  if (recordIds.length === 0) return { counts: NONE, records: [], entries: [] };
  const ids = uuidArray(recordIds);
  await tx.execute(sql`
    select 1 from lists
    where id in (select list_id from list_entries where record_id = any(${ids}) and deleted_at is null)
    order by id for no key update
  `);
  await tx.execute(sql`
    update lists l set entry_count = l.entry_count - gone.n
    from (
      select list_id, count(*)::int as n from list_entries
      where record_id = any(${ids}) and deleted_at is null group by list_id
    ) gone
    where l.id = gone.list_id
  `);
  await deleteSortKeys(tx, { recordIds });
  const values = await tx.execute(deleteRecordValues(recordIds));
  const links = await tx.execute(
    sql`delete from record_links where from_record_id = any(${ids}) or to_record_id = any(${ids})`,
  );
  const entries = await tx.execute<{ id: string; list_id: string; record_id: string; object_id: string }>(sql`
    delete from list_entries e using records r
    where e.record_id = any(${ids}) and r.workspace_id = e.workspace_id and r.id = e.record_id
    returning e.id::text, e.list_id::text, e.record_id::text, r.object_id::text
  `);
  const removed = await tx.execute<{ id: string; object_id: string }>(
    sql`delete from records where id = any(${ids}) returning id::text, object_id::text`,
  );
  return {
    counts: {
      records: removed.rows.length,
      entries: entries.rows.length,
      values: values.rowCount ?? 0,
      links: links.rowCount ?? 0,
    },
    records: removed.rows.map((row) => ({ recordId: row.id, objectId: row.object_id })),
    entries: entryRefs(entries.rows),
  };
}

/** What one purge batch removed, and whether it took a whole batch of either kind (so another may follow). */
export interface PurgeBatchResult {
  readonly counts: RemovedCounts;
  readonly full: boolean;
}

/** What a purge takes: a cutoff (never inside the restore window) and a batch size of 1 to 10,000 (500). */
export interface PurgeInput {
  readonly cutoff?: string;
  readonly batchSize?: number;
}

/** The checked batch size and the cutoff as SQL: the given one, or `RESTORE_WINDOW` ago, whichever is earlier. */
function purgeSettings(input: PurgeInput): { readonly batchSize: number; readonly cutoff: SQL } {
  const batchSize = input.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw refuse('CONFIG_INVALID', 'Purge 1 to 10,000 rows at a time.');
  }
  // Checked first, so only a full instant with its zone reaches the cast.
  const given =
    input.cutoff === undefined
      ? undefined
      : checkInstant(input.cutoff, 'Give the cutoff as an ISO timestamp with its zone, such as 2026-10-01T00:00:00Z.');
  // Never inside the restore window, whatever cutoff is given.
  const window = sql`now() - ${RESTORE_WINDOW}::interval`;
  return { batchSize, cutoff: given === undefined ? window : sql`least(${given}::timestamptz, ${window})` };
}

/**
 * The purge's pick of trashed records, oldest first, unlocked: exported for
 * the plan test, which pins it to `records_trashed_at` with no sort.
 */
export function purgeRecordPick(workspaceId: string, cutoff: SQL, limit: number): SQL {
  return sql`
    select id::text from records where workspace_id = ${workspaceId} and deleted_at < ${cutoff}
    order by deleted_at, id limit ${limit}
  `;
}

/** The purge's pick of removed entries, oldest first, locked (skipping held ones): pinned to `list_entries_trashed_at`. */
export function purgeEntryPick(workspaceId: string, cutoff: SQL, limit: number): SQL {
  return sql`
    select id::text from list_entries where workspace_id = ${workspaceId} and deleted_at < ${cutoff}
    order by deleted_at, id limit ${limit} for update skip locked
  `;
}

/**
 * One purge batch, in the caller's write (spec 0008, milestone 3: the daily
 * cleanup's `maintenance.daily` runs it, one batch a step): at most
 * `batchSize` records deleted before the cutoff, with their values, links and
 * entries, and at most `batchSize` entries removed before it, with their
 * values. It takes its locks in the order entry writes take them: it picks
 * the doomed records first without locking them, then locks the lists their
 * entries are in (in id order, as erasure and `removeRecords` do), and only
 * then the records, skipping any a restore holds and any restored since the
 * pick. `full` says a whole batch was picked, so another may follow; a row a
 * restore held waits for the next batch.
 */
export async function purgeBatch(context: WriteContext, input: PurgeInput = {}): Promise<PurgeBatchResult> {
  requirePermission(context.scope, 'records.purge');
  const { batchSize, cutoff } = purgeSettings(input);
  const { tx, scope } = context;
  // Picked, not locked: a row lock taken here, before the lists, is the order that deadlocked with entry writes.
  // Read in order from `records_trashed_at` (workspace, deleted_at, id), never the whole trash sorted.
  const picked = await tx.execute<{ id: string }>(purgeRecordPick(scope.workspaceId, cutoff, batchSize));
  const pickedIds = picked.rows.map((row) => row.id);
  let doomedIds: readonly string[] = [];
  if (pickedIds.length > 0) {
    const ids = uuidArray(pickedIds);
    await tx.execute(sql`
      select 1 from lists
      where workspace_id = ${scope.workspaceId}
        and id in (
          select list_id from list_entries
          where workspace_id = ${scope.workspaceId} and record_id = any(${ids}) and deleted_at is null
        )
      order by id for no key update
    `);
    // Still in the trash past the cutoff under the lock (a restore that committed since the pick is left alone).
    const locked = await tx.execute<{ id: string }>(sql`
      select id::text from records
      where workspace_id = ${scope.workspaceId} and id = any(${ids}) and deleted_at < ${cutoff}
      order by id for update skip locked
    `);
    doomedIds = locked.rows.map((row) => row.id);
  }
  const gone = await removeRecords(tx, doomedIds);
  const removedEntries = await tx.execute<{ id: string }>(purgeEntryPick(scope.workspaceId, cutoff, batchSize));
  const entryIds = removedEntries.rows.map((row) => row.id);
  await deleteSortKeys(tx, { entryIds });
  const entryValues = await tx.execute(deleteEntryValues(entryIds));
  const entries = await tx.execute<{ id: string; list_id: string; record_id: string; object_id: string }>(sql`
    delete from list_entries e using records r
    where e.workspace_id = ${scope.workspaceId} and e.id = any(${uuidArray(entryIds)})
      and r.workspace_id = e.workspace_id and r.id = e.record_id
    returning e.id::text, e.list_id::text, e.record_id::text, r.object_id::text
  `);
  context.record({
    purgedRecords: gone.records,
    purgedEntries: [...gone.entries, ...entryRefs(entries.rows)],
  });
  return {
    // A whole batch picked means more may wait, even when a restore held one of them (it waits for the next batch);
    // a batch that removed no record and no entry is never full, so rows a restore holds can't spin the purge.
    full: (pickedIds.length === batchSize && doomedIds.length > 0) || entryIds.length === batchSize,
    counts: add(gone.counts, {
      records: 0,
      entries: entries.rows.length,
      values: entryValues.rowCount ?? 0,
      links: 0,
    }),
  };
}

/**
 * Removes, in batches, records deleted before the cutoff (30 days ago, or an
 * earlier one given) with their values, links and entries, and entries removed before it
 * with their values. Each batch is its own transaction (`purgeBatch`),
 * skipping rows a restore holds. The daily cleanup runs `purgeBatch` itself,
 * a batch a step of its job (spec 0008); this loop is for scripts and tests.
 */
export async function purgeDeleted(
  scope: EngineScope,
  input: PurgeInput = {},
  hooks: readonly AfterWrite[] = [],
): Promise<RemovedCounts> {
  requirePermission(scope, 'records.purge');
  // Refused before any transaction opens.
  purgeSettings(input);
  let total = NONE;
  for (;;) {
    const { result } = await runWrite(scope, (context) => purgeBatch(context, input), hooks);
    total = add(total, result.counts);
    if (!result.full) return total;
  }
}

/**
 * Erases one record for good, live or deleted: every value and every past
 * version, its links, its entries and the record itself, then the hooks see
 * an erasure event. Normal deletes keep history; this is for a privacy
 * request (#36 runs it).
 */
export async function eraseRecord(
  scope: EngineScope,
  input: { readonly recordId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<RemovedCounts> {
  requirePermission(scope, 'records.purge');
  const recordId = checkId(input.recordId, 'That record does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // The lists its live entries give slots back to (in id order, as removeRecords takes them again), then
      // the record: the order entry writes lock in.
      await tx.execute(sql`
        select 1 from lists
        where id in (select list_id from list_entries where record_id = ${recordId} and deleted_at is null)
        order by id for no key update
      `);
      const record = await lockAnyRecord(tx, recordId, scope.access);
      const ref = { recordId, objectId: record.objectId };
      const live = record.deletedAt === null;
      // A live record disappears from every read here, like a delete; a trashed one already had.
      if (live) {
        const hiddenEntries = await liveEntries(tx, ref);
        const far = await farReferences(tx, ref);
        context.record({ deletedRecords: [ref], hiddenEntries, ...far });
      }
      const gone = await removeRecords(tx, [recordId]);
      // Last, after the heavy deletes, as every write takes the counter row.
      if (live) await takeRecordSlots(tx, scope, -1);
      context.record({ purgedRecords: gone.records, purgedEntries: gone.entries });
      return gone.counts;
    },
    hooks,
    'erasure',
  );
  return result;
}
