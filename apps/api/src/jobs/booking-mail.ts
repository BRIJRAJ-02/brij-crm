// The booking email task (spec 0025, milestone 2): `crm_booking_mail`, which
// `crm_enqueue_booking_mail` queues (migration 0048) with ids and a kind only.
// It reads the booking again as the system, gets each message's words from
// core, draws and sends them, then marks the guests it invited. Without a mail
// transport (no APP_URL, or neither Resend nor Mailpit) it logs that it
// skipped and completes, as the spec says. A send that fails is logged; only
// when every message of the kind failed (the transport is down) does the task
// throw a plain error for Graphile to try again (5 tries), so one refused
// address never sends everyone else the same email again.
import {
  BOOKING_MAIL_KINDS,
  markInvited,
  prepareBookingMail,
  type BookingMailDeps,
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
  let failed = 0;
  for (const mail of prepared.messages) {
    try {
      await deps.mailer.send(await bookingEmail(mail));
    } catch (error) {
      failed += 1;
      // The error's class only: a message can quote the recipient.
      deps.log.warn('booking.mail.failed', { bookingId, kind, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
  if (failed > 0 && failed === prepared.messages.length) {
    throw new Error('A booking email failed to send; the worker log has its booking id.');
  }
  await markInvited(scope, bookingId, prepared.invited);
  deps.log.info('booking.mail.sent', { bookingId, kind, messages: prepared.messages.length });
}
