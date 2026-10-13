// The worker's stats reporter (spec 0010, AC-180 to AC-182). Once a minute for
// as long as the process lives, it reads numbers the worker already holds in
// memory and records them; it never touches the database, so a sleeping worker
// lets Neon sleep too. Each tick:
// 1. records `worker.awake` (1 awake, 0 asleep);
// 2. while awake only, asks each source for its gauges (the relay's unpublished
//    rows and the oldest one's age first; spec 0008's queue numbers join later)
//    and records them;
// 3. raises `RELAY_LAGGING` once an episode, when the oldest unpublished row
//    is older than 30 seconds at two awake ticks in a row;
// 4. checks in to the heartbeat, awake or asleep, so only a dead process
//    misses one.
// It imports no vendor: the Sentry wrapper's functions come in as arguments.
import { errorFields } from '../log.ts';
import type { RelayStatsSnapshot } from '../realtime/stats.ts';
import type { IssueCode, MetricName } from './sentry.ts';

/** How often the reporter ticks: once a minute. */
export const STATS_EVERY_MS = 60_000;

/** The oldest unpublished row's age, in seconds, over which a tick counts as slow (AC-182). */
export const RELAY_LAGGING_AFTER_S = 30;

/** Slow awake ticks in a row that raise `RELAY_LAGGING`. */
const SLOW_TICKS = 2;

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
  /** The wrapper's `metrics` (only `gauge` is used here). */
  readonly metrics: { readonly gauge: (name: MetricName, value: number) => void };
  /** The wrapper's `heartbeat`: called at every tick, awake or asleep. */
  readonly heartbeat: () => void;
  /** The wrapper's `raiseIssue`. */
  readonly raise: (code: IssueCode, numbers: Readonly<Record<string, number>>) => void;
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
  // Slow awake ticks in a row; the episode's issue goes once, at the second.
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
    // Asleep, no source is read and no outbox gauge is sent.
    const gauges = awake ? read() : {};
    for (const [name, value] of Object.entries(gauges) as [keyof SourceGauges, number | undefined][]) {
      if (value !== undefined) attempt(name, () => deps.metrics.gauge(name, value), undefined);
    }
    const age = gauges['outbox.oldest_age_s'];
    slow = age !== undefined && age > RELAY_LAGGING_AFTER_S ? slow + 1 : 0;
    if (slow === SLOW_TICKS) {
      const numbers = { pending: gauges['outbox.pending'] ?? 0, oldest_age_s: age ?? 0 };
      log.warn('relay.lagging', numbers);
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
