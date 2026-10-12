// The arrival histogram (spec 0011, AC-200, AC-212): it sums up as a list of
// the same times would, by the nearest rank, with the clock offset added, and
// keeps times past either end in the end buckets.
import { describe, expect, it } from 'vitest';
import { addTo, createHistogram, HISTOGRAM_CEILING_MS, mergeHistograms, summarizeHistogram } from './histogram.ts';
import { summarize } from './stats.ts';

describe('the histogram', () => {
  it('sums up as summarize does, offset added', () => {
    const values = Array.from({ length: 200 }, (_, index) => (index * 37) % 900);
    const histogram = createHistogram();
    for (const value of values) addTo(histogram, value);
    expect(summarizeHistogram(histogram)).toEqual(summarize(values));
    expect(summarizeHistogram(histogram, 30)?.p50).toBe((summarize(values)?.p50 ?? 0) + 30);
    expect(summarizeHistogram(createHistogram())).toBeUndefined();
  });

  it('merges threads, and keeps negative raw times and very slow ones', () => {
    const one = createHistogram();
    const two = createHistogram();
    addTo(one, -20);
    addTo(two, 10);
    addTo(two, 120_000);
    expect(summarizeHistogram(mergeHistograms([one, two]), 30)).toMatchObject({
      count: 3,
      p50: 40,
      max: HISTOGRAM_CEILING_MS + 30,
    });
    expect(summarizeHistogram(one, 30)?.p50).toBe(10);
  });
});
