// The notifications email task (spec 0038, AC-1176, AC-1177):
// `crm_notification_email`, which `crm_enqueue_notification_email` queues
// (migration 0052) five minutes after a notification, keyed per member and
// workspace so a burst queues one. It enters as the member (one removed since
// gets nothing), reads every notification still due and visible to them now,
// claims them (marked emailed, committed), then draws one email and sends it;
// a failed send gives them back for the retry, so none goes twice.
// Without a mail transport it logs that it skipped and completes. A failed
// send throws a plain error for Graphile to try again (5 tries).
import { markEmailed, prepareNotificationEmail, releaseEmailed, type ActorDoorDeps } from '@crm/core/system';
import { renderNotificationsEmail } from '@crm/emails';
import * as z from 'zod';
import type { Mailer } from '../mail/mailer.ts';

/** The task's name on Graphile's queue. */
export const NOTIFICATION_EMAIL_TASK = 'crm_notification_email';

/** Its payload: what `crm_enqueue_notification_email` writes, ids only. */
export const NotificationEmailPayload = z.strictObject({
  workspaceId: z.uuid(),
  memberId: z.uuid(),
});
export type NotificationEmailPayload = z.infer<typeof NotificationEmailPayload>;

/** What the task needs: the member door's deps, the mailer (undefined: mail is off) and the app's origin. */
export interface NotificationEmailTaskDeps {
  readonly door: ActorDoorDeps;
  readonly mailer: Mailer | undefined;
  readonly appOrigin: string | undefined;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/** Sends one member's notifications email. Throws (plainly) when the send fails, for a retry. */
export async function runNotificationEmail(deps: NotificationEmailTaskDeps, payload: unknown): Promise<void> {
  const parsed = NotificationEmailPayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to send, and nothing to retry.
    deps.log.warn('notification.email.payload_invalid', {});
    return;
  }
  const { workspaceId, memberId } = parsed.data;
  if (deps.mailer === undefined || deps.appOrigin === undefined) {
    deps.log.info('notification.email.skipped', { workspaceId, memberId, reason: 'mail is off' });
    return;
  }
  const prepared = await prepareNotificationEmail(deps.door, { workspaceId, memberId });
  if (prepared.skipped !== undefined) {
    deps.log.info('notification.email.skipped', { workspaceId, memberId, reason: prepared.skipped });
    return;
  }
  const email = await renderNotificationsEmail(prepared.params, {
    appOrigin: deps.appOrigin,
    workspaceName: prepared.workspaceName,
  });
  // Claimed before it goes, so a task that sent and then failed never sends the same email on its retry.
  await markEmailed(prepared.scope, prepared.ids);
  const failure = await deps.mailer
    .send({ to: prepared.to.email, subject: email.subject, html: email.html, text: email.text })
    .then(
      () => undefined,
      // The error's class only: a message can quote the recipient.
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
  if (failure !== undefined) {
    await releaseEmailed(prepared.scope, prepared.ids);
    deps.log.warn('notification.email.failed', { workspaceId, memberId, error: failure });
    throw new Error('A notifications email failed to send; the worker log has its member id.');
  }
  deps.log.info('notification.email.sent', { workspaceId, memberId, notifications: prepared.ids.length });
}
