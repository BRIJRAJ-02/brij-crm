// A reservation's guest email task (spec 0066 B7 lite): `crm_visit_mail`, which `crm_enqueue_visit_mail` queues
// (migration 0177) with ids and a kind only. It reads the visit again as the system, gets the words from core
// (`prepareVisitMail`), draws them with the booking emails' layout and sends them with the calendar file. Without a
// mail transport it logs that it skipped and completes. A failed send throws a plain error for Graphile to try again
// (5 tries), under the same idempotency key, so a send that reached the service but timed out here goes once.
import { prepareVisitMail, VISIT_MAIL_KINDS, type systemScope, type VisitMailDeps } from '@crm/core/system';
import * as z from 'zod';
import { bookingEmail } from '../mail/booking.ts';
import type { Mailer } from '../mail/mailer.ts';

/** The task's name on Graphile's queue. */
export const VISIT_MAIL_TASK = 'crm_visit_mail';

/** Its payload: what `crm_enqueue_visit_mail` writes, ids and a kind only. */
export const VisitMailPayload = z.strictObject({
  workspaceId: z.uuid(),
  appointmentId: z.uuid(),
  kind: z.enum(VISIT_MAIL_KINDS),
});
export type VisitMailPayload = z.infer<typeof VisitMailPayload>;

/** What the task needs: the system scope per workspace, the mailer (undefined: mail is off), and the links' parts. */
export interface VisitMailTaskDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly mailer: Mailer | undefined;
  readonly links: VisitMailDeps | undefined;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/** Sends one queued reservation email. Throws (plainly) when the send fails, for a retry. */
export async function runVisitMail(deps: VisitMailTaskDeps, payload: unknown): Promise<void> {
  const parsed = VisitMailPayload.safeParse(payload);
  if (!parsed.success) {
    deps.log.warn('visit.mail.payload_invalid', {});
    return;
  }
  const { workspaceId, appointmentId, kind } = parsed.data;
  if (deps.mailer === undefined || deps.links === undefined) {
    deps.log.info('visit.mail.skipped', { appointmentId, kind, reason: 'mail is off' });
    return;
  }
  const prepared = await prepareVisitMail(deps.systemScope(workspaceId), deps.links, { appointmentId, kind });
  if (prepared.skipped !== undefined) {
    deps.log.info('visit.mail.skipped', { appointmentId, kind, reason: prepared.skipped });
    return;
  }
  const medium = kind === 'reminder_24h' || kind === 'reminder_2h' ? 'email_reminder' : 'email_booking';
  for (const [index, mail] of prepared.messages.entries()) {
    try {
      await deps.mailer.send({
        ...(await bookingEmail(mail, {
          appOrigin: deps.links.appOrigin,
          medium,
          ...(deps.links.publicOrigin === undefined ? {} : { publicOrigin: deps.links.publicOrigin }),
        })),
        ...(prepared.stamp === undefined
          ? {}
          : { idempotencyKey: `visit/${appointmentId}/${kind}/${String(prepared.stamp)}/${String(index)}` }),
      });
    } catch (error) {
      // The error's class only: a message can quote the recipient.
      deps.log.warn('visit.mail.failed', {
        appointmentId,
        kind,
        error: error instanceof Error ? error.name : 'unknown',
      });
      throw new Error('A reservation email failed to send; the worker log has its visit id.', { cause: error });
    }
  }
  deps.log.info('visit.mail.sent', { appointmentId, kind, messages: prepared.messages.length });
}
