// The rotation's ledger (spec 0029, AC-742; spec 0037 AC-1430): one live row
// per assignment, counted on read as the sum of live `units` over the window,
// under the rotation's advisory lock, so two writers never both see the same
// counts. Lock order everywhere: every rotation lock (by id), then every host
// lock (by id); nothing that holds a host lock asks for a rotation lock.
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { uuidArray } from '../engine/ids.ts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { actorRow } from '../engine/scope.ts';
import { lockKey } from '../booking/locks.ts';
import type { PickDetail, PickReason } from './pick.ts';

const { rotationAssignments } = schema;

/** The lock on one rotation's counts: every assignment from it takes it first. */
export const rotationLockKey = (workspaceId: string, rotationId: string) =>
  `booking:rotation:${workspaceId}:${rotationId}`;

/** Takes the rotation's lock for the rest of the transaction. */
export async function lockRotation(tx: WorkspaceTx, workspaceId: string, rotationId: string): Promise<void> {
  await lockKey(tx, rotationLockKey(workspaceId, rotationId));
}

/** A member's live count in the window, and their newest assignment in it. */
export interface WindowCount {
  readonly count: number;
  readonly lastAssignedAt: Date;
}

/** Every member's live units in the rotation since `since`: one grouped count over `rotation_assignments_window`. */
export async function windowCounts(
  tx: WorkspaceTx,
  rotationId: string,
  since: Date,
): Promise<ReadonlyMap<string, WindowCount>> {
  const rows = await tx
    .select({
      memberId: rotationAssignments.memberId,
      count: sql<number>`coalesce(sum(${rotationAssignments.units}), 0)::int`,
      lastAssignedAt: sql<string>`max(${rotationAssignments.assignedAt})`,
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
  return new Map(rows.map((row) => [row.memberId, { count: row.count, lastAssignedAt: new Date(row.lastAssignedAt) }]));
}

/**
 * Each member's live assignments in the rotation that count on a day in
 * [from, to), for the daily and weekly caps (AC-731, AC-1326): a booking's
 * meeting start (while it is confirmed), a lead's assignment time.
 */
export async function capStarts(
  tx: WorkspaceTx,
  rotationId: string,
  memberIds: readonly string[],
  from: Date,
  to: Date,
  /** A booking being moved: it doesn't count against its own new time. */
  except?: string,
): Promise<ReadonlyMap<string, readonly Date[]>> {
  const found = new Map<string, Date[]>(memberIds.map((id) => [id, []]));
  if (memberIds.length === 0) return found;
  const rows = await tx.execute<{ member_id: string; at: string }>(sql`
    select a.member_id::text as member_id, coalesce(b.starts_at, a.assigned_at) as at
    from rotation_assignments a
    left join bookings b on b.workspace_id = a.workspace_id and b.id = a.booking_id
    where a.rotation_id = ${rotationId}::uuid and a.voided_at is null and a.source <> 'adjustment'
      and a.member_id = any(${uuidArray(memberIds)})
      and (a.booking_id is null or b.status = 'confirmed')
      ${except === undefined ? sql`` : sql`and a.booking_id is distinct from ${except}::uuid`}
      and coalesce(b.starts_at, a.assigned_at) >= ${from.toISOString()}::timestamptz
      and coalesce(b.starts_at, a.assigned_at) < ${to.toISOString()}::timestamptz
  `);
  for (const row of rows.rows) found.get(row.member_id)?.push(new Date(row.at));
  return found;
}

/** The window's start: now less the rotation's days. */
export const windowStart = (now: Date, windowDays: number) => new Date(now.getTime() - windowDays * 86_400_000);

/** What one ledger row records. */
export interface AssignmentRow {
  readonly rotationId: string;
  readonly memberId: string;
  readonly source: 'booking' | 'form' | 'adjustment';
  readonly bookingId?: string;
  readonly recordId?: string;
  readonly reason: PickReason | 'manual' | 'reassigned' | 'standin' | 'routed' | 'adjustment';
  readonly detail: PickDetail | Readonly<Record<string, unknown>>;
}

/** Writes one ledger row in the caller's transaction (which holds the rotation's lock), as the scope's actor. */
export async function writeAssignment(tx: WorkspaceTx, scope: EngineScope, row: AssignmentRow): Promise<string> {
  const by = actorRow(scope.actor);
  const [made] = await tx
    .insert(rotationAssignments)
    .values({
      workspaceId: scope.workspaceId,
      rotationId: row.rotationId,
      memberId: row.memberId,
      source: row.source,
      bookingId: row.bookingId ?? null,
      recordId: row.recordId ?? null,
      reason: row.reason,
      detail: row.detail,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .returning({ id: rotationAssignments.id });
  if (made === undefined) throw new Error('The assignment was not stored.');
  return made.id;
}
