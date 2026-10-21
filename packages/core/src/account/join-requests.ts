// Account deletion's last word in workspaces the person never joined (spec
// 0031 slice 6, spec 0033 AC-905): their open join requests close as declined
// by the system, so no admin is left deciding on someone who no longer
// exists, and every request of theirs stops naming them. The workspaces come
// from `crm_join_requests_of` (ids only, past row level security); each one
// changes inside its own withWorkspace() as the system.
import { schema, type Database } from '@crm/db';
import { and, eq, sql } from 'drizzle-orm';
import { systemScope } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { actorRow, SYSTEM_ACTOR } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';

const { joinRequests } = schema;

/** The nil uuid: the lookup runs in no workspace at all. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The name a deleted person's join requests keep, as their member rows do. */
const DELETED_NAME = 'Deleted user';

/**
 * Closes the person's open join requests, declined by the system, and blanks
 * the name and address on every request of theirs, in each workspace that
 * holds one. Answers how many workspaces it changed. Safe to run again.
 */
export async function closeJoinRequestsOf(deps: { readonly db: Database }, userId: string): Promise<number> {
  if (!isUuid(userId)) return 0;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string }>(
      sql`select workspace_id::text as workspace_id from crm_join_requests_of(${userId})`,
    ),
  );
  const system = actorRow(SYSTEM_ACTOR);
  for (const { workspace_id: workspaceId } of found.rows) {
    await inWorkspace(systemScope(deps.db, workspaceId), async (tx) => {
      const mine = and(eq(joinRequests.workspaceId, workspaceId), eq(joinRequests.userId, userId));
      const touched = {
        updatedAt: sql`now()`,
        updatedByType: system.type,
        updatedById: system.id,
        updatedByMemberId: system.memberId,
      };
      const closed = await tx
        .update(joinRequests)
        .set({
          status: 'declined',
          decidedAt: sql`now()`,
          decidedByType: system.type,
          decidedById: system.id,
          decidedByMemberId: system.memberId,
          ...touched,
        })
        .where(and(mine, eq(joinRequests.status, 'open')))
        .returning({ id: joinRequests.id });
      // The workspace's log says who closed it and why, as an admin's decline does.
      for (const request of closed) {
        await writeAudit(tx, workspaceId, SYSTEM_ACTOR, {
          action: 'join_request.declined',
          targetType: 'join_request',
          targetId: request.id,
          after: { reason: 'account_deleted' },
        });
      }
      await tx
        .update(joinRequests)
        .set({
          name: DELETED_NAME,
          email: sql`'deleted-' || ${joinRequests.id}::text || '@deleted.invalid'`,
          ...touched,
        })
        .where(mine);
    });
  }
  return found.rows.length;
}
