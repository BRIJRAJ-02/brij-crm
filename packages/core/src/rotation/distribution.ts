// A rotation's Distribution tab and its count adjustments (spec 0037,
// AC-1329, AC-1330). The tab reads the window's ledger in three grouped
// queries (counts and adjustments by member, reasons by member, the last 12
// weeks by member and week), never a row per booking. A member sees their own
// row; `booking.admin` everyone's. An adjustment is a ledger row (`source` and
// `reason` `adjustment`, `units` the number) written under the rotation's lock,
// so a pick in flight sees it or not, never half; undoing voids it. Both are
// audited.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  AdjustCountInput,
  AssignmentReason,
  DistributionRow,
  RotationAdjustment,
  RotationDistribution,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { lockRotation, windowStart } from './ledger.ts';

const { members, rotationAssignments, rotationMembers, rotations } = schema;
/** Whoever made an adjustment. */
const adjuster = alias(members, 'adjuster');

const MISSING = 'That rotation doesn’t exist, or isn’t one of yours.';
const WEEKS = 12;
const WEEK_MS = 7 * 86_400_000;

/** The reader's member id, when a member. */
function memberOf(scope: EngineScope): string | undefined {
  const { principal } = scope.access;
  return principal.kind === 'member' ? principal.memberId : undefined;
}

/** The Monday 00:00 UTC on or before `at`. */
function mondayOf(at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - back * 86_400_000);
}

/** The live rotation, or NOT_FOUND. */
async function liveRotation(tx: WorkspaceTx, rotationId: string, lock = false) {
  const query = tx
    .select()
    .from(rotations)
    .where(and(eq(rotations.id, rotationId), isNull(rotations.deletedAt)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', MISSING);
  return row;
}

/** Adjustments as the tab lists them: newest first, at most 100. */
async function adjustmentsOf(
  tx: WorkspaceTx,
  rotationId: string,
  only: string | undefined,
): Promise<RotationAdjustment[]> {
  const rows = await tx
    .select({
      id: rotationAssignments.id,
      memberId: rotationAssignments.memberId,
      memberName: members.name,
      units: rotationAssignments.units,
      detail: rotationAssignments.detail,
      at: rotationAssignments.assignedAt,
      voidedAt: rotationAssignments.voidedAt,
      byName: sql<string>`coalesce(${adjuster.name}, '')`,
    })
    .from(rotationAssignments)
    .innerJoin(
      members,
      and(eq(members.workspaceId, rotationAssignments.workspaceId), eq(members.id, rotationAssignments.memberId)),
    )
    .leftJoin(
      adjuster,
      and(
        eq(adjuster.workspaceId, rotationAssignments.workspaceId),
        eq(adjuster.id, rotationAssignments.createdByMemberId),
      ),
    )
    .where(
      and(
        eq(rotationAssignments.rotationId, rotationId),
        eq(rotationAssignments.source, 'adjustment'),
        only === undefined ? undefined : eq(rotationAssignments.memberId, only),
      ),
    )
    .orderBy(desc(rotationAssignments.assignedAt), desc(rotationAssignments.id))
    .limit(100);
  return rows.map((row) => adjustmentOf(row));
}

/** One stored adjustment row as the contract shapes it. */
function adjustmentOf(row: {
  readonly id: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly units: number;
  readonly detail: unknown;
  readonly at: Date;
  readonly voidedAt: Date | null;
  readonly byName: string;
}): RotationAdjustment {
  const note =
    typeof row.detail === 'object' && row.detail !== null && 'note' in row.detail
      ? String((row.detail as { readonly note: unknown }).note)
      : '';
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName,
    units: row.units,
    note,
    byName: row.byName,
    at: row.at.toISOString(),
    ...(row.voidedAt === null ? {} : { voidedAt: row.voidedAt.toISOString() }),
  };
}

/**
 * The Distribution tab (AC-1330): each member's count in the window (calibration and adjustments included), their
 * fair share by weight among the members switched on, the difference, the window's adjustments, how they got their
 * meetings, and the last 12 weeks. `booking.admin` sees every row; a member of the rotation only their own; anyone
 * else NOT_FOUND.
 */
export async function rotationDistribution(
  scope: EngineScope,
  input: { readonly rotationId: string },
  now: Date = new Date(),
): Promise<RotationDistribution> {
  requirePermission(scope, 'booking.manage');
  const everyone = can(scope.access, 'booking.admin');
  const me = memberOf(scope);
  return inWorkspace(scope, async (tx) => {
    const rotation = await liveRotation(tx, input.rotationId);
    const pool = await tx
      .select({
        memberId: rotationMembers.memberId,
        name: members.name,
        weight: rotationMembers.weight,
        isOn: rotationMembers.isOn,
        calibration: rotationMembers.calibration,
      })
      .from(rotationMembers)
      .innerJoin(
        members,
        and(eq(members.workspaceId, rotationMembers.workspaceId), eq(members.id, rotationMembers.memberId)),
      )
      .where(eq(rotationMembers.rotationId, rotation.id))
      .orderBy(asc(rotationMembers.position));
    if (!everyone && !pool.some((member) => member.memberId === me)) throw refuse('NOT_FOUND', MISSING);
    const since = windowStart(now, rotation.windowDays);
    const ids = pool.map((member) => member.memberId);
    const counted =
      ids.length === 0
        ? []
        : await tx
            .select({
              memberId: rotationAssignments.memberId,
              reason: rotationAssignments.reason,
              units: sql<number>`coalesce(sum(${rotationAssignments.units}), 0)::int`,
              rows: sql<number>`count(*)::int`,
            })
            .from(rotationAssignments)
            .where(
              and(
                eq(rotationAssignments.rotationId, rotation.id),
                isNull(rotationAssignments.voidedAt),
                sql`${rotationAssignments.assignedAt} >= ${since.toISOString()}::timestamptz`,
                inArray(rotationAssignments.memberId, ids),
              ),
            )
            .groupBy(rotationAssignments.memberId, rotationAssignments.reason);
    const firstWeek = new Date(mondayOf(now).getTime() - (WEEKS - 1) * WEEK_MS);
    const weekly =
      ids.length === 0
        ? []
        : await tx
            .select({
              memberId: rotationAssignments.memberId,
              week: sql<string>`to_char(date_trunc('week', ${rotationAssignments.assignedAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
              rows: sql<number>`count(*)::int`,
            })
            .from(rotationAssignments)
            .where(
              and(
                eq(rotationAssignments.rotationId, rotation.id),
                isNull(rotationAssignments.voidedAt),
                sql`${rotationAssignments.source} <> 'adjustment'`,
                sql`${rotationAssignments.assignedAt} >= ${firstWeek.toISOString()}::timestamptz`,
                inArray(rotationAssignments.memberId, ids),
              ),
            )
            .groupBy(
              rotationAssignments.memberId,
              sql`date_trunc('week', ${rotationAssignments.assignedAt} at time zone 'UTC')`,
            );
    const weekStarts = Array.from({ length: WEEKS }, (_, index) =>
      new Date(firstWeek.getTime() + index * WEEK_MS).toISOString().slice(0, 10),
    );
    const countOf = (memberId: string) =>
      counted.filter((row) => row.memberId === memberId).reduce((sum, row) => sum + row.units, 0) +
      (pool.find((member) => member.memberId === memberId)?.calibration ?? 0);
    const on = pool.filter((member) => member.isOn);
    const total = on.reduce((sum, member) => sum + countOf(member.memberId), 0);
    const weights = on.reduce((sum, member) => sum + member.weight, 0);
    const rows: DistributionRow[] = pool
      .filter((member) => everyone || member.memberId === me)
      .map((member) => {
        const count = countOf(member.memberId);
        const fairShare = member.isOn && weights > 0 ? (total * member.weight) / weights : 0;
        const mine = counted.filter((row) => row.memberId === member.memberId);
        const reasons: Partial<Record<AssignmentReason, number>> = Object.fromEntries(
          mine.map((row) => [row.reason, row.reason === 'adjustment' ? row.units : row.rows]),
        );
        return {
          memberId: member.memberId,
          name: member.name,
          weight: member.weight,
          isOn: member.isOn,
          count,
          // From everyone's total, so only for those who may see everyone's counts (AC-752).
          ...(everyone
            ? {
                fairShare: Math.round(fairShare * 10) / 10,
                difference: Math.round((count - fairShare) * 10) / 10,
              }
            : {}),
          adjusted: mine.filter((row) => row.reason === 'adjustment').reduce((sum, row) => sum + row.units, 0),
          reasons,
          weeks: weekStarts.map(
            (start) => weekly.find((row) => row.memberId === member.memberId && row.week === start)?.rows ?? 0,
          ),
        };
      });
    return {
      rotationId: rotation.id,
      windowDays: rotation.windowDays,
      weekStarts,
      rows,
      adjustments: await adjustmentsOf(tx, rotation.id, everyone ? undefined : me),
      canAdjust: everyone,
    };
  });
}

/**
 * Adjusts a member's count in a rotation (AC-1329): `booking.admin` (the rotation's editors join with spec 0037's
 * J14), for a member of the rotation, by -20 to +20 (never 0) with a note. Under the rotation's lock; audited.
 */
export async function adjustCount(
  scope: EngineScope,
  input: Pick<AdjustCountInput, 'rotationId' | 'memberId' | 'units' | 'note'>,
): Promise<RotationAdjustment> {
  requirePermission(scope, 'booking.admin');
  if (!Number.isInteger(input.units) || input.units === 0 || Math.abs(input.units) > 20) {
    throw refuse('CONFIG_INVALID', 'Adjust by a whole number from -20 to 20, never 0.');
  }
  return inWorkspace(scope, async (tx) => {
    const rotation = await liveRotation(tx, input.rotationId);
    await lockRotation(tx, scope.workspaceId, rotation.id);
    const [pooled] = await tx
      .select({ memberId: rotationMembers.memberId })
      .from(rotationMembers)
      .where(and(eq(rotationMembers.rotationId, rotation.id), eq(rotationMembers.memberId, input.memberId)));
    if (pooled === undefined) throw refuse('NOT_FOUND', 'They aren’t in this rotation.');
    const by = actorRow(scope.actor);
    const [made] = await tx
      .insert(rotationAssignments)
      .values({
        workspaceId: scope.workspaceId,
        rotationId: rotation.id,
        memberId: input.memberId,
        source: 'adjustment',
        reason: 'adjustment',
        units: input.units,
        detail: { note: input.note, by: by.memberId },
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .returning({ id: rotationAssignments.id });
    if (made === undefined) throw new Error('The adjustment was not stored.');
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'rotation.adjusted',
      targetType: 'rotation',
      targetId: rotation.id,
      after: { memberId: input.memberId, units: input.units, note: input.note },
    });
    const [listed] = (await adjustmentsOf(tx, rotation.id, input.memberId)).filter((each) => each.id === made.id);
    if (listed === undefined) throw new Error('The adjustment was not stored.');
    return listed;
  });
}

/** Undoes an adjustment (AC-1329): voided, so it stops counting; `booking.admin`; audited. Undoing twice is a no-op. */
export async function undoAdjustment(
  scope: EngineScope,
  input: { readonly rotationId: string; readonly adjustmentId: string },
): Promise<RotationAdjustment> {
  requirePermission(scope, 'booking.admin');
  return inWorkspace(scope, async (tx) => {
    const rotation = await liveRotation(tx, input.rotationId);
    await lockRotation(tx, scope.workspaceId, rotation.id);
    const by = actorRow(scope.actor);
    const [undone] = await tx
      .update(rotationAssignments)
      .set({
        voidedAt: sql`coalesce(${rotationAssignments.voidedAt}, now())`,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(
        and(
          eq(rotationAssignments.id, input.adjustmentId),
          eq(rotationAssignments.rotationId, rotation.id),
          eq(rotationAssignments.source, 'adjustment'),
        ),
      )
      .returning({ memberId: rotationAssignments.memberId, units: rotationAssignments.units });
    if (undone === undefined) throw refuse('NOT_FOUND', 'That adjustment doesn’t exist.');
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'rotation.adjustment_undone',
      targetType: 'rotation',
      targetId: rotation.id,
      before: { adjustmentId: input.adjustmentId, memberId: undone.memberId, units: undone.units },
    });
    const [listed] = (await adjustmentsOf(tx, rotation.id, undone.memberId)).filter(
      (each) => each.id === input.adjustmentId,
    );
    if (listed === undefined) throw new Error('The adjustment was not found again.');
    return listed;
  });
}
