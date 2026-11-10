// Whether the connected app that added a person still keeps them (10 Nov 2026, the owner, as with directory synced
// accounts): the system that owns a person's profile controls it while it is connected; once it is disconnected, the
// source of truth is gone and Timefix's team page managers take over, until it connects again. The one read behind
// who keeps a managed person's social links (`managed-socials.ts`) and their name and title (`page-only.ts`,
// `members/profile.ts`), so the editor's reads and the writes agree.
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

const { partnerConnections } = schema;

/**
 * The live connection of `partnerId` in this workspace (at most one, `partner_connections_live`), or undefined when
 * the app is disconnected; whichever row it is, since connecting again after a disconnect makes a new one. With
 * `lock`, for a write: the exchange's per partner advisory lock is taken shared first, so a reconnect waits for a write
 * that found the app disconnected, and the live row is shared, so a disconnect waits for a write that found it live.
 */
export async function liveConnectionOf(
  tx: WorkspaceTx,
  workspaceId: string,
  partnerId: string,
  lock: boolean,
): Promise<string | undefined> {
  if (lock) {
    // The same key the exchange takes (`partners/exchange.ts`) before it makes or renews a connection.
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${`partner_connection:${workspaceId}:${partnerId}`}, 0))`,
    );
  }
  const query = tx
    .select({ id: partnerConnections.id })
    .from(partnerConnections)
    .where(
      and(
        eq(partnerConnections.workspaceId, workspaceId),
        eq(partnerConnections.partnerId, partnerId),
        isNull(partnerConnections.disconnectedAt),
      ),
    )
    .limit(1);
  const [live] = lock ? await query.for('share') : await query;
  return live?.id;
}

/**
 * Whether a team page manager keeps a managed person's name and title (the editor's `managedBy: 'team'`,
 * `namePageOnlyPerson`): a page only person, from anywhere; a connected app's person with no login only while that
 * app is disconnected, and only from Timefix itself (no frame). A live app's people are the app's, a claimed person
 * keeps their own.
 */
export function managerKeepsName(person: {
  readonly partnerId: string | null;
  readonly claimed: boolean;
  readonly live: string | undefined;
  readonly fromConnection: string | undefined;
}): boolean {
  if (person.partnerId === null) return true;
  return !person.claimed && person.live === undefined && person.fromConnection === undefined;
}
