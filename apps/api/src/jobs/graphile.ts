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
import { QueuePayload } from '@crm/contracts';
import type { Runner } from '@crm/core';
import type { DailyCleanupInput, DailyCleanupReport } from '@crm/core/system';
import type { QueueConnection } from '@crm/db';
import { Logger, run, type Runner as GraphileRunner, type Task } from 'graphile-worker';
import * as z from 'zod';
import { errorFields } from '../log.ts';

/** The two lanes: their task and how many slices each runs at once (AC-108). */
export const LANES = {
  // The heavy lane polls every half second: a slice's hand over lands while its own row still holds the
  // workspace's queue, so the LISTEN wake finds nothing to take, and the next slice waits for a poll.
  heavy: { task: 'crm_job_heavy', concurrency: 2, pollMs: 500 },
  light: { task: 'crm_job_light', concurrency: 4, pollMs: 2_000 },
} as const;

/** How often stale locks are released and the backlog is logged, while the runners run. */
const HOUSEKEEPING_MS = 60_000;

/** The daily cleanup's task (light lane): the cron's, and its continuations'. */
export const DAILY_TASK = 'crm_cron_daily';

/**
 * The one crontab line (spec 0008, Cron): every day at 03:00 UTC, with one
 * day of fill (a missed day runs once), an identifier of its own (so
 * `known_crontabs` keeps one run a day across restarts and sleeps), and at
 * most 5 tries, like a light kind.
 */
export const DAILY_CRONTAB = `0 3 * * * ${DAILY_TASK} ?fill=1d&id=maintenance_daily&max=5`;

/**
 * The daily task's payload: the cron's (Graphile adds `_cron.ts`, the time it
 * fired for), or a continuation's (the day and the last workspace reached).
 * Ids and a date only.
 */
export const DailyPayload = z.object({
  _cron: z.object({ ts: z.iso.datetime({ offset: true }) }).optional(),
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
   * Hears every task call start and end (the worker's idle clock starts
   * again, spec 0008's sleep): a slice, or the daily task.
   */
  readonly onActivity?: () => void;
  /** Hears a runner that stopped on its own (its connection lost): the worker reconnects (milestone 3). */
  readonly onFailed?: (error: unknown) => void;
}

/** The running job runners. */
export interface JobRunners {
  /** Stops taking slices, lets the ones in hand finish their batch and hand their jobs back, then closes. */
  stop(): Promise<void>;
  /** How many task calls are in flight now: the worker never sleeps while one runs. */
  busy(): number;
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
  try {
    for (const lane of Object.values(LANES)) {
      // The light runner alone holds the crontab, so the cron fires once whatever the lanes.
      const daily = lane === LANES.light ? options.daily : undefined;
      runners.push(
        await run({
          pgPool: queue.pool,
          concurrency: lane.concurrency,
          noHandleSignals: true,
          logger,
          pollInterval: options.pollInterval ?? lane.pollMs,
          taskList: {
            [lane.task]: counted(sliceTask(options, shutdown.signal), inFlight, options.onActivity),
            ...(daily === undefined
              ? {}
              : { [DAILY_TASK]: counted(dailyTask(options, daily), inFlight, options.onActivity) }),
          },
          ...(daily === undefined ? {} : { crontab: DAILY_CRONTAB }),
          // Completions and failures go through Graphile's batcher (with no wait), which a stop flushes before
          // the pool closes: unbatched, they're sent and not awaited, so a stop right after a slice handed its job
          // over could close the pool first and leave the finished call's row locked (key cleared, so harmless,
          // but kept until the daily cleanup).
          preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
        }),
      );
    }
  } catch (error) {
    await Promise.all(runners.map((runner) => runner.stop()));
    throw error;
  }
  for (const runner of runners) {
    runner.promise.catch((error: unknown) => {
      log.error('jobs.runner.failed', errorFields(error));
      options.onFault?.(error);
      if (!shutdown.signal.aborted) options.onFailed?.(error);
    });
  }
  const timer = setInterval(() => void housekeeping(), options.housekeepingMs ?? HOUSEKEEPING_MS);
  timer.unref();
  log.info('jobs.runners.started', { heavy: LANES.heavy.concurrency, light: LANES.light.concurrency });
  return {
    async stop() {
      clearInterval(timer);
      // The slices in hand see this between batches, finish the one in hand and hand their jobs back.
      shutdown.abort();
      await Promise.all(runners.map((runner) => runner.stop()));
    },
    busy: () => inFlight.count,
  };
}
