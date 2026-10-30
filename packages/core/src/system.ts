// `@crm/core/system`: system power (spec 0009, AC-138, AC-147). The system
// actor and its scope, the door that enters a member again for work they
// started, the audiences the relay publishes to, and the view and task facts it
// filters `views` and `tasks` events by (specs 0020 and 0019). Lint allows this
// import only in the worker entry, `apps/api/src/jobs/**`,
// `apps/api/src/realtime/**` and `packages/core/scripts/**`.
export { audiences } from './access/audiences.ts';
export { enterAsActor, enterAsAutomation, systemScope, type ActorDoorDeps } from './access/door.ts';
// Automations (parity #53): the worker's `crm_automation` task runs the queued runs as the member each runs as; the
// due sweep queues the tasks that came due; the daily cleanup prunes old runs and long deleted automations.
export {
  derivedTaskId,
  pruneAutomations,
  queueDueAutomations,
  runAutomationQueue,
  type AutomationLog,
  type AutomationRunDeps,
} from './automations/run.ts';
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
  markGuestsTold,
  prepareBookingMail,
  whenLine,
  type BookingMail,
  type BookingMailDeps,
  type MailRow,
  type PreparedMail,
} from './booking/mail.ts';
export { BOOKING_MAIL_KINDS, type BookingMailKind } from './booking/mail-queue.ts';
// A member who left: their round robin bookings handed on through the rotations (spec 0029, AC-749).
export { handOnBooking, rotationsRemoval } from './rotation/removal.ts';
export { remakeEvent } from './rotation/reseat.ts';
export type { ReseatDeps } from './rotation/reassign.ts';
// Sending a queued email (the emails lane): the worker's `crm_email` task reads one and records how sending went, and
// signs the preferences link it draws into an optional email.
export { finishEmail, loadEmail, type EmailOutcome, type EmailToSend, type LoadedEmail } from './emails/send.ts';
export { emailLinkToken } from './emails/preferences.ts';
export { prepareNotificationEmail, type PreparedNotificationEmail } from './notifications/email.ts';
export { markEmailed, NOTIFICATION_EMAIL_MAX, queueNextEmail, releaseEmailed } from './notifications/inbox.ts';
// The member told of someone else's change to their scheduling (spec 0037, AC-1264): the worker's
// `crm_scheduling_notice` task.
export { runSchedulingNotice, type SchedulingNoticeOutcome } from './scheduling/notice.ts';
// Calendar health emails (spec 0037, AC-1310, AC-1311): the sweep's hold and the worker's
// `crm_calendar_health_email` task, one episode's first email or reminder.
export {
  CALENDAR_HEALTH,
  isMassOutage,
  runCalendarHealthEmail,
  type CalendarHealthEmailOutcome,
} from './calendar/health-notices.ts';
