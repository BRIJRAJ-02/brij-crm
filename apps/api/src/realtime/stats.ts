// The relay's delivery numbers (spec 0007, AC-77), kept in memory only: a
// rolling window of each published row's lag (`published_at - created_at`,
// measured by Postgres when the row is marked), and what the relay last read
// and still holds unpublished, per workspace. The relay logs them as
// `relay.stats` once a minute while it is active, and the worker's `/health`
// reports them, for monitoring (#11) to chart. Nothing here touches the
// database or runs a timer.

/** The window the lag percentiles cover: 5 minutes. */
export const STATS_WINDOW_MS = 5 * 60_000;

/** The most lag samples kept; past it the oldest go first, so a burst can't grow memory without bound. */
export const MAX_SAMPLES = 20_000;

/** What `/health` and the `relay.stats` line report. */
export interface RelayStatsSnapshot {
  /** Rows published in the window. */
  readonly published: number;
  /** Lag from commit to publish over the window, in ms; undefined while nothing was published in it. */
  readonly lagMs: { readonly p50: number; readonly p95: number; readonly max: number } | undefined;
  /**
   * Rows the relay read and hasn't published yet, across workspaces. A lower
   * bound: the relay reads at most one batch (100) of a workspace at a time.
   */
  readonly pending: number;
  /** How long the oldest of those rows has waited since its commit, in ms; undefined with none. */
  readonly oldestPendingMs: number | undefined;
}

/** The relay's numbers, with `now` (unix ms) as the clock. */
export interface RelayStats {
  /** Rows marked published, with the lag of each. */
  readonly published: (lagsMs: readonly number[]) => void;
  /**
   * What a workspace still holds unpublished after its turn: how many rows,
   * and the commit time (ISO) of the oldest. Nothing (or 0) clears it.
   */
  readonly pending: (workspaceId: string, count: number, oldestAt?: string) => void;
  readonly snapshot: () => RelayStatsSnapshot;
}

/** The value at fraction `q` of an ascending list (nearest rank). */
function rank(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
}

/** The relay's rolling numbers. */
export function createRelayStats({
  now = () => Date.now(),
  windowMs = STATS_WINDOW_MS,
  maxSamples = MAX_SAMPLES,
}: {
  readonly now?: () => number;
  readonly windowMs?: number;
  readonly maxSamples?: number;
} = {}): RelayStats {
  // Samples in arrival order: when each was published, and its lag.
  const samples: { readonly at: number; readonly lagMs: number }[] = [];
  const waiting = new Map<string, { readonly count: number; readonly oldest: number }>();

  /** Drops samples older than the window, and the oldest past `maxSamples`. */
  const trim = (time: number) => {
    const first = samples.findIndex((sample) => time - sample.at <= windowMs);
    samples.splice(0, first < 0 ? samples.length : Math.max(first, samples.length - maxSamples));
  };

  return {
    published(lagsMs) {
      if (lagsMs.length === 0) return;
      const time = now();
      for (const lagMs of lagsMs) samples.push({ at: time, lagMs: Math.max(0, lagMs) });
      if (samples.length > maxSamples) trim(time);
    },
    pending(workspaceId, count, oldestAt) {
      const oldest = oldestAt === undefined ? Number.NaN : Date.parse(oldestAt);
      if (count <= 0 || Number.isNaN(oldest)) waiting.delete(workspaceId);
      else waiting.set(workspaceId, { count, oldest });
    },
    snapshot() {
      const time = now();
      trim(time);
      const lags = samples.map((sample) => sample.lagMs).sort((a, b) => a - b);
      const held = [...waiting.values()];
      // A loop, not a spread: a spread of a very long list throws.
      const oldest = held.reduce((least, entry) => Math.min(least, entry.oldest), Number.POSITIVE_INFINITY);
      return {
        published: lags.length,
        lagMs:
          lags.length === 0
            ? undefined
            : { p50: rank(lags, 0.5), p95: rank(lags, 0.95), max: lags[lags.length - 1] ?? 0 },
        pending: held.reduce((sum, entry) => sum + entry.count, 0),
        oldestPendingMs: held.length === 0 ? undefined : Math.max(0, time - oldest),
      };
    },
  };
}
