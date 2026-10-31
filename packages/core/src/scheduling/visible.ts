// `members.visible` (spec 0030, as spec 0037 AC-1261 widens it): the members
// in the caller's See reach, the caller first and then by name, each with
// whether the caller may Manage them. A filtered service: any member may call
// it, and someone with no reach over others gets themself alone, never a
// refusal. The Team day, the Viewing Select and the member pickers read it.
import { sql } from 'drizzle-orm';
import type { VisibleMembers } from '@crm/contracts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { mayEditOwnHours } from '../availability/schedules.ts';
import { canActFor, reachSummary, roleReach, schedulingReach, type SchedulingReach } from '../access/scheduling.ts';
import { uuidList } from '../engine/ids.ts';

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
    const within = named === undefined ? sql`true` : sql`id = any(${uuidList(named)})`;
    const rows = await tx.execute<{ id: string; name: string; role: string }>(sql`
      select id::text as id, name, role::text as role from members
      where workspace_id = ${scope.workspaceId}::uuid and status = 'active' and ${within}
      order by (id = ${me}::uuid) desc, lower(name), id
      limit ${VISIBLE_MAX}
    `);
    return { members: visibleOf(rows.rows, reach, me, mayEditOwnHours(scope)) };
  });
}

/**
 * The rows the caller may See, each with what they may do (pure, AC-1261): Manage over them, and their hours, which a
 * delegation the member granted themself never reaches while their hours are set by others (AC-1255). The caller's
 * own hours are theirs to change only with `booking.manage` and `availability.own` (AC-1260). A guest is never listed
 * but as the caller (spec 0031, slice 9): guests take no bookings, so no host picker, For or Roster offers one.
 */
export function visibleOf(
  rows: readonly { readonly id: string; readonly name: string; readonly role?: string }[],
  reach: SchedulingReach,
  me: string,
  ownHours: boolean,
): VisibleMembers['members'] {
  return rows
    .filter((row) => row.id === me || row.role !== 'guest')
    .filter((row) => canActFor(reach, row.id, 'view'))
    .map((row) => ({
      id: row.id,
      name: row.name,
      canManage: canActFor(reach, row.id, 'manage'),
      canChangeHours: row.id === me ? ownHours : canActFor(reach, row.id, 'manage', 'hours'),
    }));
}

/** What `access.mine` says of the caller's reach (AC-1261): one reach read. Undefined for anyone but a member. */
export async function mySchedulingReach(scope: EngineScope): Promise<ReturnType<typeof reachSummary> | undefined> {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') return undefined;
  // Owners and admins manage everyone through their role: nothing to read.
  if (roleReach(scope.access) === 'manage') {
    return reachSummary({ self: principal.memberId, all: 'manage', members: new Map(), hoursSeenOnly: new Set() });
  }
  return inWorkspace(scope, async (tx) => reachSummary(await schedulingReach(tx, scope)));
}
