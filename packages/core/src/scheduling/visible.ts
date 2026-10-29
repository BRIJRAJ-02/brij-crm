// `members.visible` (spec 0030, as spec 0037 AC-1261 widens it): the members
// in the caller's See reach, the caller first and then by name, each with
// whether the caller may Manage them. A filtered service: any member may call
// it, and someone with no reach over others gets themself alone, never a
// refusal. The Team day, the Viewing Select and the member pickers read it.
import { sql } from 'drizzle-orm';
import type { VisibleMembers } from '@crm/contracts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, reachSummary, schedulingReach } from '../access/scheduling.ts';

/** The most members the answer holds (the Members page's own cap). */
const VISIBLE_MAX = 1000;

/** The members in the caller's See reach, the caller first, then by name (AC-1261). */
export async function listVisibleMembers(scope: EngineScope): Promise<VisibleMembers> {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') return { members: [] };
  const me = principal.memberId;
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    // Without a reach over everyone, only the caller and the members reached one by one are named in the read.
    const named = reach.all === undefined ? [me, ...reach.members.keys()] : undefined;
    const within =
      named === undefined
        ? sql`true`
        : sql`id = any(array[${sql.join(
            named.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`;
    const rows = await tx.execute<{ id: string; name: string }>(sql`
      select id::text as id, name from members
      where status = 'active' and ${within}
      order by (id = ${me}::uuid) desc, lower(name), id
      limit ${VISIBLE_MAX}
    `);
    return {
      members: rows.rows
        .filter((row) => canActFor(reach, row.id, 'view'))
        .map((row) => ({ id: row.id, name: row.name, canManage: canActFor(reach, row.id, 'manage') })),
    };
  });
}

/** What `access.mine` says of the caller's reach (AC-1261): one reach read. Undefined for anyone but a member. */
export async function mySchedulingReach(scope: EngineScope): Promise<ReturnType<typeof reachSummary> | undefined> {
  checkScope(scope);
  if (scope.access.principal.kind !== 'member') return undefined;
  return inWorkspace(scope, async (tx) => reachSummary(await schedulingReach(tx, scope)));
}
