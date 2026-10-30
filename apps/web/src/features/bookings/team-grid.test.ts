import { describe, expect, it } from 'vitest';
import { mergeMinutes, openingMinute } from './team-grid.ts';

const at = (hour: number, minute = 0) => hour * 60 + minute;
const span = (from: number, to: number) => ({ startMinute: from, endMinute: to });

describe('where the Team day opens', () => {
  it('merges touching and overlapping hours into one run', () => {
    expect(mergeMinutes([span(at(11), at(17)), span(at(9), at(12)), span(at(17), at(18))])).toEqual([
      span(at(9), at(18)),
    ]);
  });

  it('opens on now inside the working day, else at the day’s first hour', () => {
    const hours = [span(at(9), at(17)), span(at(10), at(19))];
    expect(openingMinute(hours, at(14, 20))).toBe(at(13));
    expect(openingMinute(hours, at(23))).toBe(at(9));
    expect(openingMinute(hours, undefined)).toBe(at(9));
    expect(openingMinute([], undefined)).toBe(at(8));
  });
});
