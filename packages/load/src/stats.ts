// Percentiles and a line's summary (spec 0011, AC-199): p50, p95, p99, max
// and the count, by the nearest rank, so a p95 is always a time some action
// really took.

/** A set of times summed up, in milliseconds. */
export interface Summary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** The nearest rank percentile `p` (0 to 100) of `sorted` (ascending, not empty). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('No values to take a percentile of.');
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? Number.NaN;
}

/** The summary of `values`, or undefined when there are none. */
export function summarize(values: readonly number[]): Summary | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}
