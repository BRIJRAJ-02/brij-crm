// What the run reads of the workspace's outbox after the window (spec 0011,
// AC-200, AC-201), through the owner login as setup may: each row's relay lag
// (`published_at` minus `created_at`, the commit time spec 0007 writes with
// `clock_timestamp()`), and the workspace's head at a moment, which the miss
// rule needs for seqs a user never heard of. Times are on the database's
// clock, in milliseconds since the epoch: the run moves its window there with
// the clock offset first.
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';

/** The relay lag of every outbox row committed in a window, and how many of them were never published. */
export interface RelayLags {
  readonly lagsMs: readonly number[];
  readonly unpublished: number;
}

/** The relay lags of the rows committed between `fromMs` and `toMs` (database clock). */
export async function relayLags(db: Database, workspaceId: string, fromMs: number, toMs: number): Promise<RelayLags> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ lag: string | null }>(sql`
      select (extract(epoch from published_at - created_at) * 1000)::float8::text as lag
      from outbox
      where workspace_id = ${workspaceId}
        and created_at >= to_timestamp(${fromMs / 1000}) and created_at < to_timestamp(${toMs / 1000})
    `);
    const lagsMs = result.rows.flatMap((row) => (row.lag === null ? [] : [Number(row.lag)]));
    return { lagsMs, unpublished: result.rows.length - lagsMs.length };
  });
}

/** The workspace's last seq committed at or before `atMs` (database clock); 0 before its first. */
export async function headAt(db: Database, workspaceId: string, atMs: number): Promise<number> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ head: string | null }>(sql`
      select max(seq)::text as head from outbox
      where workspace_id = ${workspaceId} and created_at <= to_timestamp(${atMs / 1000})
    `);
    return Number(result.rows[0]?.head ?? 0);
  });
}
