// A fixed histogram of times in 1 ms buckets (spec 0011, AC-200): every
// event arrival at every subscriber is one sample, about 10^7 at 1,000 users,
// too many to keep as a list, send between threads and sort. Buckets run from
// -1 second (a raw arrival before the clock offset can be a little negative)
// to 60 seconds; anything past either end lands in the end bucket.
import type { Summary } from './stats.ts';

/** The lowest time kept, below zero: raw arrivals are joined to the database clock offset later. */
export const HISTOGRAM_FLOOR_MS = -1_000;
/** The highest time kept: anything slower lands here. */
export const HISTOGRAM_CEILING_MS = 60_000;

const SIZE = HISTOGRAM_CEILING_MS - HISTOGRAM_FLOOR_MS + 1;

/** A histogram's counts, one per millisecond from the floor. */
export type Histogram = Uint32Array;

/** An empty histogram. */
export const createHistogram = (): Histogram => new Uint32Array(SIZE);

/** Adds one time, rounded to the millisecond and kept within the floor and the ceiling. */
export function addTo(histogram: Histogram, ms: number): void {
  const bucket = Math.min(SIZE - 1, Math.max(0, Math.round(ms) - HISTOGRAM_FLOOR_MS));
  histogram[bucket] = (histogram[bucket] ?? 0) + 1;
}

/** The sum of several histograms (one per thread). */
export function mergeHistograms(histograms: readonly Histogram[]): Histogram {
  const merged = createHistogram();
  for (const histogram of histograms) {
    for (let bucket = 0; bucket < SIZE; bucket += 1) merged[bucket] = (merged[bucket] ?? 0) + (histogram[bucket] ?? 0);
  }
  return merged;
}

/**
 * The summary of a histogram's times plus `offsetMs`, by the nearest rank (as
 * `summarize` does), or undefined when it is empty.
 */
export function summarizeHistogram(histogram: Histogram, offsetMs = 0): Summary | undefined {
  let count = 0;
  for (const value of histogram) count += value;
  if (count === 0) return undefined;
  const ranks = [50, 95, 99].map((p) => Math.max(1, Math.ceil((p / 100) * count)));
  const found: number[] = [];
  let seen = 0;
  let max = 0;
  for (let bucket = 0; bucket < SIZE; bucket += 1) {
    const here = histogram[bucket] ?? 0;
    if (here === 0) continue;
    seen += here;
    max = bucket;
    while (found.length < ranks.length && seen >= (ranks[found.length] ?? Infinity)) found.push(bucket);
  }
  const at = (bucket: number) => bucket + HISTOGRAM_FLOOR_MS + offsetMs;
  return { count, p50: at(found[0] ?? max), p95: at(found[1] ?? max), p99: at(found[2] ?? max), max: at(max) };
}
