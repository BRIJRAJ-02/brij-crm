// Bookings' week helpers: the Monday, the range label, pieces clipped to their
// days, and where the grid opens. Run in the test process's own time zone, so
// every instant is built from local times.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  allDayKeys,
  dayKeyOf,
  isDayKey,
  piecesOf,
  rangeLabel,
  scrollMinute,
  shownWeek,
  weekDays,
  weekOf,
} from './week.ts';

const local = (key: string, hour: number, minute = 0) => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute).toISOString();
};

/** Intl's thin and narrow spaces as plain ones. */
const spaced = (text: string) => text.replace(/[\u2009\u202f]/g, ' ');

describe('the week', () => {
  it('starts on Monday and has seven days', () => {
    expect(weekOf('2026-10-21')).toBe('2026-10-19');
    expect(weekOf('2026-10-19')).toBe('2026-10-19');
    expect(weekOf('2026-10-25')).toBe('2026-10-19');
    expect(weekDays('2026-10-19')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isDayKey('2026-10-19')).toBe(true);
    expect(isDayKey('next week')).toBe(false);
  });

  it('labels a range in one month, across months and across years', () => {
    expect(spaced(rangeLabel('2026-10-12', 'en-GB'))).toBe('12 – 18 October 2026');
    expect(spaced(rangeLabel('2026-09-28', 'en-GB'))).toBe('28 September – 4 October 2026');
    expect(spaced(rangeLabel('2025-12-29', 'en-GB'))).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(spaced(rangeLabel('2026-10-12', 'en-US'))).toBe('October 12 – 18, 2026');
  });

  it('clips a booking to its day, and splits one past midnight', () => {
    const days = weekDays('2026-10-19');
    expect(piecesOf('a', local('2026-10-20', 9, 30), local('2026-10-20', 10), days)).toEqual([
      { id: 'a:2026-10-20', sourceId: 'a', dayKey: '2026-10-20', startMinute: 570, endMinute: 600 },
    ]);
    expect(piecesOf('b', local('2026-10-20', 23), local('2026-10-21', 1), days).map((piece) => piece.dayKey)).toEqual([
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(piecesOf('c', local('2026-10-30', 9), local('2026-10-30', 10), days)).toEqual([]);
  });

  it('opens on the hour before now in the working day, else at the day start, or before an early first booking', () => {
    const days = weekDays('2026-10-19');
    const now = new Date(2026, 9, 21, 15, 20);
    expect(dayKeyOf(now)).toBe('2026-10-21');
    expect(scrollMinute(days, now, [])).toBe(840);
    expect(scrollMinute(days, new Date(2026, 9, 21, 23, 40), [])).toBe(480);
    expect(scrollMinute(days, new Date(2026, 9, 21, 6, 0), [])).toBe(480);
    const later = new Date(2026, 10, 2, 9);
    expect(scrollMinute(days, later, [{ startMinute: 540, endMinute: 660 }])).toBe(480);
    expect(scrollMinute(days, later, [{ startMinute: 420, endMinute: 450 }])).toBe(360);
    expect(scrollMinute(days, later, [])).toBe(480);
    // The member's own day start, on the hour, outside the working day and on another week.
    expect(scrollMinute(days, new Date(2026, 9, 21, 6, 0), [], 9 * 60 + 30)).toBe(540);
    expect(scrollMinute(days, later, [{ startMinute: 425, endMinute: 450 }], 9 * 60)).toBe(360);
  });
});

describe('allDayKeys', () => {
  it('reads an all day event by its dates, the end day left out, never moved into the local zone', () => {
    const days = weekDays('2026-10-19');
    expect(allDayKeys({ startsAt: '2026-10-21T00:00:00.000Z', endsAt: '2026-10-22T00:00:00.000Z' }, days)).toEqual([
      '2026-10-21',
    ]);
    expect(allDayKeys({ startsAt: '2026-10-17T00:00:00.000Z', endsAt: '2026-10-21T00:00:00.000Z' }, days)).toEqual([
      '2026-10-19',
      '2026-10-20',
    ]);
    expect(allDayKeys({ startsAt: '2026-10-25T00:00:00.000Z', endsAt: '2026-10-25T00:00:00.000Z' }, days)).toEqual([
      '2026-10-25',
    ]);
    expect(allDayKeys({ startsAt: '2026-10-26T00:00:00.000Z', endsAt: '2026-10-27T00:00:00.000Z' }, days)).toEqual([]);
  });
});

describe('the week on the small month', () => {
  it('is its first and last day', () => {
    expect(shownWeek(weekDays('2026-10-19'))).toEqual({ shown: { start: '2026-10-19', end: '2026-10-25' } });
  });

  it('is nothing for no days', () => {
    expect(shownWeek([])).toEqual({});
  });
});
