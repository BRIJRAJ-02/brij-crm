// The job drain (spec 0045): background jobs without a long running worker.
// Where the api runs as a Vercel Function there is no worker process, so the
// api runs the queue itself in short bounded turns: after a request that may
// have queued work (inside `waitUntil`), and from the scheduled run
// (`POST /api/internal/jobs/run`, hourly from jobs.yml). A turn
// opens the queue pool on the worker's direct login, starts the same runners
// the worker runs (`startJobRunners`, fewer at once), and stops them once
// nothing it runs is due, or when its time budget is spent; the slices in hand
// then finish their batch and hand their jobs back, as at a worker's shutdown.
// The cron lines ride along: a turn started after 03:00 UTC backfills the
// daily cleanup's run (one day of fill), and any turn that starts the runners
// backfills the hour's digest run (one hour of fill). No relay runs here: live
// updates are off while the api is on Vercel, so a stored change event wakes
// nothing, and the daily cleanup also clears the outbox rows no relay will
// ever publish once they are past retention (`unrelayedSweep`).
//
// Nothing runs between turns, so the drain remembers when the earliest queue
// row it saw comes due (`nextDue`), and `createDueWake` starts a turn from a
// signed in request once that time has passed: a reminder or a delayed email
// goes out with the next use of the app, or at the scheduled run.
import type { QueueRows } from '@crm/core';
import {
  assertWorkerConnection,
  openDirectConnection,
  openQueueConnection,
  PRUNE_BATCH,
  type QueueConnection,
} from '@crm/db';
import { errorFields } from '../log.ts';
import type { JobTasks } from './compose.ts';
import { startJobRunners, type JobsLog } from './graphile.ts';

/** How many slices each lane runs at once in a turn: two, so requests on the same instance keep a tenant connection. */
export const DRAIN_CONCURRENCY = { heavy: 1, light: 1 } as const;

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
  /**
   * Builds the runners' work (`composeJobTasks`) once, given the queue rows
   * the daily cleanup's requeue phase reads: the open turn's queue.
   */
  readonly compose: (queue: QueueRows) => JobTasks;
  readonly log: JobsLog;
  readonly onFault?: (error: unknown) => void;
  /** Milliseconds between due checks; tests shorten it. */
  readonly pollMs?: number;
  /** The clock, for tests. */
  readonly now?: () => number;
  /** The wall clock in epoch milliseconds, which `nextDue` answers in; for tests. */
  readonly wallNow?: () => number;
}

/** The drain: one turn at a time per instance. */
export interface JobDrain {
  /** Runs one turn, or answers `busy` at once when one already runs here. */
  run(turn: DrainTurn): Promise<DrainReport>;
  /** Whether a turn runs in this instance now. */
  running(): boolean;
  /**
   * When the earliest unlocked queue row this instance last saw comes due, in
   * epoch milliseconds on this instance's clock, or undefined when it saw none
   * (or has not looked yet). A row queued since, by another instance, isn't
   * known here.
   */
  nextDue(): number | undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds the drain. Nothing connects until the first turn. */
export function createJobDrain(options: JobDrainOptions): JobDrain {
  const { log } = options;
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const pollMs = options.pollMs ?? DRAIN_POLL_MS;
  let current: Promise<DrainReport> | undefined;
  // What the last due check saw: the earliest unlocked row's time, moved onto this instance's clock.
  let nextDue: number | undefined;
  // The queue of the turn in hand, for the daily cleanup's requeue phase; between turns it is closed.
  let open: QueueConnection | undefined;
  const tasks = options.compose({
    rows: (workspaceId, jobIds) =>
      open === undefined
        ? Promise.reject(new Error('No job turn runs, so the queue is closed.'))
        : open.rows(workspaceId, jobIds),
  });
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
    nextDue = check.nextRunAt === undefined ? undefined : wallNow() + (check.nextRunAt.getTime() - check.now.getTime());
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
    open = queue;
    try {
      // A slice frozen with its instance (or killed) left its queue row locked, which reads as not due: its locks go
      // once older than any live call, so the job it held runs again (its lease ran out long before).
      const released = await queue.releaseStaleLocks();
      if (released > 0) log.warn('jobs.locks.released', { workers: released });
      if (minimumMs === undefined && !(await dueNow(queue))) return report('nothing');
      // Set by a runner that stopped on its own; read between checks.
      const runner = { failed: false };
      const runners = await startJobRunners({
        queue,
        runner: tasks.runner,
        log,
        concurrency: DRAIN_CONCURRENCY,
        bookingMail: tasks.bookingMail,
        ...(tasks.email === undefined ? {} : { email: tasks.email }),
        notificationEmail: tasks.notificationEmail,
        schedulingNotice: tasks.schedulingNotice,
        automation: tasks.automation,
        calendarHealth: tasks.calendarHealth,
        daily: tasks.daily(unrelayedSweep(queue)),
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
          // Never sleep past the budget: it is checked as soon as it is spent.
          await sleep(Math.max(0, Math.min(pollMs, budgetMs - (now() - started))));
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
      if (open === queue) open = undefined;
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
    nextDue: () => nextDue,
  };
}

/**
 * The daily cleanup's sweep where no relay runs (spec 0045): the outbox
 * prune deletes published rows only, and nothing publishes here, so before
 * its first prune batch the outbox rows past retention are marked published
 * (`expireUnrelayed`: delivered to nobody, since no live connection exists to
 * hear them). The prune then takes them as it would after a relay, so the
 * outbox stays about a day long. Later batches only prune.
 */
export function unrelayedSweep(queue: QueueConnection): QueueConnection {
  let expired = false;
  return {
    ...queue,
    async pruneOutbox() {
      if (!expired) {
        expired = true;
        await queue.expireUnrelayed(PRUNE_BATCH);
      }
      return queue.pruneOutbox();
    },
  };
}

/** What the after request trigger needs: the drain, how to keep the instance alive, and the time it may take. */
export interface DrainWakeOptions {
  readonly drain: JobDrain;
  /** Keeps the instance alive until the promise settles (`waitUntil` on Vercel). */
  readonly keepAlive: (work: Promise<unknown>) => void;
  /** The whole wake's budget: its turn, and the one more it may run, share it. */
  readonly budgetMs: number;
  /** The least time between two turns' starts in this instance; a wake sooner waits for it (5 seconds). */
  readonly cooldownMs?: number;
  readonly log: JobsLog;
  readonly onFault?: (error: unknown) => void;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** A second turn starts only with at least this much of the wake's budget left. */
export const AGAIN_MINIMUM_MS = 5_000;

/** The least time between two after request turns in one instance. */
export const WAKE_COOLDOWN_MS = 5_000;

/**
 * What woke the drain: a request that may have queued work (a write, a calendar notice), or a signed in request
 * looking for due work (`createDueWake`).
 */
export type DrainTrigger = 'request' | 'use';

/**
 * The api's wake call on Vercel: where a write would poke the worker, it
 * starts a turn after the response, kept alive by `waitUntil`. Turns start at
 * most once per cooldown in an instance (a wake sooner waits for it, so
 * anonymous writes can't open a direct connection each), and a wake while a
 * turn runs asks for one more once it ends (the running turn's LISTEN already
 * takes most new rows), within the same budget, so a burst of writes is one
 * turn and at most one more, and the whole wake stays inside the function's
 * time limit. A turn after a request logs `jobs.drain` when it ran something;
 * one a wake from use asked for logs it whatever it found, `nothing` and
 * `busy` included, so the logs say when the queue was last looked at.
 */
export function createDrainWake(options: DrainWakeOptions): (trigger?: DrainTrigger) => void {
  const { drain, log } = options;
  const now = options.now ?? (() => performance.now());
  const cooldownMs = options.cooldownMs ?? WAKE_COOLDOWN_MS;
  let pending: Promise<void> | undefined;
  let again = false;
  // A wake from use asked since the last turn began: that turn's outcome is logged, whatever it was.
  let fromUse = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  const once = async (budgetMs: number) => {
    lastStart = now();
    const by: DrainTrigger = fromUse ? 'use' : 'request';
    fromUse = false;
    const report = await drain.run({ budgetMs });
    if (by === 'use' || (report.outcome !== 'nothing' && report.outcome !== 'busy')) {
      log.info('jobs.drain', { ...report, by });
    }
  };
  return (trigger = 'request') => {
    if (trigger === 'use') fromUse = true;
    if (pending !== undefined) {
      again = true;
      return;
    }
    const work = (async () => {
      try {
        const wait = Math.max(0, lastStart + cooldownMs - now());
        if (wait > 0) await sleep(wait);
        const deadline = now() + options.budgetMs;
        await once(options.budgetMs);
        const left = deadline - now();
        if (again && left >= AGAIN_MINIMUM_MS) {
          again = false;
          await once(left);
        }
      } catch (error) {
        log.error('jobs.drain.failed', errorFields(error));
        options.onFault?.(error);
      } finally {
        // A wake that asked for a turn this one had no time left for is dropped whole: the next turn, asked for by
        // a request, isn't logged as by use.
        again = false;
        fromUse = false;
        pending = undefined;
      }
    })();
    pending = work;
    options.keepAlive(work);
  };
}

/** What the wake from use needs: the drain's knowledge of the next due row, and the wake to send. */
export interface DueWakeOptions {
  readonly drain: Pick<JobDrain, 'nextDue'>;
  /** The after request wake (`createDrainWake`), told the wake is from use, so its turn's outcome is logged. */
  readonly wake: (trigger: DrainTrigger) => void;
  /** The longest between two looks while the app is in use (2 minutes): a row another instance queued is seen so. */
  readonly everyMs?: number;
  /** The shortest between two wakes for a row known due (10 seconds), so a busy turn isn't asked again each request. */
  readonly soonestMs?: number;
  /** The wall clock in epoch milliseconds (the drain's `nextDue` clock), for tests. */
  readonly now?: () => number;
}

/** How often a signed in request looks for due work at most, with none known due, per instance. */
export const DUE_LOOK_MS = 120_000;

/** How often a signed in request wakes the drain at most for work known due, per instance. */
export const DUE_WAKE_MS = 10_000;

/**
 * The function's wake from use (spec 0045, in place of spec 0008's once a
 * minute poke): nothing runs between turns, so a job queued for later (a
 * booking reminder, the 5 minute delayed mention, comment and task emails, a
 * retry's backoff) waits for whatever starts the next one. Every signed in
 * request calls this: it wakes the drain once the earliest row the drain saw
 * has come due (at most every 10 seconds), and otherwise at most every 2
 * minutes, to see rows other instances queued. A wake with nothing due costs
 * one check and ends without starting the runners.
 */
export function createDueWake(options: DueWakeOptions): () => void {
  const now = options.now ?? Date.now;
  const everyMs = options.everyMs ?? DUE_LOOK_MS;
  const soonestMs = options.soonestMs ?? DUE_WAKE_MS;
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    const due = options.drain.nextDue();
    const gap = due !== undefined && due <= at ? soonestMs : everyMs;
    if (at - last < gap) return;
    last = at;
    options.wake('use');
  };
}
