// The booking email task (spec 0025, milestone 2): `crm_booking_mail`, which
// `crm_enqueue_booking_mail` queues (migration 0048) with ids and a kind only.
// It reads the booking again as the system, gets each message's words from
// core, draws and sends them, then marks the guests it invited. Without a mail
// transport (no APP_URL, or neither Resend nor Mailpit) it logs that it
// skipped and completes, as the spec says. A send that fails is logged; only
// when every message of the kind failed (the transport is down) does the task
// throw a plain error for Graphile to try again (5 tries), so one refused
// address never sends everyone else the same email again. Its `needs_host`
// kind (spec 0029, AC-749) first reseats a booking whose host left, and
// emails the admins only when nobody was free.
import {
  BOOKING_MAIL_KINDS,
  handOnBooking,
  remakeEvent,
  markGuestsTold,
  prepareBookingMail,
  type BookingMailDeps,
  type ReseatDeps,
  type systemScope,
} from '@crm/core/system';
import * as z from 'zod';
import { bookingEmail } from '../mail/booking.ts';
import type { Mailer } from '../mail/mailer.ts';

/** The task's name on Graphile's queue. */
export const BOOKING_MAIL_TASK = 'crm_booking_mail';

/** Its payload: what `crm_enqueue_booking_mail` writes, ids and a kind only. */
export const BookingMailPayload = z.strictObject({
  workspaceId: z.uuid(),
  bookingId: z.uuid(),
  kind: z.enum(BOOKING_MAIL_KINDS),
});
export type BookingMailPayload = z.infer<typeof BookingMailPayload>;

/** What the task needs: the system scope per workspace, the mailer (undefined: mail is off), and the links' parts. */
export interface BookingMailTaskDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly mailer: Mailer | undefined;
  readonly links: BookingMailDeps | undefined;
  /** The calendars a booking whose host left is reseated with (`needs_host`, spec 0029, AC-749). */
  readonly reseat?: ReseatDeps;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/** Sends one queued booking email kind. Throws (plainly) when a send fails, for a retry. */
export async function runBookingMail(deps: BookingMailTaskDeps, payload: unknown): Promise<void> {
  const parsed = BookingMailPayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to send, and nothing to retry.
    deps.log.warn('booking.mail.payload_invalid', {});
    return;
  }
  const { workspaceId, bookingId, kind } = parsed.data;
  if (kind === 'host_changed') {
    // Not an email: the booking's new organiser's calendar gets its event, the old one's is cancelled.
    const { calendar } = deps.reseat ?? {};
    if (calendar?.events !== undefined) {
      await remakeEvent(
        deps.systemScope(workspaceId),
        { events: calendar.events, ...(calendar.existing === undefined ? {} : { existing: calendar.existing }) },
        bookingId,
        deps.log,
      );
    }
    return;
  }
  if (kind === 'needs_host' && deps.reseat !== undefined) {
    // Not an email first: the booking's host left. Reseated through its rotations, it's done (`reassigned` tells
    // everyone); otherwise the admins are told below.
    const handed = await handOnBooking(deps.systemScope(workspaceId), deps.reseat, bookingId);
    if (!handed.needsHost) {
      deps.log.info('booking.handed_on', { bookingId });
      return;
    }
  }
  if (deps.mailer === undefined || deps.links === undefined) {
    deps.log.info('booking.mail.skipped', { bookingId, kind, reason: 'mail is off' });
    return;
  }
  const scope = deps.systemScope(workspaceId);
  const prepared = await prepareBookingMail(scope, deps.links, { bookingId, kind });
  if (prepared.skipped !== undefined) {
    deps.log.info('booking.mail.skipped', { bookingId, kind, reason: prepared.skipped });
    return;
  }
  // The footer's tag: a reminder's own, and one for every other booking email.
  const medium = kind === 'reminder_24h' || kind === 'reminder_1h' ? 'email_reminder' : 'email_booking';
  let failed = 0;
  for (const mail of prepared.messages) {
    try {
      await deps.mailer.send(await bookingEmail(mail, { appOrigin: deps.links.appOrigin, medium }));
    } catch (error) {
      failed += 1;
      // The error's class only: a message can quote the recipient.
      deps.log.warn('booking.mail.failed', { bookingId, kind, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
  if (failed > 0 && failed === prepared.messages.length) {
    throw new Error('A booking email failed to send; the worker log has its booking id.');
  }
  // One write for both lists: a retry after it can't send a removal again.
  await markGuestsTold(scope, bookingId, prepared);
  deps.log.info('booking.mail.sent', { bookingId, kind, messages: prepared.messages.length });
}
