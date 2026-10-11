// The load workspace's free record slots (spec 0011, AC-209): what
// `pnpm load:run` checks before the warm up (refusing when a run's creates
// might not fit, naming `pnpm load:reset`) and what `pnpm load:reset` prints
// after. A read of one counter row; nothing here writes.
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { SCALE_BUDGET } from './scale-budget.ts';

/** The workspace's live records and its free record slots under the budget's records per workspace. */
export async function freeRecordSlots(db: Database, workspaceId: string): Promise<{ live: number; free: number }> {
  const live = await db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ live: number }>(
      sql`select live_records::int as live from workspace_counters where workspace_id = ${workspaceId}`,
    );
    return result.rows[0]?.live ?? 0;
  });
  return { live, free: SCALE_BUDGET.recordsPerWorkspace - live };
}
