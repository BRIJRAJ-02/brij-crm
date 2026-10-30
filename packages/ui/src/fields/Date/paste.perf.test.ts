// The grid's date paste budget (fields polish review, P1): 10,000 pasted cells
// read through `dateType.fromText` in under 100 ms, the median of 3 runs after
// a warm up. Each run reads today once, as the grid's paste does, so the cost
// is the parser's alone. It logs its numbers, so the budget can be tuned.
import { describe, expect, it } from 'vitest';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import type { TextContext } from '../types.ts';
import { dateType } from './type.ts';

const CELLS = 10_000;
const BUDGET_MS = 100;

/** What people paste into a date column: ISO, instants, words, named months and numeric days. */
const SHAPES = [
  '2026-10-08',
  '2026-10-08T09:00:00Z',
  'tomorrow',
  'next fri',
  'in 2 weeks',
  'Oct 8',
  '8 October 2027',
  '10/8/2026',
  '8/10',
  'not a date',
] as const;

const texts = Array.from({ length: CELLS }, (_, index) => SHAPES[index % SHAPES.length] ?? '');

function pasteOnce(locale: string): number {
  const context: TextContext = {
    locale,
    timeZone: 'UTC',
    today: '2026-10-08',
    attribute: FIELD_SAMPLES.date.attribute,
  };
  const started = performance.now();
  for (const text of texts) dateType.fromText(text, context);
  return performance.now() - started;
}

describe('date paste', () => {
  it.each(['en-US', 'de-DE'])(`reads ${String(CELLS)} cells in under ${String(BUDGET_MS)} ms (%s)`, (locale) => {
    pasteOnce(locale);
    const runs = [pasteOnce(locale), pasteOnce(locale), pasteOnce(locale)].sort((a, b) => a - b);
    const median = runs[1] ?? Number.POSITIVE_INFINITY;
    console.warn(
      `date paste ${locale}: median ${median.toFixed(1)} ms of ${runs.map((run) => run.toFixed(1)).join(', ')}`,
    );
    expect(median).toBeLessThan(BUDGET_MS);
  });
});
