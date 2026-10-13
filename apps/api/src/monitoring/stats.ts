// The worker's stats reporter (spec 0010, AC-180 to AC-182). Once a minute for
// as long as the process lives, it reads numbers the worker already holds in
// memory and records them; it never touches the database, so a sleeping worker
// lets Neon sleep too. Each tick:
// 1. records `worker.awake` (1 awake, 0 asleep), and the `relay.lag` values
//    the lag sample gathered since the last tick (every published row's, up
//    to 500 a minute; past that a uniform sample of 500, so a burst costs the
//    relay nothing and the percentiles stay true);
// 2. while awake only, asks each source for its gauges (the relay's unpublished
//    rows and the oldest one's age first; spec 0008's queue numbers join later)
//    and records them;
// 3. raises `RELAY_LAGGING` when the oldest unpublished row is older than 30
//    seconds at two awake ticks in a row, and again every hour the episode
//    lasts (so the issue's 2 hour auto resolve can't close it meanwhile);
// 4. checks in to the heartbeat, awake or asleep, so only a dead process
//    misses one.
// It imports no vendor: the Sentry wrapper's functions come in as arguments.
import { errorFields } from '../log.ts';
import type { RelayStatsSnapshot } from '../realtime/stats.ts';
import type { IssueCode, IssueNumbers, MetricName } from './sentry.ts';

/** How often the reporter ticks: once a minute. */
export const STATS_EVERY_MS = 60_000;

/** The oldest unpublished row's age, in seconds, over which a tick counts as slow (AC-182). */
export const RELAY_LAGGING_AFTER_S = 30;

/** Slow awake ticks in a row that raise `RELAY_LAGGING`. */
const SLOW_TICKS = 2;

/** Slow ticks after which a lasting episode raises `RELAY_LAGGING` again: an hour of them. */
const RAISE_AGAIN_EVERY = 60;

/** The most `relay.lag` values recorded per tick (`createLagSample`). */
export const LAG_SAMPLE_SIZE = 500;

/** A bounded sample of lag values between ticks. */
export interface LagSample {
  /** Hears each published row's lag (the relay's `lag` dep): O(1) a value, no allocation past the sample. */
  readonly add: (lagsMs: readonly number[]) => void;
  /** The values gathered since the last drain, and a fresh start. */
  readonly drain: () => readonly number[];
}

/**
 * Every value up to `size` between drains, then a uniform sample of `size`
 * (reservoir sampling), so p50 and p95 per minute stay unbiased whatever the
 * burst, and recording them costs the same at 500 rows a minute as at 50,000.
 */
export function createLagSample({
  size = LAG_SAMPLE_SIZE,
  random = Math.random,
}: { readonly size?: number; readonly random?: () => number } = {}): LagSample {
  let kept: number[] = [];
  let seen = 0;
  return {
    add(lagsMs) {
      for (const lagMs of lagsMs) {
        seen += 1;
        if (kept.length < size) kept.push(lagMs);
        else {
          const slot = Math.floor(random() * seen);
          if (slot < size) kept[slot] = lagMs;
        }
      }
    },
    drain() {
      const out = kept;
      kept = [];
      seen = 0;
      return out;
    },
  };
}

/** The gauges a source may hand over: numbers only, named from the closed list, so none carries an id. */
export type SourceGauges = Readonly<Partial<Record<Exclude<MetricName, 'relay.lag' | 'worker.awake'>, number>>>;

/** One source of numbers, read from memory at each awake tick. */
export type StatsSource = () => SourceGauges;

/** Where the reporter warns: a step that failed, and the start of a `RELAY_LAGGING` episode. */
export interface StatsLog {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface StatsReporterDeps {
  /** Read in order at every awake tick (the relay's first). */
  readonly sources: readonly StatsSource[];
  /** The wrapper's `metrics`. */
  readonly metrics: {
    readonly gauge: (name: MetricName, value: number) => void;
    readonly distribution: (name: MetricName, value: number) => void;
  };
  /** The relay's lag values since the last tick, recorded as `relay.lag` at every tick, awake or asleep. */
  readonly lag?: LagSample;
  /** The wrapper's `heartbeat`: called at every tick, awake or asleep. */
  readonly heartbeat: () => void;
  /** The wrapper's `raiseIssue`. */
  readonly raise: <Code extends IssueCode>(code: Code, numbers: IssueNumbers[Code]) => void;
  /** Whether the worker is awake now, from memory. */
  readonly isAwake: () => boolean;
  readonly log: StatsLog;
  /** How often it ticks (default `STATS_EVERY_MS`). */
  readonly everyMs?: number;
}

export interface StatsReporter {
  /** Ticks once now, then every `everyMs` until `stop()`; the timer never holds the process open. Calling it again does nothing. */
  start(): void;
  /** Stops ticking. */
  stop(): void;
}

/** The relay's numbers as gauges: the rows it read and hasn't published, and how long the oldest has waited, in seconds (0 with none). */
export function relaySource(snapshot: () => RelayStatsSnapshot): StatsSource {
  return () => {
    const { pending, oldestPendingMs } = snapshot();
    return {
      'outbox.pending': pending,
      'outbox.oldest_age_s': Math.round((oldestPendingMs ?? 0) / 100) / 10,
    };
  };
}

/** The worker's once a minute stats tick, from memory only. */
export function createStatsReporter(deps: StatsReporterDeps): StatsReporter {
  const everyMs = deps.everyMs ?? STATS_EVERY_MS;
  const { log } = deps;
  // Slow awake ticks in a row; the episode's issue goes at the second, then every hour it lasts.
  let slow = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Runs one step of a tick; one that throws is logged and gives `fallback`, so the tick goes on and always checks in. */
  const attempt = <T>(what: string, run: () => T, fallback: T): T => {
    try {
      return run();
    } catch (error) {
      log.warn('stats.failed', { step: what, ...errorFields(error) });
      return fallback;
    }
  };

  /** The gauges every source hands over now, later sources winning a name. */
  const read = (): SourceGauges =>
    deps.sources.reduce<SourceGauges>(
      (gauges, source, index) => ({ ...gauges, ...attempt(`source ${String(index)}`, source, {}) }),
      {},
    );

  const tick = (): void => {
    const awake = attempt('awake', deps.isAwake, false);
    attempt('worker.awake', () => deps.metrics.gauge('worker.awake', awake ? 1 : 0), undefined);
    const { lag } = deps;
    if (lag !== undefined) {
      attempt(
        'relay.lag',
        () => {
          for (const lagMs of lag.drain()) deps.metrics.distribution('relay.lag', lagMs);
        },
        undefined,
      );
    }
    // Asleep, no source is read and no outbox gauge is sent.
    const gauges = awake ? read() : {};
    for (const [name, value] of Object.entries(gauges) as [keyof SourceGauges, number | undefined][]) {
      if (value !== undefined) attempt(name, () => deps.metrics.gauge(name, value), undefined);
    }
    const age = gauges['outbox.oldest_age_s'];
    slow = age !== undefined && age > RELAY_LAGGING_AFTER_S ? slow + 1 : 0;
    if (slow >= SLOW_TICKS && (slow - SLOW_TICKS) % RAISE_AGAIN_EVERY === 0) {
      const numbers = { pending: gauges['outbox.pending'] ?? 0, oldest_age_s: age ?? 0 };
      attempt('relay.lagging', () => log.warn('relay.lagging', numbers), undefined);
      attempt('RELAY_LAGGING', () => deps.raise('RELAY_LAGGING', numbers), undefined);
    }
    attempt('heartbeat', deps.heartbeat, undefined);
  };

  return {
    start() {
      if (timer !== undefined) return;
      timer = setInterval(tick, everyMs);
      timer.unref();
      tick();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
