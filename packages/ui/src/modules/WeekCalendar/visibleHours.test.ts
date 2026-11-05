import { describe, expect, it } from 'vitest';
import { isOnHours, visibleHours, WHOLE_DAY } from './visibleHours.ts';

const range = (from: number, to: number) => ({ startMinute: from * 60, endMinute: to * 60 });

describe('visibleHours', () => {
  it('draws the working day with an hour either side', () => {
    const weekday = [range(9, 17)];
    expect(visibleHours([weekday, weekday, weekday, weekday, weekday, [], []], [])).toEqual({ from: 8, to: 18 });
  });

  it('takes the earliest start and the latest end across the days shown', () => {
    expect(visibleHours([[range(10, 14)], [range(8, 12), range(13, 19)]], [])).toEqual({ from: 7, to: 20 });
  });

  it('widens to take in a block outside the working day', () => {
    expect(visibleHours([[range(9, 17)]], [{ startMinute: 20 * 60 + 30, endMinute: 21 * 60 }])).toEqual({
      from: 8,
      to: 22,
    });
  });

  it('draws the whole day when no working hours are known', () => {
    expect(visibleHours([undefined, undefined], [range(10, 11)])).toEqual(WHOLE_DAY);
    expect(visibleHours([[], []], [])).toEqual(WHOLE_DAY);
  });

  it('never runs past midnight', () => {
    expect(visibleHours([[{ startMinute: 0, endMinute: 1440 }]], [])).toEqual(WHOLE_DAY);
    expect(visibleHours([[range(18, 24)]], [])).toEqual({ from: 16, to: 24 });
  });

  it('draws a short working day as at least eight hours', () => {
    const hours = visibleHours([[range(10, 12)]], []);
    expect(hours.to - hours.from).toBe(8);
    expect(hours.from).toBeLessThanOrEqual(9);
    expect(hours.to).toBeGreaterThanOrEqual(13);
  });

  it('rounds a half hour out to the whole hour', () => {
    expect(visibleHours([[{ startMinute: 9 * 60 + 30, endMinute: 17 * 60 + 30 }]], [])).toEqual({ from: 8, to: 19 });
  });
});

describe('isOnHours', () => {
  it('holds a minute between the first and the last hour drawn', () => {
    expect(isOnHours(8 * 60, { from: 8, to: 18 })).toBe(true);
    expect(isOnHours(18 * 60, { from: 8, to: 18 })).toBe(true);
    expect(isOnHours(7 * 60 + 59, { from: 8, to: 18 })).toBe(false);
  });
});
