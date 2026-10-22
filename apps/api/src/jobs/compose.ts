// What the job runners run (spec 0008), put together once from the environment
// and the pool: the core runner and its registry, calendar sync (spec 0024),
// booking emails (spec 0025) and the daily cleanup. The worker process and the
// api's job drain on Vercel (spec 0045) both build their runners from this, so
// a job runs the same way wherever it runs.
import { connectedCalendar, jobKinds, NO_CALENDAR, type JobRegistry, type QueueRows, type Runner } from '@crm/core';
import { purgeWorkspace, runDailyCleanup, syncConnection, systemScope } from '@crm/core/system';
import type { CalendarSyncInput, CalendarSyncOutcome, DailyCleanupInput, DailyCleanupReport } from '@crm/core/system';
import type { AppEnvironment } from '@crm/contracts';
import type { Database, QueueConnection } from '@crm/db';
import { bookingLinkKey } from '../booking-link.ts';
import { createFreeDomains } from '../calendar/free-domains.ts';
import { createGoogleCalendar } from '../calendar/google.ts';
import { createMicrosoftCalendar } from '../calendar/microsoft.ts';
import { GOOGLE_NOTIFY_PATH, MICROSOFT_NOTIFY_PATH } from '../calendar/services.ts';
import { emailLinkKey } from '../email-link.ts';
import type { CalendarSettings } from '../env.ts';
import { backgroundHooks } from '../hooks.ts';
import { log } from '../log.ts';
import { createMailer, pacedMailer } from '../mail/mailer.ts';
import { parseSender } from '../mail/mailpit.ts';
import { APP_RULES } from '../rules.ts';
import { runBookingMail } from './booking-mail.ts';
import { runEmail, type EmailRun, type EmailTry } from './email.ts';
import { runnerTasks } from './graphile.ts';
import { runNotificationEmail } from './notification-email.ts';
import { createJobRunner } from './runner.ts';

/** The gap between sends: under Resend's 2 requests a second, with room for the api's. */
const MAIL_GAP_MS = 600;

/** The variables the jobs read: the worker's and the api's environments both have them. */
export interface JobTasksEnv {
  readonly APP_ENV: AppEnvironment;
  readonly APP_URL?: string | undefined;
  readonly BOOKING_PUBLIC_ORIGIN?: string | undefined;
  readonly BOOKING_LINK_SECRET?: string | undefined;
  readonly WORKER_WAKE_SECRET?: string | undefined;
  readonly JOBS_RUNNER?: 'on' | 'off' | undefined;
  readonly RESEND_API_KEY?: string | undefined;
  readonly MAIL_FROM: string;
  readonly MAILPIT_URL?: string | undefined;
  readonly calendar: CalendarSettings | undefined;
}

/** What `composeJobTasks` needs: the environment, the tenant pool, and who hears that a job stored a change. */
export interface JobTasksOptions {
  readonly env: JobTasksEnv;
  readonly db: Database;
  /** A batch, a sync or the cleanup stored a change event: the relay publishes it, where there is one. */
  readonly onStored: () => void;
  /** The queue rows the daily cleanup's requeue phase reads, while the queue is open. */
  readonly queue?: QueueRows;
}

/** The runners' work, ready for `startJobRunners`. */
export interface JobTasks {
  readonly registry: JobRegistry;
  readonly runner: Runner;
  /** Calendar sync, when `CALENDAR_SYNC=on`; off, its queue rows wait. */
  readonly calendar: ((input: CalendarSyncInput) => Promise<CalendarSyncOutcome>) | undefined;
  /** One queued booking email; without APP_URL or a transport it is logged and dropped. */
  readonly bookingMail: (payload: unknown) => Promise<void>;
  /** One queued email (`crm_email`); absent without APP_URL, so its rows wait for a worker that can send. */
  readonly email: ((payload: unknown, attempt: EmailTry) => Promise<EmailRun>) | undefined;
  /** One notification email a member, entered as that member; without a transport it is logged and dropped. */
  readonly notificationEmail: (payload: unknown) => Promise<void>;
  /** The daily cleanup's fan out on an open queue connection (only crm_worker may sweep). */
  readonly daily: (sweep: QueueConnection) => (input: DailyCleanupInput) => Promise<DailyCleanupReport>;
  /** The task identifiers these runners take: only their rows count as due. */
  readonly tasks: readonly string[];
}

/** Builds the runners' work once, logging which parts are off and why. */
export function composeJobTasks(options: JobTasksOptions): JobTasks {
  const { env, db, onStored } = options;
  const registry = jobKinds({
    environment: env.APP_ENV,
    ...(options.queue === undefined ? {} : { queue: options.queue }),
  });
  const runner = createJobRunner({
    db,
    registry,
    // A member's job runs under the same rules as their requests (rules.ts).
    rules: APP_RULES,
    onStored,
    log,
  });

  // Calendar sync (spec 0024), when CALENDAR_SYNC=on: each connection's sync runs on the light runner as the system,
  // calling the provider outside every transaction; a sync that stored events tells `onStored`. Off, its rows wait.
  const calendar =
    env.calendar === undefined
      ? undefined
      : (() => {
          const settings = env.calendar;
          const deps = {
            providers: {
              google: createGoogleCalendar({ clientId: settings.clientId, clientSecret: settings.clientSecret }),
              // Outlook (milestone 4), where CALENDAR_OUTLOOK=on.
              ...(settings.microsoft === undefined ? {} : { microsoft: createMicrosoftCalendar(settings.microsoft) }),
            },
            tokenKey: settings.tokenKey,
            systemScope: (workspaceId: string) => systemScope(db, workspaceId),
            hooks: backgroundHooks(),
            isFreeDomain: createFreeDomains(),
            // Push (spec 0024, milestone 2): channels open only where the provider can reach us; locally the poll alone runs.
            ...(settings.webhookOrigin === undefined
              ? {}
              : {
                  pushAddresses: {
                    google: new URL(GOOGLE_NOTIFY_PATH, settings.webhookOrigin).toString(),
                    microsoft: new URL(MICROSOFT_NOTIFY_PATH, settings.webhookOrigin).toString(),
                  },
                }),
            onStored,
          };
          return async (input: CalendarSyncInput) => {
            const outcome = await syncConnection(deps, input);
            if (outcome.kind === 'synced') onStored();
            return outcome;
          };
        })();
  if (calendar === undefined) log.info('calendar.off', { reason: 'CALENDAR_SYNC is not on' });

  // The mail transport (Resend, or Mailpit locally), the api's own, for a booking's emails and queued email. Its
  // sends are paced (one at a time, 600ms apart): the runners take several jobs at once, and Resend takes 2
  // requests a second for the whole team, the api's sign in codes included.
  const mailer =
    env.APP_URL === undefined || (env.RESEND_API_KEY === undefined && env.MAILPIT_URL === undefined)
      ? undefined
      : pacedMailer(
          createMailer({ RESEND_API_KEY: env.RESEND_API_KEY, MAIL_FROM: env.MAIL_FROM, MAILPIT_URL: env.MAILPIT_URL }),
          MAIL_GAP_MS,
        );
  if (mailer === undefined) log.info('booking.mail.off', { reason: 'APP_URL or a mail transport is not set' });
  const links =
    env.APP_URL === undefined
      ? undefined
      : {
          appOrigin: new URL(env.APP_URL).origin,
          ...(env.BOOKING_PUBLIC_ORIGIN === undefined
            ? {}
            : { publicOrigin: new URL(env.BOOKING_PUBLIC_ORIGIN).origin }),
          linkKey: bookingLinkKey(env),
          organizerEmail: parseSender(env.MAIL_FROM).email,
        };
  // A booking whose host left is reseated against the hosts' calendars, the api's own way (spec 0029, AC-749).
  const bookingCalendar =
    env.calendar === undefined
      ? NO_CALENDAR
      : connectedCalendar({
          db,
          providers: {
            google: createGoogleCalendar({ clientId: env.calendar.clientId, clientSecret: env.calendar.clientSecret }),
          },
          tokenKey: env.calendar.tokenKey,
          hooks: backgroundHooks(),
          isFreeDomain: createFreeDomains(),
        });
  const bookingMail = (payload: unknown) =>
    runBookingMail(
      {
        systemScope: (workspaceId) => systemScope(db, workspaceId),
        mailer,
        links,
        reseat: { calendar: bookingCalendar, log },
        log,
      },
      payload,
    );

  // Queued email: each `crm_email` row drawn with @crm/emails and sent through the same transport as a booking's
  // emails, its links on the app, an optional email's preferences link signed with the key the api checks it with.
  // Without APP_URL the task isn't run (its rows wait); without a transport each is recorded skipped.
  const emailDeps =
    env.APP_URL === undefined
      ? undefined
      : {
          systemScope: (workspaceId: string) => systemScope(db, workspaceId),
          mailer,
          appOrigin: new URL(env.APP_URL).origin,
          linkKey: emailLinkKey(env),
          log,
        };
  if (emailDeps === undefined || mailer === undefined) {
    const reason = emailDeps === undefined ? 'APP_URL is not set' : 'no mail transport (RESEND_API_KEY)';
    // A deployed host that runs jobs but can't send loses every queued email: said at error level, to be seen.
    if (env.APP_ENV !== 'local' && env.JOBS_RUNNER === 'on') log.error('email.off', { reason });
    else log.info('email.off', { reason });
  }
  const email =
    emailDeps === undefined
      ? undefined
      : (payload: unknown, attempt: EmailTry) => runEmail(emailDeps, payload, attempt);

  // Notification emails (spec 0038, milestone 3): one email a member, entered as that member, through the same
  // transport and links as the queued emails.
  const notificationEmail = (payload: unknown) =>
    runNotificationEmail({ door: { db, rules: APP_RULES }, mailer, appOrigin: emailDeps?.appOrigin, log }, payload);

  return {
    registry,
    runner,
    calendar,
    bookingMail,
    email,
    notificationEmail,
    // The daily cleanup (milestone 3): the outbox, the dead queue rows, then one maintenance job a workspace.
    daily: (sweep) => (input) =>
      runDailyCleanup(
        {
          registry,
          systemScope: (workspaceId) => systemScope(db, workspaceId),
          hooks: backgroundHooks,
          sweep,
          // Deleted workspaces past their window go for good (spec 0031, AC-823).
          purge: (workspaceId, deadline) => purgeWorkspace({ db, log }, workspaceId, deadline),
          log,
          onStored,
        },
        input,
      ),
    tasks: runnerTasks({ calendar: calendar !== undefined, email: email !== undefined }),
  };
}
