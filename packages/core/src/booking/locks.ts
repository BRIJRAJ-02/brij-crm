// Booking's advisory locks: one per host, taken by every write that changes
// what the host can be booked for (a booking's recheck, a block), so the two
// never pass each other.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';

/** A transaction scoped advisory lock on a text key (released when the transaction ends, however it ends). */
export async function lockKey(tx: WorkspaceTx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** The lock on one host's time: a booking's recheck and a new block take it, so neither sees the other half made. */
export const hostLockKey = (workspaceId: string, memberId: string) => `booking:host:${workspaceId}:${memberId}`;
