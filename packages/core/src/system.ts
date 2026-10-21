// `@crm/core/system`: system power (spec 0009, AC-138, AC-147). The system
// actor and its scope, the door that enters a member again for work they
// started, the audiences the relay publishes to, and the view and task facts it
// filters `views` and `tasks` events by (specs 0020 and 0019). Lint allows this
// import only in the worker entry, `apps/api/src/jobs/**`,
// `apps/api/src/realtime/**` and `packages/core/scripts/**`.
export { audiences } from './access/audiences.ts';
export { enterAsActor, systemScope, type ActorDoorDeps } from './access/door.ts';
export { SYSTEM_ACTOR } from './engine/scope.ts';
// The daily cleanup's fan out (spec 0008, milestone 3): lists every workspace and starts a system job in each.
export {
  DAILY_BUDGET_MS,
  maintenanceKey,
  runDailyCleanup,
  type DailyCleanupDeps,
  type DailyCleanupInput,
  type DailyCleanupReport,
  type DailySweep,
} from './jobs/daily.ts';
// A deleted workspace's purge past its window (spec 0031, AC-823): the worker's daily cleanup runs it as crm_worker.
export { purgeWorkspace, PURGE_BATCH, type PurgeDeps, type PurgeOutcome } from './workspace/purge.ts';
export { viewFacts } from './views/facts.ts';
export { taskFacts } from './tasks/facts.ts';
export { meetingFacts } from './calendar/facts.ts';
// Spec 0031, AC-817: whom an `access` row's removal cuts off the workspace's live channel.
export { removedUserIds } from './members/facts.ts';
export {
  POLL_INTERVAL_MS,
  syncConnection,
  type CalendarSyncDeps,
  type CalendarSyncInput,
  type CalendarSyncOutcome,
} from './calendar/sync.ts';
// Booking emails (spec 0025, milestone 2): what each queued kind sends, read as the system by the worker's task.
export {
  markInvited,
  prepareBookingMail,
  whenLine,
  type BookingMail,
  type BookingMailDeps,
  type MailRow,
  type PreparedMail,
} from './booking/mail.ts';
export { BOOKING_MAIL_KINDS, type BookingMailKind } from './booking/mail-queue.ts';
// Sending a queued email (the emails lane): the worker's `crm_email` task reads one and records how sending went, and
// signs the preferences link it draws into an optional email.
export { finishEmail, loadEmail, type EmailOutcome, type EmailToSend, type LoadedEmail } from './emails/send.ts';
export { emailLinkToken } from './emails/preferences.ts';
export { prepareNotificationEmail, type PreparedNotificationEmail } from './notifications/email.ts';
export { markEmailed, NOTIFICATION_EMAIL_MAX, queueNextEmail, releaseEmailed } from './notifications/inbox.ts';
