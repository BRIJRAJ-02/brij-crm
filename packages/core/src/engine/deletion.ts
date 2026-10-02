// Deleting, restoring, purging and erasing records (spec 0004, AC-8, AC-18).
// A delete hides the record, and with it its links and entries (every read
// joins records and skips deleted ones), without touching the records on the
// other side. A restore within 30 days brings all three back. The purge and
// erasure are the only hard deletes, each counted. Stored sort keys follow:
// hidden on delete, shown on restore, removed before their values.
import { eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { uuidArray } from './ids.ts';
import { RESTORE_WINDOW, takeRecordSlots } from './limits.ts';
import { refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { deleteSortKeys, setRecordKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import { runWrite, type AfterWrite } from './write.ts';

const { records } = schema;

/** Where a record stands. */
export type RecordState = 'live' | 'deleted';

/** Locks a record's row whatever its state, or refuses `NOT_FOUND`. */
async function lockAnyRecord(tx: WorkspaceTx, recordId: string) {
  const [row] = await tx
    .select({
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
 * Moves a record to the trash: it, its links and its entries disappear from
 * every read at once, its unique values stop blocking others, and its record
 * slot comes back. Deleting a deleted record changes nothing.
 */
export async function deleteRecord(
  scope: EngineScope,
  input: { readonly recordId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ recordId: string; state: RecordState }> {
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const record = await lockAnyRecord(tx, input.recordId);
      if (record.deletedAt !== null) return { recordId: input.recordId, state: 'deleted' as const };
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
        .where(eq(records.id, input.recordId));
      await holdUniqueKeys(tx, [input.recordId, ...(await liveEntryIds(tx, input.recordId))]);
      await setRecordKeysLive(tx, input.recordId, false);
      await takeRecordSlots(tx, scope, -1);
      context.record({ deletedRecords: [input.recordId] });
      return { recordId: input.recordId, state: 'deleted' as const };
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
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const record = await lockAnyRecord(tx, input.recordId);
      if (record.deletedAt === null) return { recordId: input.recordId, state: 'live' as const };
      if (record.expired) throw refuse('NOT_FOUND', 'That record was deleted more than 30 days ago.');
      await takeRecordSlots(tx, scope, 1);
      await releaseUniqueKeys(tx, [input.recordId, ...(await liveEntryIds(tx, input.recordId))]);
      await tx
        .update(records)
        .set({ deletedAt: null, deletedByType: null, deletedById: null, deletedByMemberId: null })
        .where(eq(records.id, input.recordId));
      await setRecordKeysLive(tx, input.recordId, true);
      context.record({ restoredRecords: [input.recordId] });
      return { recordId: input.recordId, state: 'live' as const };
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

/**
 * Hard deletes some records and everything that hangs off them, in foreign
 * key order: values (the records' and their entries'), links, entries, then
 * the records. Entries still in their lists give their slots back.
 */
async function removeRecords(tx: WorkspaceTx, recordIds: readonly string[]): Promise<RemovedCounts> {
  if (recordIds.length === 0) return NONE;
  const ids = uuidArray(recordIds);
  await tx.execute(sql`
    update lists l set entry_count = l.entry_count - gone.n
    from (
      select list_id, count(*)::int as n from list_entries
      where record_id = any(${ids}) and deleted_at is null group by list_id
    ) gone
    where l.id = gone.list_id
  `);
  await deleteSortKeys(tx, { recordIds });
  const values = await tx.execute(sql`
    delete from "values" where record_id = any(${ids})
      or entry_id in (select id from list_entries where record_id = any(${ids}))
  `);
  const links = await tx.execute(
    sql`delete from record_links where from_record_id = any(${ids}) or to_record_id = any(${ids})`,
  );
  const entries = await tx.execute(sql`delete from list_entries where record_id = any(${ids})`);
  const removed = await tx.execute(sql`delete from records where id = any(${ids})`);
  return {
    records: removed.rowCount ?? 0,
    entries: entries.rowCount ?? 0,
    values: values.rowCount ?? 0,
    links: links.rowCount ?? 0,
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
  if (input.cutoff !== undefined && Number.isNaN(Date.parse(input.cutoff))) {
    throw refuse('CONFIG_INVALID', 'Give the cutoff as an ISO timestamp.');
  }
  // Never inside the restore window, whatever cutoff is given.
  const window = sql`now() - ${RESTORE_WINDOW}::interval`;
  const cutoff = input.cutoff === undefined ? window : sql`least(${input.cutoff}::timestamptz, ${window})`;
  let total = NONE;
  for (;;) {
    const { result } = await runWrite(
      scope,
      async ({ tx }) => {
        const doomed = await tx.execute<{ id: string }>(sql`
          select id::text from records where deleted_at < ${cutoff}
          order by deleted_at, id limit ${batchSize} for update skip locked
        `);
        const counts = await removeRecords(
          tx,
          doomed.rows.map((row) => row.id),
        );
        const removedEntries = await tx.execute<{ id: string }>(sql`
          select id::text from list_entries where deleted_at < ${cutoff}
          order by deleted_at, id limit ${batchSize} for update skip locked
        `);
        const entryIds = uuidArray(removedEntries.rows.map((row) => row.id));
        await deleteSortKeys(tx, { entryIds: removedEntries.rows.map((row) => row.id) });
        const entryValues = await tx.execute(sql`delete from "values" where entry_id = any(${entryIds})`);
        const entries = await tx.execute(sql`delete from list_entries where id = any(${entryIds})`);
        const full = doomed.rows.length === batchSize || removedEntries.rows.length === batchSize;
        return {
          full,
          counts: add(counts, {
            records: 0,
            entries: entries.rowCount ?? 0,
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
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const record = await lockAnyRecord(tx, input.recordId);
      if (record.deletedAt === null) await takeRecordSlots(tx, scope, -1);
      const counts = await removeRecords(tx, [input.recordId]);
      context.record({ deletedRecords: [input.recordId] });
      return counts;
    },
    hooks,
    'erasure',
  );
  return result;
}
