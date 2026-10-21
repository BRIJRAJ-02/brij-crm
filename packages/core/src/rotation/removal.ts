// The rotations' part of a member's removal (spec 0029, AC-749; spec 0037,
// AC-1440), shaped as the members lane's `RemovalEffect` (its
// `removal-effect.ts`), which registers it in `REMOVAL_EFFECTS`. Inside the
// removal's transaction: the member leaves every rotation, and each of their
// upcoming bookings is flagged "Needs a host"; each round robin one is queued
// (`needs_host`) for the worker to reseat through its rotations after the
// commit, which clears the flag, or tells the admins when nobody is free
// (`handOnBooking`). A personal page's booking is only flagged, never moved.
import { and, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { enqueueBookingMail } from '../booking/mail-queue.ts';
import { isRefusal } from '../engine/refusals.ts';
import { reseatFor, type ReseatDeps } from './reassign.ts';

const { bookingHosts, bookings, members } = schema;

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
    const { tx } = context;
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
 * Hands on a flagged booking (the worker's `needs_host`): every host of it who is no longer an active member gives
 * their seats up through the rotations. All reseated: the flag clears (the reseat's own write) and `reassigned`
 * tells the guest and hosts. A seat nobody can take, or a fixed host who left: the flag stays, and the answer says
 * the admins should be told.
 */
export async function handOnBooking(
  scope: EngineScope,
  deps: ReseatDeps,
  bookingId: string,
): Promise<{ readonly needsHost: boolean }> {
  const gone = await inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ needsHostAt: bookings.needsHostAt, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (row?.needsHostAt === null || row?.status !== 'confirmed') return undefined;
    const left = await tx
      .select({ memberId: bookingHosts.memberId })
      .from(bookingHosts)
      .innerJoin(members, and(eq(members.workspaceId, bookingHosts.workspaceId), eq(members.id, bookingHosts.memberId)))
      .where(and(eq(bookingHosts.bookingId, bookingId), sql`${members.status} <> 'active'`));
    return left.map((each) => each.memberId);
  });
  if (gone === undefined) return { needsHost: false };
  let stuck = false;
  for (const memberId of gone) {
    try {
      const done = await reseatFor(scope, deps, { bookingId, memberId });
      if (!done.changed) stuck = true;
    } catch (error) {
      if (!isRefusal(error)) throw error;
      stuck = true;
    }
  }
  if (stuck) {
    // The reseat that did land cleared the flag with its write: set it again, since a host is still missing.
    await inWorkspace(scope, (tx) =>
      tx
        .update(bookings)
        .set({ needsHostAt: sql`coalesce(${bookings.needsHostAt}, now())` })
        .where(eq(bookings.id, bookingId)),
    );
  }
  return { needsHost: stuck };
}
