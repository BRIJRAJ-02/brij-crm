// The geometry that keeps a floating error inside what would clip it (F37):
// in from the edge it crosses, and over its anchor when there is no room under it.
import { describe, expect, it } from 'vitest';
import { flipsAbove, shiftInside } from './float-inside.ts';

describe('shiftInside', () => {
  const room = { start: 0, end: 1000 };

  it('leaves a box that fits where it is', () => {
    expect(shiftInside({ start: 100, end: 380 }, room)).toBe(0);
  });

  it('moves a box crossing the end edge back in, as far as it crosses', () => {
    expect(shiftInside({ start: 880, end: 1160 }, room)).toBe(-160);
  });

  it('moves a box crossing the start edge in (a right to left cell)', () => {
    expect(shiftInside({ start: -40, end: 240 }, room)).toBe(40);
  });

  it('lines a box wider than the room up with its start', () => {
    expect(shiftInside({ start: 100, end: 1300 }, room)).toBe(-100);
  });
});

describe('flipsAbove', () => {
  const room = { start: 0, end: 500 };
  const anchor = { start: 400, end: 432 };

  it('stays under its anchor while it fits there', () => {
    expect(flipsAbove({ start: 436, end: 480 }, anchor, room)).toBe(false);
  });

  it('goes above when it crosses the bottom and fits above', () => {
    expect(flipsAbove({ start: 436, end: 520 }, anchor, room)).toBe(true);
  });

  it('stays under when there is no room above either', () => {
    expect(flipsAbove({ start: 436, end: 520 }, { start: 40, end: 72 }, { start: 0, end: 100 })).toBe(false);
  });
});
