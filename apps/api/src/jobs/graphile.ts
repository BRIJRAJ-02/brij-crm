// The job runners on Graphile Worker (spec 0008): the one file in apps/api
// that imports `graphile-worker`. Two runners share the queue pool (the
// worker's direct login, `crm_worker_user`): the heavy lane (task
// `crm_job_heavy`, 2 at once, one slice per workspace at a time through its
// queue name) and the light lane (`crm_job_light`, 4 at once). Graphile only
// hands a runner the tasks it knows, so light jobs never wait behind heavy
// ones. Each task parses its payload (ids only) and runs one slice through
// the core runner, which does all the work. On stop the slices in hand finish
// their batch and hand their jobs back; stale locks (a dead process's) are
// released on start and once a minute, and the backlog is logged as often.
// The light runner also holds the one crontab line (milestone 3): the daily
// cleanup, `crm_cron_daily` at 03:00 UTC (Graphile's cron is UTC whatever the
// process's zone), with one day of fill, so a day missed while the worker was
// down or asleep runs once when it starts again, never once per missed day.
// With calendar sync on (spec 0024), the light runner also takes
// `crm_calendar_sync`: one connection's sync, one at a time per connection
// (its own queue), keyed by connection so a burst is one waiting row. Each run
// queues the next itself (`preserve_run_at`, so a sooner one already waiting,
// from a connect or a push notice, keeps its time): 15 minutes after a sync
// (the poll fallback), sooner after a failure, never for a connection that
// stopped. A sleeping worker wakes for that row like any other due row.
// The light runner also takes `crm_booking_mail` (spec 0025, milestone 2):
// one queued booking email kind, its retries Graphile's (5 tries); and
// `crm_email` (the emails lane): one queued email, 8 tries with Graphile's
// backoff, the try told to the task so its last records the email failed.
import { QueuePayload } from '@crm/contracts';
import type { Runner } from '@crm/core';
import type { CalendarSyncInput, CalendarSyncOutcome, DailyCleanupInput, DailyCleanupReport } from '@crm/core/system';
import type { DigestMember, QueueConnection } from '@crm/db';
import { Logger, run, type Runner as GraphileRunner, type Task } from 'graphile-worker';
import * as z from 'zod';
import { errorFields } from '../log.ts';
import { BOOKING_MAIL_TASK } from './booking-mail.ts';
import { EMAIL_TASK, EmailPayload, type EmailRun, type EmailTry } from './email.ts';
import { NOTIFICATION_EMAIL_TASK } from './notification-email.ts';
import { SCHEDULING_NOTICE_TASK } from './scheduling-notice.ts';

/** The two lanes: their task and how many slices each runs at once (AC-108). */
export const LANES = {
  // The heavy lane polls every half second: a slice's hand over lands while its own row still holds the
  // workspace's queue, so the LISTEN wake finds nothing to take, and the next slice waits for a poll.
  heavy: { task: 'crm_job_heavy', concurrency: 2, pollMs: 500 },
  light: { task: 'crm_job_light', concurrency: 4, pollMs: 2_000 },
} as const;

/** How often stale locks are released and the backlog is logged, while the runners run. */
const HOUSEKEEPING_MS = 60_000;

/** The hour (UTC) the daily cleanup runs; the sleeping worker's timer reads it too. */
export const DAILY_CRON_HOUR_UTC = 3;

/** The daily cleanup's task (light lane): the cron's, and its continuations'. */
export const DAILY_TASK = 'crm_cron_daily';

/** The digest fan out's name on Graphile's queue. */
export const DIGEST_TASK = 'crm_notification_digest';

/** Calendar sync's task (spec 0024, light lane): one connection's sync. */
export const CALENDAR_TASK = 'crm_calendar_sync';

/**
 * Every task the worker's runners always run: only their queue rows keep a
 * sleeping worker's check awake. With calendar sync on, `CALENDAR_TASK` joins
 * them, and `EMAIL_TASK` when queued email is on (`runnerTasks`); off, their
 * rows wait and never wake a worker that won't run them.
 */
export const RUNNER_TASKS: readonly string[] = [
  LANES.heavy.task,
  LANES.light.task,
  DAILY_TASK,
  BOOKING_MAIL_TASK,
  NOTIFICATION_EMAIL_TASK,
  DIGEST_TASK,
  SCHEDULING_NOTICE_TASK,
];

/**
 * The tasks this worker runs: calendar sync's when it is on, and queued
 * email's when the worker can send it. Only these rows keep a sleeping
 * worker's check awake: a row of a task it doesn't run would keep it awake
 * forever.
 */
export function runnerTasks(running: { readonly calendar: boolean; readonly email: boolean }): readonly string[] {
  return [...RUNNER_TASKS, ...(running.calendar ? [CALENDAR_TASK] : []), ...(running.email ? [EMAIL_TASK] : [])];
}

/** A calendar sync's payload: the workspace and the connection, ids only (what `crm_enqueue_calendar_sync` writes). */
export const CalendarPayload = z.strictObject({ workspaceId: z.uuid(), connectionId: z.uuid() });
export type CalendarPayload = z.infer<typeof CalendarPayload>;

/**
 * The priority a connection's next poll or retry waits at: after the runs `crm_enqueue_calendar_sync` queues at 0 (a
 * provider's notice, Sync now, a connect), which Graphile takes first however overdue the polls are.
 */
export const CALENDAR_POLL_PRIORITY = 1;

/** A connection's queue key and queue name: the same `crm_enqueue_calendar_sync` builds. */
export function calendarQueue(payload: CalendarPayload): { readonly jobKey: string; readonly queueName: string } {
  return {
    jobKey: `crm-calendar:${payload.workspaceId}:${payload.connectionId}`,
    queueName: `calendar:${payload.workspaceId}:${payload.connectionId}`,
  };
}

/**
 * The one crontab line (spec 0008, Cron): every day at 03:00 UTC, with one
 * day of fill (a missed day runs once), an identifier of its own (so
 * `known_crontabs` keeps one run a day across restarts and sleeps), and at
 * most 5 tries, like a light kind.
 */
export const DAILY_CRONTAB = `0 ${String(DAILY_CRON_HOUR_UTC)} * * * ${DAILY_TASK} ?fill=1d&id=maintenance_daily&max=5`;

/**
 * The daily task's payload: the cron's (Graphile adds `_cron.ts`, the time it
 * fired for), or a continuation's (the day and the last workspace reached).
 * Ids and a date only.
 */
export const DailyPayload = z.strictObject({
  _cron: z.object({ ts: z.iso.datetime({ offset: true }), backfilled: z.boolean().optional() }).optional(),
  day: z.iso.date().optional(),
  after: z.uuid().optional(),
});
export type DailyPayload = z.infer<typeof DailyPayload>;

/** The UTC day a daily payload is for: the continuation's, else the day the cron fired for, else today. */
export function dailyDay(payload: DailyPayload, now: Date = new Date()): string {
  if (payload.day !== undefined) return payload.day;
  const at = payload._cron === undefined ? now : new Date(payload._cron.ts);
  return at.toISOString().slice(0, 10);
}

/** Where the runners log: the api's JSON logger. */
export interface JobsLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** What the job runners need: the queue pool, the core runner, the log, and where a fault is reported. */
export interface JobRunnersOptions {
  readonly queue: QueueConnection;
  readonly runner: Runner;
  readonly log: JobsLog;
  readonly onFault?: (error: unknown) => void;
  /** Milliseconds between polls for scheduled rows, both lanes (LISTEN wakes a runner at once for new ones); tests shorten it. */
  readonly pollInterval?: number;
  /** How old a dead worker's locks must be before they're released (120 seconds); the restart tests shorten it. */
  readonly staleLockSeconds?: number;
  /** How often stale locks are released and the backlog logged (a minute); the restart tests shorten it. */
  readonly housekeepingMs?: number;
  /**
   * The daily cleanup's fan out (`runDailyCleanup` with the worker's deps).
   * With it, the light runner holds the crontab line and the daily task.
   */
  readonly daily?: (input: DailyCleanupInput) => Promise<DailyCleanupReport>;
  /**
   * Calendar sync (spec 0024): one connection's run (`syncConnection` with the
   * worker's deps). With it, the light runner takes `crm_calendar_sync`.
   */
  readonly calendar?: (input: CalendarSyncInput) => Promise<CalendarSyncOutcome>;
  /**
   * Booking emails (spec 0025, milestone 2): one queued kind's send
   * (`runBookingMail` with the worker's deps). With it, the light runner takes
   * `crm_booking_mail`; it throws plainly for a retry.
   */
  readonly bookingMail?: (payload: unknown) => Promise<void>;
  /**
   * Queued email (the emails lane): one email's send (`runEmail` with the
   * worker's deps), told which try this is. With it, the light runner takes
   * `crm_email`, and throws plainly on `retry` for Graphile's backoff.
   */
  readonly email?: (payload: unknown, attempt: EmailTry) => Promise<EmailRun>;
  /**
   * Notifications emails (spec 0038, milestone 3): one member's email
   * (`runNotificationEmail` with the worker's deps). With it, the light runner
   * takes `crm_notification_email`; it throws plainly for a retry.
   */
  readonly notificationEmail?: (payload: unknown) => Promise<void>;
  /**
   * Scheduling notices (spec 0037, AC-1264): one member told of another's changes to their scheduling
   * (`runSchedulingNoticeTask`). With it, the light runner takes `crm_scheduling_notice`; it throws plainly for a
   * retry.
   */
  readonly schedulingNotice?: (payload: unknown) => Promise<void>;
  /**
   * Hears every task call start and end (the worker's idle clock starts
   * again, spec 0008's sleep): a slice, or the daily task.
   */
  readonly onActivity?: () => void;
  /** Hears a runner that stopped on its own (its connection lost): the worker reconnects (milestone 3). */
  readonly onFailed?: (error: unknown) => void;
  /**
   * How many slices each lane runs at once, when not `LANES`' own: the api's
   * job drain on Vercel (spec 0045) runs fewer, to fit its small pool.
   */
  readonly concurrency?: { readonly heavy: number; readonly light: number };
}

/** The running job runners. */
export interface JobRunners {
  /** Stops taking slices, lets the ones in hand finish their batch and hand their jobs back, then closes. */
  stop(): Promise<void>;
  /** How many task calls are in flight now: the worker never sleeps while one runs. */
  busy(): number;
}

// The daily digest's hourly fan out (spec 0038, milestone 4, AC-1178):
// `crm_notification_digest`, on the light runner's crontab every hour. It
// reads, on the worker's own login, the members whose digest is on and whose
// day has reached 08:00 in their time zone without one
// (`crm_notification_digests_due`, ids only), and queues each one's digest as
// a `crm_notification_email` with `digest`, keyed per member, so a member has
// one waiting at most. The email claims the member's day before it goes, so a
// second hour, or a run after a sleep, never sends a second digest that day.

/**
 * The crontab line: every hour on the hour, with an hour of fill (a missed
 * hour runs once on waking), its own identifier, and 5 tries.
 */
export const DIGEST_CRONTAB = `0 * * * * ${DIGEST_TASK} ?fill=1h&id=notification_digest&max=5`;

/** How many members one page names (the function caps it at 500), and how many pages one call reads. */
const DIGEST_PAGE = 500;
const DIGEST_PAGES_A_CALL = 10;

/** The payload: the cron's, or a continuation's (the last member a call reached). Ids only. */
const DigestPayload = z.object({
  after: z.strictObject({ workspaceId: z.uuid(), memberId: z.uuid() }).optional(),
});

/** Queues every due member's digest, a page at a time; a call that reads its pages hands the rest on. */
export function digestTask(
  queue: Pick<QueueConnection, 'digestsDue'>,
  log: { info(message: string, fields?: Record<string, unknown>): void },
): Task {
  return async (payload, helpers) => {
    const parsed = DigestPayload.safeParse(payload ?? {});
    let after: DigestMember | undefined = parsed.success ? parsed.data.after : undefined;
    let queued = 0;
    for (let page = 0; page < DIGEST_PAGES_A_CALL; page += 1) {
      const due = await queue.digestsDue(after, DIGEST_PAGE);
      for (const member of due) {
        await helpers.addJob(
          NOTIFICATION_EMAIL_TASK,
          { workspaceId: member.workspaceId, memberId: member.memberId, digest: true },
          { jobKey: `crm-digest:${member.workspaceId}:${member.memberId}`, maxAttempts: 5 },
        );
        queued += 1;
      }
      after = due.at(-1) ?? after;
      if (due.length < DIGEST_PAGE) {
        log.info('notification.digest.queued', { queued });
        return;
      }
    }
    // More than a call reads: the rest in a continuation, after the last member reached.
    await helpers.addJob(DIGEST_TASK, { after }, { jobKey: 'crm-digest-continue', maxAttempts: 5 });
    log.info('notification.digest.continues', { queued });
  };
}

/** A task that counts itself in flight and tells `onActivity` when it starts and ends. */
function counted(task: Task, inFlight: { count: number }, onActivity: (() => void) | undefined): Task {
  return async (payload, helpers) => {
    inFlight.count += 1;
    onActivity?.();
    try {
      await task(payload, helpers);
    } finally {
      inFlight.count -= 1;
      onActivity?.();
    }
  };
}

/** Graphile's own messages, at warn and above, as JSON lines; its chatter below that is dropped. */
function graphileLogger(log: JobsLog): Logger {
  return new Logger(() => (level, message) => {
    if (level === 'error') log.error('graphile', { message });
    else if (level === 'warning') log.warn('graphile', { message });
  });
}

/** One lane's task: parse the payload (ids only, AC-115), run one slice, stop at a batch boundary on shutdown. */
function sliceTask(options: JobRunnersOptions, shutdown: AbortSignal): Task {
  return async (payload, helpers) => {
    const parsed = QueuePayload.safeParse(payload);
    if (!parsed.success) {
      // Not ours, or tampered with: nothing to run, and nothing to retry.
      options.log.error('job.payload.invalid', { queueJobId: helpers.job.id });
      return;
    }
    try {
      await options.runner.runSlice(parsed.data, AbortSignal.any([helpers.abortSignal, shutdown]));
    } catch {
      // Graphile logs a failed call's message and stack and keeps the message on its queue row, and a message
      // may quote a value: it gets a plain one instead. The runner already logged the job id and the error's
      // class (`job.batch.failed`, `job.onFailed.failed`); thrown on, Graphile tries again after its backoff.
      throw new Error('A job slice failed; the worker log has its job id.');
    }
  };
}

/**
 * The daily task: the fan out for the payload's day, and, when its time
 * budget ran out, a continuation queued for the rest (keyed by the day, so
 * one waits at most). A failure is thrown on with a plain message, so
 * Graphile tries again after its backoff; the once keys keep a retry from
 * starting a second cleanup anywhere.
 */
function dailyTask(options: JobRunnersOptions, daily: NonNullable<JobRunnersOptions['daily']>): Task {
  return async (payload, helpers) => {
    const parsed = DailyPayload.safeParse(payload);
    if (!parsed.success) {
      options.log.error('daily.payload.invalid', { queueJobId: helpers.job.id });
      return;
    }
    const day = dailyDay(parsed.data);
    // The error's class only, logged here: Graphile logs a thrown message and keeps it on the queue row, and a
    // message may quote a value, so what is thrown on is a plain one with no cause.
    let failure: string | undefined;
    try {
      const report = await daily({ day, ...(parsed.data.after === undefined ? {} : { after: parsed.data.after }) });
      if (report.next !== undefined) {
        await helpers.addJob(
          DAILY_TASK,
          { day, after: report.next },
          { jobKey: `crm-cron-daily:${day}`, jobKeyMode: 'replace', maxAttempts: 5, priority: 10 },
        );
      }
    } catch (error) {
      failure = error instanceof Error ? error.name : 'unknown';
    }
    if (failure !== undefined) {
      options.log.error('daily.cleanup.failed', { day, error: failure });
      throw new Error('The daily cleanup failed; the worker log has its day.');
    }
  };
}

/**
 * The calendar sync task: one connection's sync, then its next run queued by
 * the outcome's `nextInMs` (none once it stopped). A failure the sync didn't
 * record (the database, a bug) is thrown on with a plain message, so Graphile
 * tries again after its backoff.
 */
function calendarTask(options: JobRunnersOptions, sync: NonNullable<JobRunnersOptions['calendar']>): Task {
  return async (payload, helpers) => {
    const parsed = CalendarPayload.safeParse(payload);
    if (!parsed.success) {
      options.log.error('calendar.payload.invalid', { queueJobId: helpers.job.id });
      return;
    }
    // The error's class only, logged here: a thrown message may quote a value, so what is thrown on is plain.
    let outcome: CalendarSyncOutcome | undefined;
    let failure: string | undefined;
    try {
      outcome = await sync(parsed.data);
    } catch (error) {
      failure = error instanceof Error ? error.name : 'unknown';
    }
    if (outcome === undefined) {
      options.log.error('calendar.sync.failed', { connectionId: parsed.data.connectionId, error: failure });
      throw new Error('A calendar sync failed; the worker log has its connection id.');
    }
    const synced = {
      connectionId: parsed.data.connectionId,
      outcome: outcome.kind,
      ...(outcome.kind === 'synced' ? { events: outcome.events, full: outcome.full } : {}),
      ...(outcome.kind === 'retry' ? { code: outcome.code } : {}),
      ...(outcome.kind === 'stopped' ? { reason: outcome.reason } : {}),
      // A revoked connection whose account another connection still holds: its grant was kept.
      ...(outcome.kind === 'stopped' && outcome.grantKept === true ? { grantKept: true } : {}),
      // Calendars the run couldn't read while the account synced: ids and the provider's code, status and reason.
      ...(outcome.failedCalendars === undefined ? {} : { failedCalendars: outcome.failedCalendars }),
    };
    if (outcome.failedCalendars === undefined) options.log.info('calendar.sync', synced);
    else options.log.warn('calendar.sync', synced);
    // Each push channel the run opened, failed to open or ended (spec 0024, AC-602): our ids, its expiry, and the
    // provider's code, status and reason when it refused. Never a token or a channel id.
    for (const channel of outcome.channels ?? []) {
      const fields = { workspaceId: parsed.data.workspaceId, connectionId: parsed.data.connectionId, ...channel };
      // A calendar refused again for the reason it was refused for last time was already said: once is enough.
      const quiet = channel.outcome === 'failed' && channel.repeat === true;
      if ((channel.outcome === 'failed' && !quiet) || channel.outcome === 'unstopped')
        options.log.warn('calendar.channel', fields);
      else options.log.info('calendar.channel', fields);
    }
    if (outcome.kind === 'stopped') return;
    // The next poll (or retry) waits at priority 1, behind what a person or a provider asked for now (a notice, Sync
    // now, a connect: `crm_enqueue_calendar_sync`, priority 0), so a notice never queues behind every overdue poll.
    await helpers.addJob(CALENDAR_TASK, parsed.data, {
      ...calendarQueue(parsed.data),
      jobKeyMode: 'preserve_run_at',
      runAt: new Date(Date.now() + outcome.nextInMs),
      maxAttempts: 25,
      priority: CALENDAR_POLL_PRIORITY,
    });
  };
}

/**
 * The email task: one queued email's send, told which try this is. A retry
 * (the send logged it) and a failure it didn't expect (the database, a bug:
 * logged here, its class only) are thrown on with a plain message, as the
 * other tasks do: Graphile logs a thrown message and keeps it on the queue
 * row, and a database error's text can quote the values it was given.
 */
function emailTask(options: JobRunnersOptions, email: NonNullable<JobRunnersOptions['email']>): Task {
  return async (payload, helpers) => {
    let run: EmailRun | undefined;
    let failure: string | undefined;
    try {
      run = await email(payload, { attempt: helpers.job.attempts, maxAttempts: helpers.job.max_attempts });
    } catch (error) {
      failure = error instanceof Error ? error.name : 'unknown';
    }
    if (run === 'finished') return;
    if (run === undefined) {
      const parsed = EmailPayload.safeParse(payload);
      options.log.error('email.task.failed', {
        ...(parsed.success ? { emailId: parsed.data.emailId } : { queueJobId: helpers.job.id }),
        error: failure,
      });
    }
    throw new Error('An email failed to send; the worker log has its id.');
  };
}

/**
 * Starts the two runners on the queue pool. Graphile's `run()` calls its
 * migrate step; its migrations ran before deploy (as the owner), so here that
 * step only reads Graphile's `migrations` table, the one right `crm_worker`
 * holds on it. A Graphile newer than the database's schema would try to
 * migrate and be refused, so the worker fails to start rather than migrate
 * as itself. Stale locks are released first.
 */
export async function startJobRunners(options: JobRunnersOptions): Promise<JobRunners> {
  const { queue, log } = options;
  const shutdown = new AbortController();
  const logger = graphileLogger(log);
  const housekeeping = async () => {
    try {
      const released = await queue.releaseStaleLocks(options.staleLockSeconds);
      if (released > 0) log.warn('jobs.locks.released', { workers: released });
      const backlog = await queue.backlog();
      log.info('jobs.backlog', backlog);
    } catch (error) {
      log.warn('jobs.housekeeping.failed', errorFields(error));
    }
  };
  await housekeeping();
  const inFlight = { count: 0 };
  const runners: GraphileRunner[] = [];
  // Watched as soon as each starts, so a runner that stops while the other still starts is reported (and never an
  // unhandled rejection, which would end the process). In 0.18.0 a runner whose pool shut down (a connection
  // terminated, a breaking `worker:migrate`) stops itself and its promise resolves rather than rejects, so any end
  // that isn't our own stop counts as a failure.
  const stoppedOnItsOwn = (error: unknown): void => {
    log.error('jobs.runner.failed', errorFields(error));
    options.onFault?.(error);
    options.onFailed?.(error);
  };
  const watch = (runner: GraphileRunner): GraphileRunner => {
    runner.promise.then(
      () => {
        if (!shutdown.signal.aborted) stoppedOnItsOwn(new Error('A job runner stopped on its own.'));
      },
      (error: unknown) => {
        if (shutdown.signal.aborted) {
          log.warn('jobs.runner.stop.failed', errorFields(error));
          return;
        }
        stoppedOnItsOwn(error);
      },
    );
    return runner;
  };
  try {
    for (const name of ['heavy', 'light'] as const) {
      const lane = LANES[name];
      // The light runner alone holds the crontab, so the cron fires once whatever the lanes.
      const daily = lane === LANES.light ? options.daily : undefined;
      const calendar = lane === LANES.light ? options.calendar : undefined;
      const bookingMail = lane === LANES.light ? options.bookingMail : undefined;
      const email = lane === LANES.light ? options.email : undefined;
      const notificationEmail = lane === LANES.light ? options.notificationEmail : undefined;
      const schedulingNotice = lane === LANES.light ? options.schedulingNotice : undefined;
      runners.push(
        watch(
          await run({
            pgPool: queue.pool,
            concurrency: options.concurrency?.[name] ?? lane.concurrency,
            noHandleSignals: true,
            logger,
            pollInterval: options.pollInterval ?? lane.pollMs,
            taskList: {
              [lane.task]: counted(sliceTask(options, shutdown.signal), inFlight, options.onActivity),
              ...(daily === undefined
                ? {}
                : { [DAILY_TASK]: counted(dailyTask(options, daily), inFlight, options.onActivity) }),
              ...(calendar === undefined
                ? {}
                : { [CALENDAR_TASK]: counted(calendarTask(options, calendar), inFlight, options.onActivity) }),
              ...(bookingMail === undefined
                ? {}
                : { [BOOKING_MAIL_TASK]: counted((payload) => bookingMail(payload), inFlight, options.onActivity) }),
              ...(email === undefined
                ? {}
                : { [EMAIL_TASK]: counted(emailTask(options, email), inFlight, options.onActivity) }),
              ...(notificationEmail === undefined
                ? {}
                : {
                    [NOTIFICATION_EMAIL_TASK]: counted(
                      (payload) => notificationEmail(payload),
                      inFlight,
                      options.onActivity,
                    ),
                    [DIGEST_TASK]: counted(digestTask(options.queue, options.log), inFlight, options.onActivity),
                  }),
              ...(schedulingNotice === undefined
                ? {}
                : {
                    [SCHEDULING_NOTICE_TASK]: counted(
                      (payload) => schedulingNotice(payload),
                      inFlight,
                      options.onActivity,
                    ),
                  }),
            },
            // The daily cleanup's line, and the digest's hourly one beside the email task that sends it.
            ...(daily === undefined && notificationEmail === undefined
              ? {}
              : {
                  crontab: [
                    ...(daily === undefined ? [] : [DAILY_CRONTAB]),
                    ...(notificationEmail === undefined ? [] : [DIGEST_CRONTAB]),
                  ].join('\n'),
                }),
            // Completions and failures go through Graphile's batcher (with no wait), which a stop flushes before
            // the pool closes: unbatched, they're sent and not awaited, so a stop right after a slice handed its job
            // over could close the pool first and leave the finished call's row locked (key cleared, so harmless,
            // but kept until the daily cleanup).
            preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
          }),
        ),
      );
    }
  } catch (error) {
    // Our own stop, so the runners already started aren't reported as failing.
    shutdown.abort();
    await Promise.all(runners.map((runner) => runner.stop()));
    throw error;
  }
  const timer = setInterval(() => void housekeeping(), options.housekeepingMs ?? HOUSEKEEPING_MS);
  timer.unref();
  log.info('jobs.runners.started', {
    heavy: options.concurrency?.heavy ?? LANES.heavy.concurrency,
    light: options.concurrency?.light ?? LANES.light.concurrency,
  });
  return {
    async stop() {
      clearInterval(timer);
      // The slices in hand see this between batches, finish the one in hand and hand their jobs back.
      shutdown.abort();
      // A runner that already stopped on its own answers "already stopped": nothing left to stop there.
      await Promise.all(runners.map((runner) => runner.stop().catch(() => undefined)));
    },
    busy: () => inFlight.count,
  };
}
