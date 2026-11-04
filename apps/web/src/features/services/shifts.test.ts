// The Shifts grid's pure rules (spec 0066 B1): a date's own change and its way back to the usual week, and copying a
// week to every week, which must set all seven days in the one answer (an earlier roster bug saved only one).
import type { PlaceHours } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { awayOn, copyWeekToAll, minutesOver, mondayOf, rangesOn, weekDates, withDate } from './shifts.ts';

const NINE_TO_FIVE = [{ from: '09:00', to: '17:00' }];
const USUAL: PlaceHours = { weekly: { mon: NINE_TO_FIVE, tue: NINE_TO_FIVE, wed: NINE_TO_FIVE }, exceptions: [] };
const MONDAY = '2027-11-08';

describe('a date of its own', () => {
  it('changes one date only, and goes back to the usual week', () => {
    const late = withDate(USUAL, '2027-11-09', [['12:00', '20:00']]);
    expect(rangesOn(late, '2027-11-09')).toEqual([['12:00', '20:00']]);
    expect(rangesOn(late, '2027-11-16')).toEqual([['09:00', '17:00']]);
    expect(withDate(late, '2027-11-09', 'usual')).toEqual(USUAL);
    // The usual hours typed again are no change at all.
    expect(withDate(late, '2027-11-09', [['09:00', '17:00']]).exceptions).toEqual([]);
    // A day off on a working day is a closed date.
    expect(withDate(USUAL, MONDAY, []).exceptions).toEqual([{ date: MONDAY, closed: true }]);
  });
});

describe('copy this week to all weeks', () => {
  it('sets every one of the seven days in one answer, this week’s changes included', () => {
    const week = withDate(
      withDate(withDate(USUAL, '2027-11-09', [['12:00', '20:00']]), '2027-11-13', [['10:00', '14:00']]),
      MONDAY,
      [],
    );
    const copied = copyWeekToAll(week, MONDAY);
    expect(copied.weekly).toEqual({
      tue: [{ from: '12:00', to: '20:00' }],
      wed: NINE_TO_FIVE,
      sat: [{ from: '10:00', to: '14:00' }],
    });
    expect(copied.exceptions).toEqual([]);
    for (const date of weekDates(MONDAY)) expect(rangesOn(copied, date)).toEqual(rangesOn(week, date));
    // And so the next week reads the same, day by day.
    for (const date of weekDates('2027-11-15'))
      expect(rangesOn(copied, date)).toEqual(
        rangesOn(week, weekDates(MONDAY)[weekDates('2027-11-15').indexOf(date)] ?? ''),
      );
  });

  it('keeps another week’s changes', () => {
    const later = withDate(USUAL, '2027-12-01', []);
    expect(copyWeekToAll(later, MONDAY).exceptions).toEqual([{ date: '2027-12-01', closed: true }]);
  });
});

describe('the week', () => {
  it('finds a week’s Monday and counts its minutes', () => {
    expect(mondayOf('2027-11-14')).toBe(MONDAY);
    expect(minutesOver(USUAL, weekDates(MONDAY))).toBe(3 * 8 * 60);
  });

  it('finds time off on the place’s own wall clock', () => {
    const off = [
      { id: 'a', start: '2027-11-08T23:30:00.000Z', end: '2027-11-09T01:00:00.000Z', reason: 'sick' as const },
    ];
    // 23:30 UTC is already Tuesday in Bengaluru, still Monday in London.
    expect(awayOn(off, MONDAY, 'Asia/Kolkata', 'p')).toBeUndefined();
    expect(awayOn(off, MONDAY, 'Europe/London', 'p')).toBeDefined();
  });
});
