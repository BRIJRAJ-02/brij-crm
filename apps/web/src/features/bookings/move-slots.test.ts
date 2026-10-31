// Where a dragged booking may land, from the page's offered times.
import { describe, expect, it } from 'vitest';
import { bookingIdOfBlock, canUndoMove, mayLand, stepOfStarts } from './move-slots.ts';

const MIN = 60_000;
const TEN = Date.parse('2026-11-03T10:00:00Z');
const own = { startMs: TEN, minutes: 30 };

describe('mayLand', () => {
  it('lets a booking stay where it is, or get shorter, without asking', () => {
    expect(mayLand(own, own, undefined)).toBe(true);
    expect(mayLand(own, { startMs: TEN, minutes: 15 }, new Set())).toBe(true);
  });

  it('does not know yet before the page’s times are read', () => {
    expect(mayLand(own, { startMs: TEN + 30 * MIN, minutes: 30 }, undefined)).toBeUndefined();
    expect(mayLand(own, { startMs: TEN, minutes: 45 }, undefined)).toBeUndefined();
  });

  it('lands only on a start the page offers', () => {
    const offered = new Set([TEN, TEN + 30 * MIN]);
    expect(mayLand(own, { startMs: TEN + 30 * MIN, minutes: 30 }, offered)).toBe(true);
    expect(mayLand(own, { startMs: TEN + 15 * MIN, minutes: 30 }, offered)).toBe(false);
    // Longer at the same start is asked of the page’s times for that length.
    expect(mayLand(own, { startMs: TEN, minutes: 45 }, new Set([TEN]))).toBe(true);
    expect(mayLand(own, { startMs: TEN, minutes: 45 }, new Set())).toBe(false);
  });
});

describe('stepOfStarts', () => {
  it('is the shortest gap between the offered times', () => {
    expect(stepOfStarts([TEN, TEN + 30 * MIN, TEN + 60 * MIN, TEN + 240 * MIN])).toBe(30);
    expect(stepOfStarts([TEN + 15 * MIN, TEN, TEN + 15 * MIN])).toBe(15);
  });

  it('has none for fewer than two times', () => {
    expect(stepOfStarts([])).toBeUndefined();
    expect(stepOfStarts([TEN])).toBeUndefined();
  });
});

describe('bookingIdOfBlock', () => {
  it('reads the booking out of a day block’s id', () => {
    expect(bookingIdOfBlock('0194b7c0-1111-7000-8000-000000000001:2026-11-03')).toBe(
      '0194b7c0-1111-7000-8000-000000000001',
    );
    expect(bookingIdOfBlock('plain')).toBe('plain');
  });
});

describe('canUndoMove', () => {
  it('offers Undo only while a move back is still one of the five', () => {
    expect(canUndoMove(0)).toBe(true);
    expect(canUndoMove(3)).toBe(true);
    expect(canUndoMove(4)).toBe(false);
  });
});
