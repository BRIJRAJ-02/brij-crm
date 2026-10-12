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
import { QueuePayload } from '@crm/contracts';
import type { Runner } from '@crm/core';
import type { QueueConnection } from '@crm/db';
import { Logger, run, type Runner as GraphileRunner, type Task } from 'graphile-worker';
import { errorFields } from '../log.ts';

/** The two lanes: their task and how many slices each runs at once (AC-108). */
export const LANES = {
  heavy: { task: 'crm_job_heavy', concurrency: 2 },
  light: { task: 'crm_job_light', concurrency: 4 },
} as const;

/** How often stale locks are released and the backlog is logged, while the runners run. */
const HOUSEKEEPING_MS = 60_000;

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
  /** Milliseconds between polls for scheduled rows (LISTEN wakes a runner at once for new ones). */
  readonly pollInterval?: number;
  /** How old a dead worker's locks must be before they're released (120 seconds); the restart tests shorten it. */
  readonly staleLockSeconds?: number;
  /** How often stale locks are released and the backlog logged (a minute); the restart tests shorten it. */
  readonly housekeepingMs?: number;
}

/** The running job runners. */
export interface JobRunners {
  /** Stops taking slices, lets the ones in hand finish their batch and hand their jobs back, then closes. */
  stop(): Promise<void>;
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
    await options.runner.runSlice(parsed.data, AbortSignal.any([helpers.abortSignal, shutdown]));
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
  const runners: GraphileRunner[] = [];
  try {
    for (const lane of Object.values(LANES)) {
      runners.push(
        await run({
          pgPool: queue.pool,
          concurrency: lane.concurrency,
          noHandleSignals: true,
          logger,
          pollInterval: options.pollInterval ?? 2_000,
          taskList: { [lane.task]: sliceTask(options, shutdown.signal) },
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
  };
}
