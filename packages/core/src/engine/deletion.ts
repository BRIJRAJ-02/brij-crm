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
import { checkId, uuidArray } from './ids.ts';
import { RESTORE_WINDOW, takeRecordSlots } from './limits.ts';
import { refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { deleteSortKeys, setRecordKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import { runWrite, type AfterWrite, type RecordRef, type ReferenceChange } from './write.ts';

const { records } = schema;

/** Where a record stands. */
export type RecordState = 'live' | 'deleted';

/** Locks a record's row whatever its state, or refuses `NOT_FOUND`. */
async function lockAnyRecord(tx: WorkspaceTx, recordId: string) {
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

/** The ids of a record's entries still in their lists: their unique keys go with the record's. */
async function liveEntryIds(tx: WorkspaceTx, recordId: string): Promise<readonly string[]> {
  const result = await tx.execute<{ id: string }>(
    sql`select id::text from list_entries where record_id = ${recordId} and deleted_at is null`,
  );
  return result.rows.map((row) => row.id);
}

/**
 * The statement behind `farReferences`, exported for the plan test. `ends`
 * holds, per relationship with an end on the object, the attribute the far
 * record shows this one through when it is the from end (`via_to`, if the
 * to end has an attribute) and when it is the to end (`via_from`, a two way
 * end on its object or a one way reference naming it).
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
    ),
    hits as (
      select l.workspace_id, l.to_record_id as far_id, e.via_to as attribute_id
      from ends e
      join record_links l on l.workspace_id = e.workspace_id and l.relationship_id = e.relationship_id
        and l.from_record_id = ${recordId}::uuid and l.active_until is null
      where e.via_to is not null
      union all
      select l.workspace_id, l.from_record_id, e.via_from
      from ends e
      join record_links l on l.workspace_id = e.workspace_id and l.relationship_id = e.relationship_id
        and l.to_record_id = ${recordId}::uuid and l.active_until is null
      where e.via_from is not null
    )
    select far.id::text as record_id, far.object_id::text as object_id, hits.attribute_id::text as attribute_id
    from hits
    cross join lateral (
      select r.id, r.object_id from records r
      where r.workspace_id = hits.workspace_id and r.id = hits.far_id and r.deleted_at is null
      -- Keeps the lookup its own subquery: one primary key probe per link, never a hash join over all of records.
      offset 0
    ) far
  `;
}

/**
 * The reference values on live records that show this record: the far end of
 * each of its current links, where that end has an attribute. A delete, a
 * restore or an erasure of the record changes them with no new version, and
 * the hooks get every one (the audit log names them all; the outbox hook caps
 * its own copy). The read goes per object: first the ends of the
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
async function farReferences(
  tx: WorkspaceTx,
  record: { readonly recordId: string; readonly objectId: string },
): Promise<readonly ReferenceChange[]> {
  const { recordId, objectId } = record;
  const result = await tx.execute<{ record_id: string; object_id: string; attribute_id: string }>(
    farReferencesQuery(recordId, objectId),
  );
  // By object, record, then attribute, as the hooks have always seen them. Ids are lower case uuids, so
  // comparing the text compares them as Postgres would.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return result.rows
    .map((row) => ({ recordId: row.record_id, objectId: row.object_id, attributeId: row.attribute_id }))
    .sort(
      (a, b) =>
        compare(a.objectId, b.objectId) || compare(a.recordId, b.recordId) || compare(a.attributeId, b.attributeId),
    );
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
      const record = await lockAnyRecord(tx, recordId);
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
        })
        .where(eq(records.id, recordId));
      const entryIds = await liveEntryIds(tx, recordId);
      const references = await farReferences(tx, { recordId, objectId: record.objectId });
      await holdUniqueKeys(tx, [recordId, ...entryIds]);
      await setRecordKeysLive(tx, recordId, false);
      // Last, as every write takes the counter row.
      await takeRecordSlots(tx, scope, -1);
      context.record({
        deletedRecords: [{ recordId, objectId: record.objectId }],
        hiddenEntries: entryIds,
        references,
      });
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
      const record = await lockAnyRecord(tx, recordId);
      if (record.deletedAt === null) return { recordId, state: 'live' as const };
      if (record.expired) throw refuse('NOT_FOUND', 'That record was deleted more than 30 days ago.');
      const entryIds = await liveEntryIds(tx, recordId);
      const references = await farReferences(tx, { recordId, objectId: record.objectId });
      await releaseUniqueKeys(tx, [recordId, ...entryIds]);
      await tx
        .update(records)
        .set({ deletedAt: null, deletedByType: null, deletedById: null, deletedByMemberId: null })
        .where(eq(records.id, recordId));
      await setRecordKeysLive(tx, recordId, true);
      // Last, as every write takes the counter row (a create checks its slot after its values too). A full
      // workspace refuses here, and the refusal rolls back everything above.
      await takeRecordSlots(tx, scope, 1);
      context.record({
        restoredRecords: [{ recordId, objectId: record.objectId }],
        shownEntries: entryIds,
        references,
      });
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
  readonly entryIds: readonly string[];
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
  if (recordIds.length === 0) return { counts: NONE, records: [], entryIds: [] };
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
  const entries = await tx.execute<{ id: string }>(
    sql`delete from list_entries where record_id = any(${ids}) returning id::text`,
  );
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
    entryIds: entries.rows.map((row) => row.id),
  };
}

/**
 * Removes, in batches, records deleted before the cutoff (30 days ago, or an
 * earlier one given) with their values, links and entries, and entries removed before it
 * with their values. Each batch is its own transaction, skipping rows a
 * restore holds. A system job (#8 schedules it), one workspace at a time.
 */
export async function purgeDeleted(
  scope: EngineScope,
  input: { readonly cutoff?: string; readonly batchSize?: number } = {},
  hooks: readonly AfterWrite[] = [],
): Promise<RemovedCounts> {
  const batchSize = input.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw refuse('CONFIG_INVALID', 'Purge 1 to 10,000 rows at a time.');
  }
  // Checked and rewritten as UTC text, so only a full instant with its zone reaches the cast.
  const given =
    input.cutoff === undefined
      ? undefined
      : checkInstant(input.cutoff, 'Give the cutoff as an ISO timestamp with its zone, such as 2026-10-01T00:00:00Z.');
  // Never inside the restore window, whatever cutoff is given.
  const window = sql`now() - ${RESTORE_WINDOW}::interval`;
  const cutoff = given === undefined ? window : sql`least(${given}::timestamptz, ${window})`;
  let total = NONE;
  for (;;) {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        const doomed = await tx.execute<{ id: string }>(sql`
          select id::text from records where deleted_at < ${cutoff}
          order by deleted_at, id limit ${batchSize} for update skip locked
        `);
        const gone = await removeRecords(
          tx,
          doomed.rows.map((row) => row.id),
        );
        const removedEntries = await tx.execute<{ id: string }>(sql`
          select id::text from list_entries where deleted_at < ${cutoff}
          order by deleted_at, id limit ${batchSize} for update skip locked
        `);
        const entryIds = removedEntries.rows.map((row) => row.id);
        await deleteSortKeys(tx, { entryIds });
        const entryValues = await tx.execute(deleteEntryValues(entryIds));
        const entries = await tx.execute<{ id: string }>(
          sql`delete from list_entries where id = any(${uuidArray(entryIds)}) returning id::text`,
        );
        context.record({
          purgedRecords: gone.records,
          purgedEntries: [...gone.entryIds, ...entries.rows.map((row) => row.id)],
        });
        const full = doomed.rows.length === batchSize || removedEntries.rows.length === batchSize;
        return {
          full,
          counts: add(gone.counts, {
            records: 0,
            entries: entries.rows.length,
            values: entryValues.rowCount ?? 0,
            links: 0,
          }),
        };
      },
      hooks,
    );
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
      const record = await lockAnyRecord(tx, recordId);
      const ref = { recordId, objectId: record.objectId };
      const live = record.deletedAt === null;
      // A live record disappears from every read here, like a delete; a trashed one already had.
      if (live) {
        const hiddenEntries = await liveEntryIds(tx, recordId);
        const references = await farReferences(tx, ref);
        context.record({ deletedRecords: [ref], hiddenEntries, references });
      }
      const gone = await removeRecords(tx, [recordId]);
      // Last, after the heavy deletes, as every write takes the counter row.
      if (live) await takeRecordSlots(tx, scope, -1);
      context.record({ purgedRecords: gone.records, purgedEntries: gone.entryIds });
      return gone.counts;
    },
    hooks,
    'erasure',
  );
  return result;
}
