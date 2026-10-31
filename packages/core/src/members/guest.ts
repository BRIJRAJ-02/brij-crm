// A member becoming a guest (spec 0031, slice 9; spec 0037, AC-1432): a guest can't host, so the role change takes
// them off everything that books them, inside the role change's own transaction, reusing the removal's own effects
// for those features (`REMOVAL_EFFECTS`), so a guest and a removed member leave scheduling the same way:
// - booking pages they alone host pause, and they leave every collective pool;
// - they leave every stored rotation (and drop out of the everyone rotation by `rotation_roster`'s role filter), and
//   each of their upcoming bookings is flagged "Needs a host", a round robin one queued to be reseated (AC-749);
// - their scheduling delegations go, both ways (a guest is never a delegate, AC-1255), with `access` rows.
// What stays: their calendars, records, tasks, teams and link page; access rules decide what they see from now.
import { sql } from 'drizzle-orm';
import type { GuestPreview } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { bookingPagesRemoval } from '../booking/pages.ts';
import type { WriteContext } from '../engine/write.ts';
import { rotationsRemoval } from '../rotation/removal.ts';
import { delegationsRemoval } from '../scheduling/delegations.ts';
import type { AuditSource } from './audit.ts';
import type { RemovalEffect } from './removal-effect.ts';

/** The removal effects a member becoming a guest runs too, in the removal's order. */
export const GUEST_EFFECTS: readonly RemovalEffect[] = [bookingPagesRemoval, rotationsRemoval, delegationsRemoval];

/** Runs every guest effect on `memberId`, in the role change's transaction, before their role is written. */
export async function leaveSchedulingAsGuest(
  context: WriteContext,
  memberId: string,
  source?: AuditSource,
): Promise<void> {
  for (const effect of GUEST_EFFECTS) await effect.run?.(context, memberId, source);
}

/**
 * What making `memberId` a guest will do, for the confirm dialog: the booking pages that pause, the rotations they
 * leave, their upcoming bookings that will need a host, and the delegations that go. Counted with no lock.
 */
export async function countBecomingGuest(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
): Promise<GuestPreview> {
  const pages = (await bookingPagesRemoval.count?.(tx, workspaceId, memberId))?.pausedPages ?? 0;
  const found = await tx.execute<{ rotations: number; bookings: number; delegations: number }>(sql`
    select
      (select count(distinct rr.rotation_id)::int from rotation_roster rr
        join rotations r on r.workspace_id = rr.workspace_id and r.id = rr.rotation_id and r.deleted_at is null
        where rr.workspace_id = ${workspaceId}::uuid and rr.member_id = ${memberId}::uuid) as rotations,
      (select count(*)::int from bookings b
        where b.workspace_id = ${workspaceId}::uuid and b.status = 'confirmed' and b.starts_at > now()
          and b.needs_host_at is null
          and exists (
            select 1 from booking_hosts h
            where h.workspace_id = b.workspace_id and h.booking_id = b.id and h.member_id = ${memberId}::uuid
          )) as bookings,
      (select count(*)::int from schedule_delegations d
        where d.workspace_id = ${workspaceId}::uuid
          and (d.delegate_member_id = ${memberId}::uuid or d.target_member_id = ${memberId}::uuid)) as delegations
  `);
  const row = found.rows[0];
  return {
    pausedPages: pages,
    rotations: row?.rotations ?? 0,
    upcomingBookings: row?.bookings ?? 0,
    delegations: row?.delegations ?? 0,
  };
}
