// How many open comment threads each record of a page holds (the CRM flow pass, 31 October 2026): the small count a
// table row and a board card show beside the name. One grouped statement for the whole page, in the reader's own
// transaction, over the ids the page already kept to what the reader may see (comments follow their record: spec 0038,
// decision 3), so a member never counts threads on a record they can't read. It walks `comments_by_record`, a thread's
// first comment by record, so a page of 100 costs 100 short index probes however many comments the workspace holds.
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { isUuid, uuidList } from '../engine/ids.ts';

/** The most records one count reads: a page is 200 at most, and a read by id 500. */
export const THREAD_COUNT_RECORDS_MAX = 500;

/**
 * The statement behind `openThreadCounts`: for these records, each one's open threads (a first comment not resolved,
 * with a live comment in its thread), grouped, records with none left out. Exported so a test can EXPLAIN it.
 */
export function openThreadCountsStatement(recordIds: readonly string[]): SQL {
  return sql`
    select t.record_id::text as record_id, count(*)::int as open
    from comments t
    where t.record_id = any(${uuidList(recordIds)})
      and t.id = t.thread_id and t.resolved_at is null
      and exists (
        select 1 from comments l
        where l.workspace_id = t.workspace_id and l.thread_id = t.id and l.deleted_at is null
      )
    group by t.record_id
  `;
}

/**
 * Each of `recordIds`' open comment threads, by record id; a record with none has no entry. The caller passes only
 * records the reader may see (a page, or a read that already applied the access door), so this adds no check of its
 * own; Postgres's row level security keeps it to the workspace. At most 500 ids.
 */
export async function openThreadCounts(
  tx: WorkspaceTx,
  recordIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const ids = [...new Set(recordIds.filter(isUuid))].slice(0, THREAD_COUNT_RECORDS_MAX);
  if (ids.length === 0) return new Map();
  const found = await tx.execute<{ record_id: string; open: number }>(openThreadCountsStatement(ids));
  return new Map(found.rows.map((row) => [row.record_id, row.open]));
}
