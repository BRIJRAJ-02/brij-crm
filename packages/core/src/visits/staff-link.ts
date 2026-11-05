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
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { auditSetup, hospitalityMember } from '../hospitality/gate.ts';
import { writeAudits, type AuditEntry } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
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
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly staffId: string; readonly memberId: string | null }> {
  requirePermission(scope, 'services.manage');
  hospitalityMember(scope);
  const staffId = checkId(input.staffId, 'That staff member doesn’t exist.');
  const memberId = input.memberId === null ? null : checkId(input.memberId, 'That member doesn’t exist.');
  const now = (deps.now?.() ?? new Date()).toISOString();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await requireVisitApp(tx, scope.workspaceId);
      // The person locks come BEFORE the staff row's lock, in the order a booking takes them (a booking holds a person
      // lock while its holds take a key share on this row), so a link and a booking never wait on each other in a ring.
      const read = async (lock: boolean) =>
        (
          await tx.execute<{ member_id: string | null }>(sql`
          select member_id::text as member_id from staff where id = ${staffId}::uuid and archived_at is null
          ${lock ? sql`for no key update` : sql``}
        `)
        ).rows[0];
      const seen = await read(false);
      if (seen === undefined) throw refuse('NOT_FOUND', 'That staff member doesn’t exist.');
      if (seen.member_id === memberId) return { staffId, memberId };
      // Every person lock either side of the change, in the global order (no place lock: nothing at one place changes).
      const keys = personLockKeys(scope.workspaceId, [
        { id: staffId, memberId: seen.member_id },
        { id: staffId, memberId },
        { id: staffId },
      ]);
      for (const key of keys) await lockKey(tx, key);
      const row = await read(true);
      if (row === undefined) throw refuse('NOT_FOUND', 'That staff member doesn’t exist.');
      if (row.member_id !== seen.member_id) throw refuse('CONFLICT', 'That staff member changed meanwhile. Try again.');
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
      // One `visits` event naming their places, so every open team and calendar reads the link again (spec 0066 B1).
      const places = (
        await tx.execute<{ place_id: string }>(
          sql`select place_id::text from staff_places where staff_id = ${staffId}::uuid`,
        )
      ).rows.map((each) => each.place_id);
      if (places.length > 0) context.record({ visits: places });
      return { staffId, memberId };
    },
    hooks,
  );
  return result;
}

/**
 * A removed member's staff profile is unlinked (spec 0066, AC-6606; security review, 4 Nov 2026). The link is live,
 * not history: while it holds, the profile's time comes from the member's meetings, blocks and calendars and its own
 * time off is ignored, so a member who left would keep deciding when the business's staff member is free. The profile
 * stays, the business's own record, back on its own time off; each one unlinked gets a `staff.unlinked` row, as an
 * unlink by hand does. Runs whatever the visit app's state, since a link outlives the app being removed.
 */
export const staffLinkRemoval: RemovalEffect = {
  feature: 'staff links',
  constraints: ['staff_member'],
  run: async ({ tx, scope }, memberId, source) => {
    const unlinked = await tx.execute<{ id: string }>(sql`
      update staff set member_id = null, updated_at = now(), updated_by_member_id = ${actorRow(scope.actor).memberId}::uuid
      where workspace_id = ${scope.workspaceId}::uuid and member_id = ${memberId}::uuid
      returning id::text
    `);
    await writeAudits(
      tx,
      scope.workspaceId,
      scope.actor,
      unlinked.rows.map((row): AuditEntry => ({
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { hospitality: 'staff.unlinked', staffId: row.id },
      })),
      source,
    );
  },
};
