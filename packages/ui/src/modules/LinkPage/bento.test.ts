import { describe, expect, it } from 'vitest';
import { bentoSpans, isSnapped, spanOf, type BentoColumns, type BentoSpan } from './bento.ts';

/** Every row of a layout, as the spans of its cards: a full grid has every row summing to the columns. */
function rowsOf(spans: readonly number[], columns: number): number[][] {
  const rows: number[][] = [[]];
  let used = 0;
  for (const span of spans) {
    if (used + span > columns) {
      rows.push([]);
      used = 0;
    }
    rows.at(-1)?.push(span);
    used += span;
  }
  return rows;
}

describe('bentoSpans', () => {
  it('keeps what fits and fills each row', () => {
    expect(bentoSpans([1, 1, 1], 3)).toEqual([1, 1, 1]);
    expect(bentoSpans([2, 1, 1, 2], 3)).toEqual([2, 1, 1, 2]);
    expect(bentoSpans([1, 1], 2)).toEqual([1, 1]);
  });

  it('widens the card before a wide one that would not fit, and the last card of a short last row', () => {
    // 1, 1 then a 2: the second card widens to finish its row, the 2 starts the next and the last row closes.
    expect(bentoSpans([1, 1, 2], 3)).toEqual([1, 2, 3]);
    expect(bentoSpans([1, 2], 2)).toEqual([2, 2]);
    expect(bentoSpans([1], 3)).toEqual([3]);
  });

  it('draws one column on a phone, whatever was asked', () => {
    expect(bentoSpans([2, 1, 2], 1)).toEqual([1, 1, 1]);
  });

  it('never leaves a hole, for any order of spans on any grid', () => {
    const orders: BentoSpan[][] = [];
    for (let length = 1; length <= 6; length += 1) {
      for (let bits = 0; bits < 2 ** length; bits += 1) {
        orders.push(Array.from({ length }, (_, at) => ((bits >> at) & 1 ? 2 : 1)));
      }
    }
    for (const columns of [1, 2, 3] as const satisfies readonly BentoColumns[]) {
      for (const order of orders) {
        const spans = bentoSpans(order, columns);
        expect(spans).toHaveLength(order.length);
        for (const row of rowsOf(spans, columns)) expect(row.reduce((sum, span) => sum + span, 0)).toBe(columns);
      }
    }
  });

  it('says which cards it widened', () => {
    expect(isSnapped([1, 1, 2], 3, 1)).toBe(true);
    expect(isSnapped([1, 1, 2], 3, 0)).toBe(false);
    expect(spanOf('large')).toBe(2);
    expect(spanOf(undefined)).toBe(1);
  });
});
