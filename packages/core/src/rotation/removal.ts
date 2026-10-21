// The rotations' part of a member's removal (spec 0029, AC-749; spec 0037,
// AC-1440), shaped as the members lane's `RemovalEffect` (its
// `removal-effect.ts`), which registers it in `REMOVAL_EFFECTS`. Inside the
// removal's transaction: the member leaves every rotation, and each of their
// upcoming bookings is flagged "Needs a host"; each round robin one is queued
// (`needs_host`) for the worker to reseat through its rotations after the
// commit, which clears the flag, or tells the admins when nobody is free
// (`handOnBooking`). A personal page's booking is only flagged, never moved.
import { eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { enqueueBookingMail } from '../booking/mail-queue.ts';
import { isRefusal } from '../engine/refusals.ts';
import { lockRotations } from './assign.ts';
import { reseatGone, type ReseatDeps } from './reassign.ts';

const { bookings } = schema;

/** The removal's transaction and actor, as the members lane's `WriteContext` gives them. */
interface RemovalContext {
  readonly tx: WorkspaceTx;
  readonly scope: EngineScope;
}

/** The rotations' removal effect: what the members lane runs, and the foreign keys it looks after. */
export const rotationsRemoval = {
  feature: 'rotations',
  // They leave every pool; their ledger rows and past `booking_hosts` rows stay as history (`KEPT_ON_REMOVAL`).
  constraints: ['rotation_members_member'],
  run: async (context: RemovalContext, memberId: string): Promise<void> => {
    const { tx, scope } = context;
    // Under each of their rotations' locks, so no pick in flight seats them from a team read before they left.
    const theirs = await tx.execute<{ id: string }>(
      sql`select rotation_id::text as id from rotation_members where member_id = ${memberId}::uuid`,
    );
    await lockRotations(
      tx,
      scope.workspaceId,
      theirs.rows.map((row) => row.id),
    );
    await tx.execute(sql`delete from rotation_members where member_id = ${memberId}::uuid`);
    const flagged = await tx.execute<{ id: string; kind: string }>(sql`
      update bookings b set needs_host_at = now()
      from booking_pages p
      where p.workspace_id = b.workspace_id and p.id = b.page_id
        and b.status = 'confirmed' and b.starts_at > now() and b.needs_host_at is null
        and exists (
          select 1 from booking_hosts h
          where h.workspace_id = b.workspace_id and h.booking_id = b.id and h.member_id = ${memberId}::uuid
        )
      returning b.id::text as id, p.kind
    `);
    for (const row of flagged.rows) {
      if (row.kind === 'round_robin') await enqueueBookingMail(tx, row.id, ['needs_host']);
    }
  },
};

/**
 * Hands on a flagged booking (the worker's `needs_host`): each seat whose holder left the workspace or the rotation,
 * or was switched off and handed on by an admin, is reseated through its rotation (`reseatGone`), which clears the
 * flag once no departed host remains and tells the guest and hosts (`reassigned`). A seat nobody can take, or a fixed
 * host who left: the flag stays, and the answer says the admins should be told.
 */
export async function handOnBooking(
  scope: EngineScope,
  deps: ReseatDeps,
  bookingId: string,
): Promise<{ readonly needsHost: boolean }> {
  const flagged = await inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ needsHostAt: bookings.needsHostAt, status: bookings.status, startsAt: bookings.startsAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return row !== undefined && row.needsHostAt !== null && row.status === 'confirmed';
  });
  if (!flagged) return { needsHost: false };
  let missing: boolean;
  try {
    missing = (await reseatGone(scope, deps, bookingId)).missing;
  } catch (error) {
    // Started or cancelled meanwhile: nothing left to hand on.
    if (isRefusal(error)) return { needsHost: false };
    throw error;
  }
  if (!missing) {
    // A switched off host is still an active member, so the reseat left the flag: it has a host now.
    await inWorkspace(scope, (tx) => tx.update(bookings).set({ needsHostAt: null }).where(eq(bookings.id, bookingId)));
    return { needsHost: false };
  }
  return { needsHost: true };
}
