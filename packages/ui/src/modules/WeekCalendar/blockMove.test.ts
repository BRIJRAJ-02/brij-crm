// A block's move and resize maths: snapping, the day's edges, the week's edges and the keys.
import { describe, expect, it } from 'vitest';
import { keyedFrom, movedBy, resizedBy, sameSpan, shiftOf, type MoveGeometry, type MoveSteps } from './blockMove.ts';

const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
/** 64px an hour, 140px a day. */
const GRID: MoveGeometry = { dayKeys: DAYS, dayWidth: 140, pxPerMinute: 64 / 60 };
const STEPS: MoveSteps = { move: 15, length: 15 };
const at = (dayKey: string, startMinute: number, endMinute: number) => ({ dayKey, startMinute, endMinute });
const TUESDAY_TEN = at('2026-11-03', 600, 630);

describe('movedBy', () => {
  it('snaps a drag down to the nearest step', () => {
    // 20px is 18.75 minutes: one step of 15.
    expect(movedBy(TUESDAY_TEN, { x: 0, y: 20 }, GRID, STEPS)).toEqual(at('2026-11-03', 615, 645));
    // 12px is 11.25 minutes: nearer 15 than 0.
    expect(movedBy(TUESDAY_TEN, { x: 0, y: 12 }, GRID, STEPS)).toEqual(at('2026-11-03', 615, 645));
    // 7px is 6.6 minutes: stays.
    expect(movedBy(TUESDAY_TEN, { x: 0, y: 7 }, GRID, STEPS)).toEqual(TUESDAY_TEN);
  });

  it('keeps the booking length and counts steps from where it began', () => {
    const odd = at('2026-11-03', 605, 650);
    expect(movedBy(odd, { x: 0, y: 64 }, GRID, { move: 30, length: 15 })).toEqual(at('2026-11-03', 665, 710));
  });

  it('moves a whole column for each column of travel', () => {
    expect(movedBy(TUESDAY_TEN, { x: 150, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-04');
    expect(movedBy(TUESDAY_TEN, { x: -150, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-02');
    expect(movedBy(TUESDAY_TEN, { x: 60, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-03');
    expect(movedBy(TUESDAY_TEN, { x: 71, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-04');
  });

  it('stays inside the week', () => {
    expect(movedBy(TUESDAY_TEN, { x: 5000, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-08');
    expect(movedBy(TUESDAY_TEN, { x: -5000, y: 0 }, GRID, STEPS).dayKey).toBe('2026-11-02');
  });

  it('stays inside the day, with its whole length', () => {
    expect(movedBy(TUESDAY_TEN, { x: 0, y: -5000 }, GRID, STEPS)).toEqual(at('2026-11-03', 0, 30));
    expect(movedBy(TUESDAY_TEN, { x: 0, y: 5000 }, GRID, STEPS)).toEqual(at('2026-11-03', 1410, 1440));
  });

  it('moves nowhere sideways when one day takes the width', () => {
    const day: MoveGeometry = { dayKeys: ['2026-11-03'], dayWidth: 0, pxPerMinute: 64 / 60 };
    expect(movedBy(TUESDAY_TEN, { x: 400, y: 0 }, day, STEPS).dayKey).toBe('2026-11-03');
  });
});

describe('resizedBy', () => {
  it('lengthens the end by whole steps and keeps the start', () => {
    // 32px is 30 minutes.
    expect(resizedBy(TUESDAY_TEN, 32, GRID, STEPS)).toEqual(at('2026-11-03', 600, 660));
    expect(resizedBy(TUESDAY_TEN, 7, GRID, STEPS)).toEqual(TUESDAY_TEN);
  });

  it('shortens to a quarter hour at the least', () => {
    expect(resizedBy(TUESDAY_TEN, -500, GRID, STEPS)).toEqual(at('2026-11-03', 600, 615));
  });

  it('never makes a shorter block longer than it was by asking for less', () => {
    expect(resizedBy(at('2026-11-03', 600, 610), -500, GRID, STEPS)).toEqual(at('2026-11-03', 600, 610));
  });

  it('stops at midnight', () => {
    expect(resizedBy(at('2026-11-03', 1380, 1410), 5000, GRID, STEPS)).toEqual(at('2026-11-03', 1380, 1440));
  });
});

describe('keyedFrom', () => {
  it('moves a step earlier or later with Up and Down', () => {
    expect(keyedFrom(TUESDAY_TEN, 'ArrowUp', false, DAYS, STEPS)).toEqual(at('2026-11-03', 585, 615));
    expect(keyedFrom(TUESDAY_TEN, 'ArrowDown', false, DAYS, STEPS)).toEqual(at('2026-11-03', 615, 645));
  });

  it('moves a day with Left and Right, and stops at the week’s edge', () => {
    expect(keyedFrom(TUESDAY_TEN, 'ArrowRight', false, DAYS, STEPS).dayKey).toBe('2026-11-04');
    expect(keyedFrom(TUESDAY_TEN, 'ArrowLeft', false, DAYS, STEPS).dayKey).toBe('2026-11-02');
    const monday = at('2026-11-02', 600, 630);
    expect(keyedFrom(monday, 'ArrowLeft', false, DAYS, STEPS)).toBe(monday);
  });

  it('does not change day in the day view', () => {
    expect(keyedFrom(TUESDAY_TEN, 'ArrowRight', false, ['2026-11-03'], STEPS)).toBe(TUESDAY_TEN);
  });

  it('stays inside the day', () => {
    const first = at('2026-11-03', 0, 30);
    expect(keyedFrom(first, 'ArrowUp', false, DAYS, STEPS)).toEqual(first);
    const last = at('2026-11-03', 1410, 1440);
    expect(keyedFrom(last, 'ArrowDown', false, DAYS, STEPS)).toEqual(last);
  });

  it('changes the length with Up and Down when resizing, and ignores sideways', () => {
    expect(keyedFrom(TUESDAY_TEN, 'ArrowDown', true, DAYS, STEPS)).toEqual(at('2026-11-03', 600, 645));
    expect(keyedFrom(TUESDAY_TEN, 'ArrowUp', true, DAYS, STEPS)).toEqual(at('2026-11-03', 600, 615));
    expect(keyedFrom(at('2026-11-03', 600, 615), 'ArrowUp', true, DAYS, STEPS)).toEqual(at('2026-11-03', 600, 615));
    expect(keyedFrom(TUESDAY_TEN, 'ArrowRight', true, DAYS, STEPS)).toBe(TUESDAY_TEN);
  });
});

describe('shiftOf and sameSpan', () => {
  it('counts columns and minutes from where a block began', () => {
    expect(shiftOf(TUESDAY_TEN, at('2026-11-05', 570, 600), DAYS)).toEqual({ columns: 2, minutes: -30 });
  });

  it('knows an unmoved span', () => {
    expect(sameSpan(TUESDAY_TEN, { ...TUESDAY_TEN })).toBe(true);
    expect(sameSpan(TUESDAY_TEN, at('2026-11-03', 600, 645))).toBe(false);
  });
});
