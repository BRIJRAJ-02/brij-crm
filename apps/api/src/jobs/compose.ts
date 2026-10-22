// What the job runners run (spec 0008), put together once from the environment
// and the pool: the core runner and its registry, calendar sync (spec 0024),
// booking emails (spec 0025) and the daily cleanup. The worker process and the
// api's job drain on Vercel (spec 0045) both build their runners from this, so
// a job runs the same way wherever it runs.
import { jobKinds, type JobRegistry, type QueueRows, type Runner } from '@crm/core';
import { runDailyCleanup, syncConnection, systemScope } from '@crm/core/system';
import type { CalendarSyncInput, CalendarSyncOutcome, DailyCleanupInput, DailyCleanupReport } from '@crm/core/system';
import type { AppEnvironment } from '@crm/contracts';
import type { Database, QueueConnection } from '@crm/db';
import { bookingLinkKey } from '../booking-link.ts';
import { createFreeDomains } from '../calendar/free-domains.ts';
import { createGoogleCalendar } from '../calendar/google.ts';
import { GOOGLE_NOTIFY_PATH } from '../calendar/services.ts';
import type { CalendarSettings } from '../env.ts';
import { backgroundHooks } from '../hooks.ts';
import { log } from '../log.ts';
import { createMailer } from '../mail/mailer.ts';
import { parseSender } from '../mail/mailpit.ts';
import { APP_RULES } from '../rules.ts';
import { runBookingMail } from './booking-mail.ts';
import { runnerTasks } from './graphile.ts';
import { createJobRunner } from './runner.ts';

/** The variables the jobs read: the worker's and the api's environments both have them. */
export interface JobTasksEnv {
  readonly APP_ENV: AppEnvironment;
  readonly APP_URL?: string | undefined;
  readonly BOOKING_LINK_SECRET?: string | undefined;
  readonly WORKER_WAKE_SECRET?: string | undefined;
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
  // calling Google outside every transaction; a sync that stored events tells `onStored`. Off, its queued rows wait.
  const calendar =
    env.calendar === undefined
      ? undefined
      : (() => {
          const settings = env.calendar;
          const deps = {
            providers: {
              google: createGoogleCalendar({ clientId: settings.clientId, clientSecret: settings.clientSecret }),
            },
            tokenKey: settings.tokenKey,
            systemScope: (workspaceId: string) => systemScope(db, workspaceId),
            hooks: backgroundHooks(),
            isFreeDomain: createFreeDomains(),
            // Push (spec 0024, milestone 2): channels open only where Google can reach us; locally the poll alone runs.
            ...(settings.webhookOrigin === undefined
              ? {}
              : { pushAddress: new URL(GOOGLE_NOTIFY_PATH, settings.webhookOrigin).toString() }),
          };
          return async (input: CalendarSyncInput) => {
            const outcome = await syncConnection(deps, input);
            if (outcome.kind === 'synced') onStored();
            return outcome;
          };
        })();
  if (calendar === undefined) log.info('calendar.off', { reason: 'CALENDAR_SYNC is not on' });

  // Booking emails (spec 0025, milestone 2): sent through the api's own transport (Resend, or Mailpit locally) with
  // links to the app, each guest page link derived with the key the api mints tokens with.
  const mailer =
    env.APP_URL === undefined || (env.RESEND_API_KEY === undefined && env.MAILPIT_URL === undefined)
      ? undefined
      : createMailer({ RESEND_API_KEY: env.RESEND_API_KEY, MAIL_FROM: env.MAIL_FROM, MAILPIT_URL: env.MAILPIT_URL });
  if (mailer === undefined) log.info('booking.mail.off', { reason: 'APP_URL or a mail transport is not set' });
  const links =
    env.APP_URL === undefined
      ? undefined
      : {
          appOrigin: new URL(env.APP_URL).origin,
          linkKey: bookingLinkKey(env),
          organizerEmail: parseSender(env.MAIL_FROM).email,
        };
  const bookingMail = (payload: unknown) =>
    runBookingMail({ systemScope: (workspaceId) => systemScope(db, workspaceId), mailer, links, log }, payload);

  return {
    registry,
    runner,
    calendar,
    bookingMail,
    // The daily cleanup (milestone 3): the outbox, the dead queue rows, then one maintenance job a workspace.
    daily: (sweep) => (input) =>
      runDailyCleanup(
        {
          registry,
          systemScope: (workspaceId) => systemScope(db, workspaceId),
          hooks: backgroundHooks,
          sweep,
          log,
          onStored,
        },
        input,
      ),
    tasks: runnerTasks(calendar !== undefined),
  };
}
