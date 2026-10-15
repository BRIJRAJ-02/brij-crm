// The worker's lifecycle (spec 0008, Letting the database sleep; milestone 3,
// AC-111, AC-117): awake or asleep, for the job runners and the relay
// together, on one idle clock. Neon suspends the compute after 5 minutes with
// no query, and Graphile Worker polls every 2 seconds, so a worker that only
// ever polled would keep it awake all month.
//
// - Awake: the queue pool is open, both runners LISTEN and poll, the relay is
//   active. Every task call (start and end), every sign of relay work and
//   every wake call restarts the idle clock.
// - Going to sleep: once the clock passes `WORKER_IDLE_SLEEP_SECONDS` with no
//   task call in flight, one check on the worker's own connection: no queue
//   row or queue locked, no row due within 30 seconds, no outbox row waiting
//   (with the relay on). If it passes, the wake time is the earliest of the
//   next row's `run_at`, the next 03:00 UTC cron minus 30 seconds, and 24
//   hours from now; a wake time under a minute away (or under the idle time,
//   if shorter) keeps it awake instead.
//   It stops the runners (Graphile's graceful stop), sends the relay dormant,
//   closes the queue pool, and sets the timer. The tenant pool lets its idle
//   connections go by itself, after 10 seconds (node-postgres's default).
// - Asleep: no connection and no query. `/health` answers from memory.
// - Waking (a wake call or the timer): opens the pool, starts the runners
//   (Graphile backfills a missed cron day as it starts) and wakes the relay,
//   which drains at once. A failure retries with backoff (1, 2, 4 up to 30
//   seconds) and never exits the process; a runner that stops on its own
//   while awake (its connection lost) goes back through waking too.
// `idleSleepMs` 0 never sleeps: only the reconnect applies.
import type { SleepCheck } from '@crm/db';
import { errorFields } from '../log.ts';
import { DAILY_CRON_HOUR_UTC, type JobsLog } from './graphile.ts';

/** Where the worker is. `waking` covers the first start and every reconnect. */
export type WorkerState = 'awake' | 'asleep' | 'waking' | 'stopped';

/** The worker's open connections while awake: its runners and its queue pool. */
export interface AwakeWorker {
  /** Task calls in flight. */
  busy(): number;
  /** The check before sleeping, on the worker's own connection. */
  check(): Promise<SleepCheck>;
  /** Stops the runners (the slices in hand finish their batch) and closes the queue pool. */
  close(): Promise<void>;
}

/** The relay as the lifecycle drives it. */
export interface LifecycleRelay {
  wake(): void;
  sleep(): Promise<void>;
  mode(): 'active' | 'dormant' | 'stopped';
}

/** The clock and timers, real unless a test passes its own. */
export interface LifecycleClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the lifecycle needs, all passed in (the worker builds them). */
export interface LifecycleDeps {
  /**
   * Opens the queue pool and starts the runners, with the hooks they report
   * through: each task call's start and end, and a runner that stopped on its
   * own. Throws when it can't (the database unreachable).
   */
  readonly open: (hooks: {
    readonly onActivity: () => void;
    readonly onFailed: (error: unknown) => void;
  }) => Promise<AwakeWorker>;
  /** The relay, when it is on: dormant exactly while the worker sleeps. */
  readonly relay?: LifecycleRelay;
  /** Milliseconds with no work before sleeping; 0 never sleeps. */
  readonly idleSleepMs: number;
  readonly log: JobsLog;
  readonly clock?: LifecycleClock;
  /** The first wait before trying to wake again after a failure, doubled each time (1 second). */
  readonly backoffMs?: number;
  /** The longest wait between tries (30 seconds). */
  readonly maxBackoffMs?: number;
  /** A sleep shorter than this isn't worth closing for (a minute, or the idle time if shorter): the worker stays awake instead. */
  readonly minSleepMs?: number;
}

/** The running lifecycle. */
export interface Lifecycle {
  /** Wakes for the first time; resolves once awake (retrying with backoff meanwhile) or stopped. */
  start(): Promise<void>;
  /** A wake call: wakes a sleeping worker, or restarts an awake one's idle clock. Never throws. */
  wake(): void;
  /** A sign of work: the idle clock starts again. */
  touch(): void;
  state(): WorkerState;
  /** Stops for good: the runners finish their batch and hand their jobs back, and nothing wakes it again. */
  stop(): Promise<void>;
}

/** How close a queue row may be due and the worker still sleep. */
export const DUE_SOON_MS = 30_000;

/** How far before the cron's time the worker wakes for it. */
export const CRON_LEAD_MS = 30_000;

/** The longest sleep: a wrong wake time never keeps the worker asleep longer than a day. */
export const MAX_SLEEP_MS = 24 * 60 * 60_000;

/** How long the check before sleeping may take before it counts as failed (the worker then stays awake). */
export const CHECK_TIMEOUT_MS = 15_000;

/** The next 03:00 UTC (`DAILY_CRON_HOUR_UTC`) strictly after `now`: when the daily cleanup's cron fires. */
export function nextDailyCron(now: number): number {
  const at = new Date(now);
  at.setUTCHours(DAILY_CRON_HOUR_UTC, 0, 0, 0);
  if (at.getTime() <= now) at.setUTCDate(at.getUTCDate() + 1);
  return at.getTime();
}

/**
 * When a worker that passed its check at `now` should wake: the earliest of
 * the next due queue row (its database time moved onto this clock), the
 * cron's time less `CRON_LEAD_MS`, and a day from now.
 */
export function wakeTime(check: SleepCheck, now: number): number {
  const skew = now - check.now.getTime();
  const nextRow = check.nextRunAt === undefined ? Number.POSITIVE_INFINITY : check.nextRunAt.getTime() + skew;
  return Math.min(nextRow, nextDailyCron(now) - CRON_LEAD_MS, now + MAX_SLEEP_MS);
}

const REAL_CLOCK: LifecycleClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => {
    const handle = setTimeout(run, ms);
    // A sleeping worker's timer never holds the process open on its own: the HTTP server does.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The lifecycle, with everything it touches passed in. */
export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  const clock = deps.clock ?? REAL_CLOCK;
  const { log } = deps;
  const backoffMs = deps.backoffMs ?? 1_000;
  const maxBackoffMs = deps.maxBackoffMs ?? 30_000;
  const minSleepMs = deps.minSleepMs ?? Math.min(60_000, deps.idleSleepMs);
  let state: WorkerState = 'stopped';
  let stopped = false;
  let awake: AwakeWorker | undefined;
  // When the worker last saw a sign of work.
  let lastWork = clock.now();
  // The one timer: the idle check while awake, the wake time while asleep, the next try while waking.
  let timer: unknown;
  // A wake that arrived while the worker was closing for sleep: it wakes again as soon as it has closed.
  let wakeWanted = false;
  // Transitions (waking, sleeping, stopping) never overlap: each runs after the one before.
  let transition: Promise<void> = Promise.resolve();
  let firstAwake = Promise.withResolvers<undefined>();
  // Which open the hooks belong to: a stale runner's failure after a reconnect is ignored.
  let generation = 0;
  // Ends a backoff wait early: stop() must not wait out a 30 second backoff.
  let endWait: (() => void) | undefined;
  // The generation being closed for sleep, and whether one of its tasks ran meanwhile (a row taken just after the
  // check may hand over a new row due now, which the wake time read before the close doesn't know).
  let closing: number | undefined;
  let workWhileClosing = false;
  const workedWhileClosing = (): boolean => workWhileClosing;
  // Read through functions where an await sits between a write and a read.
  const isStopped = (): boolean => stopped;
  const current = (): WorkerState => state;
  const currentWorker = (): AwakeWorker | undefined => awake;
  const wantsWake = (): boolean => wakeWanted;

  const serially = (step: () => Promise<void>): Promise<void> => {
    transition = transition.then(step, step);
    return transition;
  };

  function setTimer(run: () => void, ms: number): void {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = clock.setTimeout(
      () => {
        timer = undefined;
        run();
      },
      Math.max(0, ms),
    );
  }

  function clearTimer(): void {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }

  function touch(): void {
    lastWork = clock.now();
  }

  /** While awake, the idle check is due once the clock passes the idle time. */
  function scheduleIdle(): void {
    if (state !== 'awake' || deps.idleSleepMs <= 0) return;
    setTimer(() => void idleCheck(), lastWork + deps.idleSleepMs - clock.now());
  }

  async function idleCheck(): Promise<void> {
    const worker = awake;
    if (state !== 'awake' || worker === undefined || stopped) return;
    // A task in flight is work going on: the idle clock starts again (so a long one is never polled in a loop).
    if (worker.busy() > 0) touch();
    if (clock.now() - lastWork < deps.idleSleepMs) {
      scheduleIdle();
      return;
    }
    let check: SleepCheck;
    try {
      check = await withTimeout(worker.check(), CHECK_TIMEOUT_MS);
    } catch (error) {
      // A connection that failed is the runners' to report; the clock starts again either way.
      log.warn('worker.sleep.check.failed', errorFields(error));
      touch();
      scheduleIdle();
      return;
    }
    // Work arrived during the check, or something still waits: stay awake for another idle spell.
    const at = clock.now();
    const dueSoon = check.nextRunAt !== undefined && check.nextRunAt.getTime() - check.now.getTime() <= DUE_SOON_MS;
    if (current() !== 'awake' || currentWorker() !== worker) return;
    if (worker.busy() > 0) touch();
    if (at - lastWork < deps.idleSleepMs) {
      scheduleIdle();
      return;
    }
    if (check.locked || check.unpublished || dueSoon) {
      touch();
      scheduleIdle();
      return;
    }
    const wakeAt = wakeTime(check, at);
    if (wakeAt - at < minSleepMs) {
      touch();
      scheduleIdle();
      return;
    }
    await serially(() => goToSleep(wakeAt));
  }

  async function goToSleep(wakeAt: number): Promise<void> {
    const worker = awake;
    if (state !== 'awake' || worker === undefined || stopped) return;
    clearTimer();
    // Not `asleep` until every connection is closed; a wake meanwhile is kept for after.
    state = 'waking';
    wakeWanted = false;
    workWhileClosing = false;
    closing = generation;
    awake = undefined;
    generation += 1;
    try {
      await worker.close();
    } catch (error) {
      log.warn('worker.sleep.close.failed', errorFields(error));
    }
    closing = undefined;
    await deps.relay?.sleep();
    if (isStopped()) return;
    if (wantsWake() || workedWhileClosing() || deps.relay?.mode() === 'active') {
      // Something woke it, or a task ran, while it closed: straight back.
      await wakeUp('wake call');
      return;
    }
    state = 'asleep';
    setTimer(() => void serially(() => wakeUp('timer')), wakeAt - clock.now());
    log.info('Worker asleep', { wakeAt: new Date(wakeAt).toISOString() });
  }

  /** Opens everything, retrying with backoff until it works or the worker stops. */
  async function wakeUp(reason: 'start' | 'wake call' | 'timer' | 'lost'): Promise<void> {
    // Already awake (a wake call and the timer both queued a wake): nothing to open twice.
    if (stopped || state === 'awake') return;
    clearTimer();
    state = 'waking';
    touch();
    for (let failures = 0; !isStopped(); failures += 1) {
      const mine = generation + 1;
      // A runner that fails before this open is adopted (its sibling still starting): the open counts as failed.
      const early = { failed: false, adopted: false };
      try {
        const worker = await deps.open({
          onActivity: () => {
            if (mine === generation) touch();
            else if (mine === closing) workWhileClosing = true;
          },
          onFailed: (error) => {
            if (mine === generation && early.adopted) void serially(() => lost(error));
            else if (!early.adopted) early.failed = true;
          },
        });
        if (isStopped()) {
          await worker.close();
          return;
        }
        if (early.failed) {
          await worker.close().catch(() => undefined);
          throw new Error('A job runner stopped as it started.');
        }
        early.adopted = true;
        generation = mine;
        awake = worker;
        state = 'awake';
        touch();
        deps.relay?.wake();
        if (reason !== 'start') log.info('Worker awake', { reason });
        firstAwake.resolve(undefined);
        scheduleIdle();
        return;
      } catch (error) {
        const wait = Math.min(backoffMs * 2 ** failures, maxBackoffMs);
        log.warn('Worker could not wake; trying again', { inMs: wait, ...errorFields(error) });
        await new Promise<void>((resolve) => {
          endWait = resolve;
          setTimer(resolve, wait);
        });
        endWait = undefined;
      }
    }
  }

  /** A runner stopped on its own while awake: close what is left and wake again. */
  async function lost(error: unknown): Promise<void> {
    const worker = awake;
    if (state !== 'awake' || worker === undefined || stopped) return;
    log.warn('Worker lost its connection; waking again', errorFields(error));
    awake = undefined;
    generation += 1;
    state = 'waking';
    clearTimer();
    try {
      await worker.close();
    } catch (closeError) {
      log.warn('worker.close.failed', errorFields(closeError));
    }
    await wakeUp('lost');
  }

  return {
    start() {
      if (state !== 'stopped' || stopped) return firstAwake.promise;
      firstAwake = Promise.withResolvers<undefined>();
      void serially(() => wakeUp('start'));
      return firstAwake.promise;
    },
    wake() {
      touch();
      if (stopped) return;
      if (state === 'asleep') {
        clearTimer();
        void serially(() => wakeUp('wake call'));
      } else if (state === 'waking') {
        wakeWanted = true;
      }
    },
    touch,
    state: () => state,
    async stop() {
      stopped = true;
      clearTimer();
      endWait?.();
      firstAwake.resolve(undefined);
      await serially(async () => {
        const worker = awake;
        awake = undefined;
        generation += 1;
        state = 'stopped';
        await worker?.close();
      });
    },
  };
}

/** `work`, or a rejection once `ms` pass first (its result is then ignored). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${String(ms)} ms.`)), ms);
    timer.unref();
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
