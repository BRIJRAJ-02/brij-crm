// A booking's emails go out as queued work (spec 0025, Emails): each change
// queues its kind through `crm_enqueue_booking_mail` (migration 0048) inside
// the transaction that records it, so an email is queued exactly when the
// change commits. The worker's `crm_booking_mail` task reads the booking again
// and sends (`mail.ts`); a reminder is queued for its time and replaced by a
// move, and finds a cancelled booking cancelled and sends nothing.
import { eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { WrittenEvent } from './calendar.ts';

const { bookings } = schema;

/** The kinds of booking email. */
export const BOOKING_MAIL_KINDS = [
  'confirmed',
  'cancelled',
  'moved',
  'guests',
  'reassigned',
  'needs_host',
  'host_changed',
  'reminder_24h',
  'reminder_1h',
  // A page that requires confirmation (spec 0062, AC-6203): the request's emails, the worker's Confirm step that
  // writes the calendar event before the confirmation, the decline's email, and the wait that declines it.
  'requested',
  'approved',
  'declined',
  'pending_expire',
] as const;

/** One kind of booking email. */
export type BookingMailKind = (typeof BOOKING_MAIL_KINDS)[number];

/** Queues each kind for the booking, in the caller's transaction (a reminder whose time has passed is skipped). */
export async function enqueueBookingMail(
  tx: WorkspaceTx,
  bookingId: string,
  kinds: readonly BookingMailKind[],
): Promise<void> {
  for (const kind of kinds) await tx.execute(sql`select crm_enqueue_booking_mail(${bookingId}::uuid, ${kind})`);
}

/**
 * What became of the booking's calendar event once the calls after the commit
 * were made: where it lives and its video link, or that it failed (the host
 * sees a warning). `undefined` is a failure.
 */
export async function recordEvent(
  tx: WorkspaceTx,
  bookingId: string,
  written: WrittenEvent | undefined,
  /** The page's own meeting link (critic B-07): the booking's link when the calendar made none. */
  ownLink?: string,
): Promise<void> {
  await tx
    .update(bookings)
    .set(
      written === undefined
        ? { eventFailedAt: sql`now()`, ...(ownLink === undefined ? {} : { videoUrl: ownLink, updatedAt: sql`now()` }) }
        : {
            meetingId: written.meetingId ?? null,
            videoUrl: written.videoUrl ?? ownLink ?? null,
            eventFailedAt: null,
            updatedAt: sql`now()`,
          },
    )
    .where(eq(bookings.id, bookingId));
}

/**
 * A location as anyone who hasn't booked may see it: a host's own meeting link left out (critic B-07), for the public
 * page, a member who may only see the page, and a booking seen over its host.
 */
export function withoutMeetingLink<Location extends { readonly type: string }>(
  location: Location,
): Location | { readonly type: 'video' } {
  return location.type === 'video' ? { type: 'video' } : location;
}

/** A video page's own meeting link, when its host gave one (critic B-07). */
export function ownMeetingLink(location: { readonly type: string; readonly link?: string }): string | undefined {
  return location.type === 'video' ? location.link : undefined;
}
