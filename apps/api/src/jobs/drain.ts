// The job drain (spec 0045): background jobs without a long running worker.
// Where the api runs as a Vercel Function there is no worker process, so the
// api runs the queue itself in short bounded turns: after a request that may
// have queued work (inside `waitUntil`), and from the scheduled run
// (`POST /api/internal/jobs/run`, every 10 minutes from jobs.yml). A turn
// opens the queue pool on the worker's direct login, starts the same runners
// the worker runs (`startJobRunners`, fewer at once), and stops them once
// nothing it runs is due, or when its time budget is spent; the slices in hand
// then finish their batch and hand their jobs back, as at a worker's shutdown.
// The daily cleanup's cron line rides along: a turn started after 03:00 UTC
// backfills the day's run (one day of fill). No relay runs here: live updates
// are off while the api is on Vercel, so a stored change event wakes nothing.
import { assertWorkerConnection, openDirectConnection, openQueueConnection, type QueueConnection } from '@crm/db';
import { errorFields } from '../log.ts';
import type { JobTasks } from './compose.ts';
import { startJobRunners, type JobsLog } from './graphile.ts';

/** How many slices each lane runs at once in a turn: three, the size of the function's tenant pool. */
export const DRAIN_CONCURRENCY = { heavy: 1, light: 2 } as const;

/** The queue pool's size in a turn: a LISTEN client for each runner, and room for the jobs they fetch. */
export const DRAIN_QUEUE_CONNECTIONS = 5;

/** How often a turn asks whether anything it runs is still due. */
export const DRAIN_POLL_MS = 1_000;

/** How a turn ended. */
export type DrainOutcome =
  /** Nothing it runs was due, so it never started the runners. */
  | 'nothing'
  /** It ran until nothing it runs was due. */
  | 'idle'
  /** Its time budget ran out with work still due; the next turn takes the rest. */
  | 'budget'
  /** Another turn runs in this instance already; that one takes the work. */
  | 'busy'
  /** A runner stopped on its own (its connection lost); the next turn starts again. */
  | 'failed'
  /** The direct login isn't in crm_worker, so no job may run (`pnpm db:worker-login`). */
  | 'off';

/** What a turn reports: how it ended and how long it took. */
export interface DrainReport {
  readonly outcome: DrainOutcome;
  readonly ms: number;
}

/** One turn's limits. */
export interface DrainTurn {
  /** The most milliseconds it may run before it stops the runners. */
  readonly budgetMs: number;
  /**
   * Start the runners even when nothing is due, and run at least this long:
   * the scheduled run, so the cron line's backfill gets its chance. Absent, a
   * turn with nothing due ends at once, without starting them.
   */
  readonly minimumMs?: number;
}

/** What the drain needs: the worker login's direct address, the runners' work, and the log. */
export interface JobDrainOptions {
  readonly directUrl: string;
  readonly tasks: JobTasks;
  readonly log: JobsLog;
  readonly onFault?: (error: unknown) => void;
  /** Milliseconds between due checks; tests shorten it. */
  readonly pollMs?: number;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** The drain: one turn at a time per instance. */
export interface JobDrain {
  /** Runs one turn, or answers `busy` at once when one already runs here. */
  run(turn: DrainTurn): Promise<DrainReport>;
  /** Whether a turn runs in this instance now. */
  running(): boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds the drain. Nothing connects until the first turn. */
export function createJobDrain(options: JobDrainOptions): JobDrain {
  const { log, tasks } = options;
  const now = options.now ?? (() => performance.now());
  const pollMs = options.pollMs ?? DRAIN_POLL_MS;
  let current: Promise<DrainReport> | undefined;
  // Whether the direct login may run jobs, asked once per instance (until it answers): a role that can bypass row
  // level security is refused outright, and one outside crm_worker leaves the jobs off, as on the worker.
  let login: Promise<boolean> | undefined;

  const loginInWorker = () => {
    login ??= (async () => {
      const client = await openDirectConnection({
        url: options.directUrl,
        applicationName: 'crm-api-jobs-check',
        proveListen: false,
      });
      try {
        return (await assertWorkerConnection(client, 'DATABASE_URL_DIRECT')).inWorker;
      } finally {
        await client.end();
      }
    })().catch((error: unknown) => {
      login = undefined;
      throw error;
    });
    return login;
  };

  /** Due now: an unlocked row of a task these runners take, with attempts left, whose time has come. */
  const dueNow = async (queue: QueueConnection) => {
    const check = await queue.sleepCheck({ outbox: false, tasks: tasks.tasks });
    return check.nextRunAt !== undefined && check.nextRunAt.getTime() <= check.now.getTime();
  };

  async function turn({ budgetMs, minimumMs }: DrainTurn): Promise<DrainReport> {
    const started = now();
    const report = (outcome: DrainOutcome): DrainReport => ({ outcome, ms: Math.round(now() - started) });
    if (!(await loginInWorker())) {
      log.warn('jobs.off', { reason: 'the direct login is not in crm_worker; run pnpm db:worker-login' });
      return report('off');
    }
    const queue = openQueueConnection({
      url: options.directUrl,
      applicationName: 'crm-api-jobs',
      max: DRAIN_QUEUE_CONNECTIONS,
      onError: (error) => {
        log.error('Idle queue client failed', errorFields(error));
        options.onFault?.(error);
      },
    });
    try {
      if (minimumMs === undefined && !(await dueNow(queue))) return report('nothing');
      // Set by a runner that stopped on its own; read between checks.
      const runner = { failed: false };
      const runners = await startJobRunners({
        queue,
        runner: tasks.runner,
        log,
        concurrency: DRAIN_CONCURRENCY,
        bookingMail: tasks.bookingMail,
        daily: tasks.daily(queue),
        ...(tasks.calendar === undefined ? {} : { calendar: tasks.calendar }),
        ...(options.onFault === undefined ? {} : { onFault: options.onFault }),
        onFailed: () => {
          runner.failed = true;
        },
      });
      let outcome: DrainOutcome = 'budget';
      try {
        // Two quiet checks in a row: between a runner locking a row and its task starting, nothing is busy and
        // nothing is due for a moment.
        let quiet = 0;
        for (;;) {
          await sleep(pollMs);
          const elapsed = now() - started;
          if (runner.failed) {
            outcome = 'failed';
            break;
          }
          if (elapsed >= budgetMs) break;
          if (elapsed < (minimumMs ?? 0) || runners.busy() > 0) {
            quiet = 0;
            continue;
          }
          quiet = (await dueNow(queue)) ? 0 : quiet + 1;
          if (quiet >= 2) {
            outcome = 'idle';
            break;
          }
        }
      } finally {
        // The slices in hand finish their batch and hand their jobs back first.
        await runners.stop();
      }
      return report(outcome);
    } finally {
      await queue.close();
    }
  }

  return {
    run(limits) {
      if (current !== undefined) return Promise.resolve({ outcome: 'busy', ms: 0 });
      const running = turn(limits).finally(() => {
        current = undefined;
      });
      current = running;
      return running;
    },
    running: () => current !== undefined,
  };
}

/** What the after request trigger needs: the drain, how to keep the instance alive, and the turn's budget. */
export interface DrainWakeOptions {
  readonly drain: JobDrain;
  /** Keeps the instance alive until the promise settles (`waitUntil` on Vercel). */
  readonly keepAlive: (work: Promise<unknown>) => void;
  readonly budgetMs: number;
  readonly log: JobsLog;
  readonly onFault?: (error: unknown) => void;
}

/**
 * The api's wake call on Vercel: where a write would poke the worker, it
 * starts a turn after the response, kept alive by `waitUntil`. A wake while a
 * turn runs asks for one more quick check once it ends (the running turn's
 * LISTEN already takes most new rows), so a burst of writes is one turn and
 * at most one more.
 */
export function createDrainWake(options: DrainWakeOptions): () => void {
  const { drain, log } = options;
  let pending: Promise<void> | undefined;
  let again = false;
  const once = async () => {
    const report = await drain.run({ budgetMs: options.budgetMs });
    if (report.outcome !== 'nothing' && report.outcome !== 'busy') log.info('jobs.drain', { ...report, by: 'request' });
  };
  return () => {
    if (pending !== undefined) {
      again = true;
      return;
    }
    const work = (async () => {
      try {
        await once();
        if (again) {
          again = false;
          await once();
        }
      } catch (error) {
        log.error('jobs.drain.failed', errorFields(error));
        options.onFault?.(error);
      } finally {
        again = false;
        pending = undefined;
      }
    })();
    pending = work;
    options.keepAlive(work);
  };
}
