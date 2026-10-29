// "Everyone on the roster" (the workspace link, team scheduling brief decision
// 3, 30 Oct 2026): the workspace's one rotation that follows membership. Its
// members are never stored: the `rotation_roster` view works them out on each
// read (every active member who isn't a guest), so a new member is bookable at
// once and a removed member or a guest never is, with nothing to keep in step.
// A `rotation_members` row on it holds only one person's own settings.
//
// The people there when it was made start at 0, as a new rotation's members
// do. Someone who joins the workspace later starts at the pool's average load
// (spec 0029, AC-730), worked out on read with the formula a joiner gets from
// `replaceMembers`; their first ledger row stores their row with that
// calibration (`keepRosterRow`, under the rotation's lock), so from then on it
// is fixed, exactly as a joiner's is.
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { actorRow } from '../engine/scope.ts';

const { rotationAssignments, rotationMembers, rotationRoster, rotations } = schema;

/** The everyone rotation's name, as Settings and the page builder show it. */
export const EVERYONE_ROTATION_NAME = 'Everyone on the roster';

/** One member's standing as the calibration reads it. */
export interface RosterStanding {
  /** Their row is stored (absent: stored, as in a rotation of chosen people). */
  readonly stored?: boolean;
  /** No row, and joined after the rotation was made (`rotation_roster.joins_late`): their calibration is worked out. */
  readonly joinsLate?: boolean;
  /** Switched on; a stored member switched off keeps their own calibration but isn't in the average. */
  readonly isOn?: boolean;
  readonly weight: number;
  readonly calibration: number;
  /** Live units in the window. */
  readonly count: number;
}

/**
 * Each member's calibration: their own, stored or 0 for someone there from the start; for a late joiner with no row,
 * the settled, switched on members' average load (count and calibration for each unit of weight), times their weight,
 * less their own count, never below 0.
 */
export function rosterCalibration(members: readonly RosterStanding[]): readonly number[] {
  const late = (member: RosterStanding) => member.stored === false && member.joinsLate === true;
  const stored = members.filter((member) => !late(member) && member.isOn !== false);
  const load =
    stored.length === 0
      ? 0
      : stored.reduce((sum, member) => sum + (member.count + member.calibration) / Math.max(1, member.weight), 0) /
        stored.length;
  return members.map((member) =>
    !late(member) ? member.calibration : Math.round(Math.max(0, load * member.weight - member.count) * 100) / 100,
  );
}

/**
 * The workspace's everyone rotation, made the first time it is asked for (inside the caller's write, by a
 * `booking.admin` holder making a workspace link): Fair over 30 days, returning guests to their owner.
 */
export async function everyoneRotation(tx: WorkspaceTx, scope: EngineScope): Promise<string> {
  const by = actorRow(scope.actor);
  const found = async () =>
    (
      await tx
        .select({ id: rotations.id })
        .from(rotations)
        .where(and(eq(rotations.follows, 'everyone'), isNull(rotations.deletedAt)))
    )[0]?.id;
  const existing = await found();
  if (existing !== undefined) return existing;
  // Two admins making the first workspace link at once: one row, through `rotations_everyone`.
  await tx
    .insert(rotations)
    .values({
      workspaceId: scope.workspaceId,
      name: EVERYONE_ROTATION_NAME,
      follows: 'everyone',
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .onConflictDoNothing({
      target: rotations.workspaceId,
      where: sql`${rotations.follows} = 'everyone' and ${rotations.deletedAt} is null`,
    });
  const made = await found();
  if (made === undefined) throw new Error('The everyone rotation was not made.');
  return made;
}

/**
 * Before a ledger row for `memberId` in an everyone rotation, stores their row when they have none, with the
 * calibration the pick used (`rosterCalibration` over the window as it stands). The caller holds the rotation's
 * lock. Nothing for a rotation of chosen people, or someone already stored.
 */
export async function keepRosterRow(
  tx: WorkspaceTx,
  scope: EngineScope,
  rotationId: string,
  memberId: string,
  now: Date = new Date(),
): Promise<void> {
  const [rotation] = await tx
    .select({ follows: rotations.follows, windowDays: rotations.windowDays })
    .from(rotations)
    .where(eq(rotations.id, rotationId));
  if (rotation?.follows !== 'everyone') return;
  const roster = await tx
    .select({
      memberId: rotationRoster.memberId,
      stored: rotationRoster.stored,
      weight: rotationRoster.weight,
      calibration: rotationRoster.calibration,
      isOn: rotationRoster.isOn,
      joinsLate: rotationRoster.joinsLate,
    })
    .from(rotationRoster)
    .where(and(eq(rotationRoster.rotationId, rotationId), eq(rotationRoster.isOn, true)));
  const me = roster.find((member) => member.memberId === memberId);
  if (me === undefined || me.stored) return;
  // The window's live units per member, as `windowCounts` counts them (ledger.ts, which calls this).
  const since = new Date(now.getTime() - rotation.windowDays * 86_400_000);
  const counted = await tx
    .select({
      memberId: rotationAssignments.memberId,
      count: sql<number>`coalesce(sum(${rotationAssignments.units}), 0)::int`,
    })
    .from(rotationAssignments)
    .where(
      and(
        eq(rotationAssignments.rotationId, rotationId),
        isNull(rotationAssignments.voidedAt),
        gte(rotationAssignments.assignedAt, since),
      ),
    )
    .groupBy(rotationAssignments.memberId);
  const counts = new Map(counted.map((row) => [row.memberId, row.count]));
  const standing = [...roster.filter((member) => member.memberId !== memberId), { ...me, isOn: true }].map(
    (member) => ({ ...member, count: counts.get(member.memberId) ?? 0 }),
  );
  const calibration = rosterCalibration(standing).at(-1) ?? 0;
  const by = actorRow(scope.actor);
  await tx
    .insert(rotationMembers)
    .values({
      workspaceId: scope.workspaceId,
      rotationId,
      memberId,
      calibration,
      position: 0,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .onConflictDoNothing();
}
