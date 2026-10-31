// Rotations that follow a team (spec 0037, AC-1327, AC-1442; lane L3b): the way "Everyone on the roster" follows the
// workspace, a rotation may follow one team. Its members are the team's active owners, admins and members, worked
// out on every read through `rotation_roster` (migration 0155), so a team change writes nothing to the rotation but
// one thing: a leaver's own settings for it are deleted in the membership change's transaction (`dropTeamLeavers`),
// so rejoining starts afresh, at the pool's average. There is no member cap; a following rotation with fewer than 2
// members offers no times (`thinFollowers`) and its screen says "Needs 2 people". Only `booking.admin` makes a
// rotation follow a team (`rotations.ts`), and a team a rotation follows can't be deleted (`TEAM_IN_USE`).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { uuidArray } from '../engine/ids.ts';
import { refuseOn } from '../engine/refusals.ts';
import { lockRotation } from './ledger.ts';

const { rotationRoster, rotations, teams } = schema;

/** The fewest members a rotation following a team needs to offer times (AC-1327), as a rotation of chosen people. */
export const FOLLOWING_MIN = 2;

/** Following a team, for anyone but `booking.admin` (AC-1327). */
export const FOLLOW_FORBIDDEN = 'Only an admin can make a group follow a team.';

/**
 * The team a rotation is to follow, its row held `for key share` until the change commits, so a delete of the team
 * waits for it and then finds the rotation (`TEAM_IN_USE`); a team gone meanwhile is refused on `followsTeamId`.
 * Taken before the rotation's advisory lock, in the order `changeTeamMembers` takes the team's and then its rotations'.
 */
export async function teamToFollow(
  tx: WorkspaceTx,
  teamId: string,
): Promise<{ readonly id: string; readonly name: string }> {
  const [team] = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .for('key share');
  if (team === undefined) throw refuseOn('CONFIG_INVALID', 'That team doesn’t exist any more.', 'followsTeamId');
  return team;
}

/**
 * A team's leavers drop out of every rotation following it (AC-1442): their own settings for those rotations are
 * deleted in one statement, in the membership change's transaction, under each rotation's lock (in id order, after
 * the team's row lock), so a pick in flight finishes first and a rejoiner starts at the pool's average. Their
 * bookings stay theirs. Nothing for a joiner: the roster reads them at once.
 */
export async function dropTeamLeavers(tx: WorkspaceTx, teamId: string, left: readonly string[]): Promise<void> {
  if (left.length === 0) return;
  const following = await tx
    .select({ id: rotations.id, workspaceId: rotations.workspaceId })
    .from(rotations)
    .where(and(eq(rotations.follows, 'team'), eq(rotations.followsTeamId, teamId), isNull(rotations.deletedAt)))
    .orderBy(asc(rotations.id));
  if (following.length === 0) return;
  for (const rotation of following) await lockRotation(tx, rotation.workspaceId, rotation.id);
  await tx.execute(sql`
    delete from rotation_members rm
    using rotations r
    where r.workspace_id = rm.workspace_id and r.id = rm.rotation_id
      and r.follows = 'team' and r.follows_team_id = ${teamId}::uuid
      and rm.member_id = any(${uuidArray(left)})
  `);
}

/** The names of the live rotations following `teamId`, by name: what a team's delete refusal names. */
export async function rotationsFollowing(tx: WorkspaceTx, teamId: string): Promise<readonly string[]> {
  const rows = await tx
    .select({ name: rotations.name })
    .from(rotations)
    .where(and(eq(rotations.follows, 'team'), eq(rotations.followsTeamId, teamId), isNull(rotations.deletedAt)))
    .orderBy(asc(rotations.name), asc(rotations.id));
  return rows.map((row) => row.name);
}

/**
 * Of `rotationIds`, the rotations following a team with fewer than `FOLLOWING_MIN` members on the roster (on or off):
 * they offer no times (AC-1327). One grouped read, and none at all when no id given follows a team.
 */
export async function thinFollowers(tx: WorkspaceTx, rotationIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (rotationIds.length === 0) return new Set();
  const found = await tx.execute<{ id: string }>(sql`
    select r.id::text as id
    from rotations r
    where r.id = any(${uuidArray(rotationIds)}) and r.follows = 'team'
      and (select count(*) from rotation_roster rr where rr.workspace_id = r.workspace_id and rr.rotation_id = r.id)
        < ${FOLLOWING_MIN}
  `);
  return new Set(found.rows.map((row) => row.id));
}

/**
 * The rotations `memberId` may be in, for a removal's or a role change's locks: their stored rows, "Everyone on the
 * roster", and every live rotation following one of their teams (read before their team rows go).
 */
export const rotationsOfMember = (memberId: string) => sql`
  select rotation_id::text as id from rotation_members where member_id = ${memberId}::uuid
  union select id::text from rotations where follows = 'everyone' and deleted_at is null
  union select r.id::text from rotations r
    join team_members tm on tm.workspace_id = r.workspace_id and tm.team_id = r.follows_team_id
    where r.follows = 'team' and r.deleted_at is null and tm.member_id = ${memberId}::uuid
`;

/** The members `rotation_roster` lists for `rotationId` now. */
export async function rosterIds(tx: WorkspaceTx, rotationId: string): Promise<readonly string[]> {
  const rows = await tx
    .select({ memberId: rotationRoster.memberId })
    .from(rotationRoster)
    .where(eq(rotationRoster.rotationId, rotationId));
  return rows.map((row) => row.memberId);
}
