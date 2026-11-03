// Linking a staff profile to a member (spec 0066, AC-6606; Rules settled: No cross table guard). No database guard
// spans appointment holds and meeting bookings, so linking refuses while the staff member's future live holds and the
// member's future confirmed meetings overlap, naming each overlap; once linked, the two engines block each other
// through the person lock and the loaders. `services.manage` only; both people's locks are held for the check and
// the write, in the global order, so no visit or meeting slips in between.
import { sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import { runWrite } from '../engine/write.ts';
import { auditSetup, hospitalityMember } from '../hospitality/gate.ts';
import { requireVisitApp } from './book.ts';
import { personLockKeys } from './locks.ts';

/** One overlap that stops a link: the visit's hold and the meeting, by their times. */
export interface LinkOverlap {
  readonly appointmentId: string;
  readonly bookingId: string;
  readonly start: string;
  readonly end: string;
}

/** The refusal's words, with the count. */
const overlapMessage = (count: number): string =>
  `${String(count)} of their visits ${count === 1 ? 'overlaps a meeting' : 'overlap meetings'} they already have. Move ${count === 1 ? 'it' : 'them'} first.`;

/**
 * Links staff profile `staffId` to member `memberId`, or unlinks it (`memberId` null). Refuses CONFLICT, with the
 * overlaps listed (`overlaps` on the error), while a future live hold of the staff member overlaps a future confirmed
 * meeting of the member; CONFLICT too when the member is already another staff profile. Linked staff then use the
 * member's own time off and blocks (one source).
 */
export async function linkStaffMember(
  scope: EngineScope,
  input: { readonly staffId: string; readonly memberId: string | null },
  deps: { readonly now?: () => Date } = {},
): Promise<{ readonly staffId: string; readonly memberId: string | null }> {
  requirePermission(scope, 'services.manage');
  hospitalityMember(scope);
  const staffId = checkId(input.staffId, 'That staff member doesn’t exist.');
  const memberId = input.memberId === null ? null : checkId(input.memberId, 'That member doesn’t exist.');
  const now = (deps.now?.() ?? new Date()).toISOString();
  const { result } = await runWrite(scope, async ({ tx }) => {
    await requireVisitApp(tx, scope.workspaceId);
    const [row] = (
      await tx.execute<{ member_id: string | null }>(sql`
        select member_id::text as member_id from staff where id = ${staffId}::uuid and archived_at is null for update
      `)
    ).rows;
    if (row === undefined) throw refuse('NOT_FOUND', 'That staff member doesn’t exist.');
    if (row.member_id === memberId) return { staffId, memberId };
    // Every person lock either side of the change, in the global order (no place lock: nothing at one place changes).
    const keys = personLockKeys(scope.workspaceId, [
      { id: staffId, memberId: row.member_id },
      { id: staffId, memberId },
      { id: staffId },
    ]);
    for (const key of keys) await lockKey(tx, key);
    if (memberId !== null) {
      const [member] = (
        await tx.execute<{ id: string }>(
          sql`select id::text from members where id = ${memberId}::uuid and status = 'active'`,
        )
      ).rows;
      if (member === undefined) throw refuse('NOT_FOUND', 'That member doesn’t exist.');
      const overlaps = (
        await tx.execute<{ appointment_id: string; booking_id: string; starts_at: string; ends_at: string }>(sql`
          select h.appointment_id::text as appointment_id, b.booking_id::text as booking_id,
            greatest(h.starts_at, b.starts_at) as starts_at, least(h.ends_at, b.ends_at) as ends_at
          from appointment_holds h
          join booking_hosts b on b.member_id = ${memberId}::uuid and b.status = 'confirmed'
            and b.starts_at < h.ends_at and b.ends_at > h.starts_at
          where h.staff_id = ${staffId}::uuid and h.live and h.ends_at > ${now}::timestamptz
          order by 3
          limit 50
        `)
      ).rows;
      if (overlaps.length > 0) {
        throw Object.assign(refuse('CONFLICT', overlapMessage(overlaps.length)), {
          overlaps: overlaps.map((overlap): LinkOverlap => ({
            appointmentId: overlap.appointment_id,
            bookingId: overlap.booking_id,
            start: new Date(overlap.starts_at).toISOString(),
            end: new Date(overlap.ends_at).toISOString(),
          })),
        });
      }
    }
    try {
      await tx.execute(sql`
        update staff set member_id = ${memberId}::uuid, updated_at = now(), updated_by_member_id = ${hospitalityMember(scope)}::uuid
        where id = ${staffId}::uuid
      `);
    } catch (error) {
      if (postgresError(error)?.code === '23505')
        throw refuse('CONFLICT', 'That member is already another staff profile.');
      throw error;
    }
    await auditSetup(tx, scope, memberId === null ? 'staff.unlinked' : 'staff.linked', { staffId });
    return { staffId, memberId };
  });
  return result;
}
