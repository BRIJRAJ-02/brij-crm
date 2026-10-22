// Bookings' week helpers: the Monday, the range label, pieces clipped to their
// days, and where the grid opens, all in the member's zone. Every instant is
// built for a named zone (Asia/Kolkata, UTC+5:30, unless a test says), never
// the runner's, so they hold whatever zone CI runs in (UTC).
import { describe, expect, it } from 'vitest';
import {
  addDays,
  allDayKeys,
  bookingPieces,
  dayKeyOf,
  instantAt,
  isDayKey,
  midnightIn,
  minuteOfDay,
  piecesOf,
  rangeLabel,
  scrollMinute,
  timeRange,
  weekDays,
  weekOf,
  weekRange,
} from './week.ts';
import type { BookingListItem } from '@crm/data';

/** The member's zone in these tests: half an hour off the hour, and never the runner's. */
const ZONE = 'Asia/Kolkata';

/** Kolkata's clock as an instant (it keeps UTC+5:30 all year). */
const local = (key: string, hour: number, minute = 0) => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000).toISOString();
};
/** The same, as a Date. */
const localDate = (key: string, hour: number, minute = 0) => new Date(local(key, hour, minute));

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
    expect(piecesOf('a', local('2026-10-20', 9, 30), local('2026-10-20', 10), days, ZONE)).toEqual([
      { id: 'a:2026-10-20', sourceId: 'a', dayKey: '2026-10-20', startMinute: 570, endMinute: 600 },
    ]);
    expect(
      piecesOf('b', local('2026-10-20', 23), local('2026-10-21', 1), days, ZONE).map((piece) => piece.dayKey),
    ).toEqual(['2026-10-20', '2026-10-21']);
    expect(piecesOf('c', local('2026-10-30', 9), local('2026-10-30', 10), days, ZONE)).toEqual([]);
  });

  it('opens on the hour before now in the working day, else at the day start, or before an early first booking', () => {
    const days = weekDays('2026-10-19');
    const now = localDate('2026-10-21', 15, 20);
    expect(dayKeyOf(now, ZONE)).toBe('2026-10-21');
    expect(scrollMinute(days, now, ZONE, [])).toBe(840);
    expect(scrollMinute(days, localDate('2026-10-21', 23, 40), ZONE, [])).toBe(480);
    expect(scrollMinute(days, localDate('2026-10-21', 6, 0), ZONE, [])).toBe(480);
    const later = localDate('2026-11-02', 9);
    expect(scrollMinute(days, later, ZONE, [{ startMinute: 540, endMinute: 660 }])).toBe(480);
    expect(scrollMinute(days, later, ZONE, [{ startMinute: 420, endMinute: 450 }])).toBe(360);
    expect(scrollMinute(days, later, ZONE, [])).toBe(480);
    // The member's own day start, on the hour, outside the working day and on another week.
    expect(scrollMinute(days, localDate('2026-10-21', 6, 0), ZONE, [], 9 * 60 + 30)).toBe(540);
    expect(scrollMinute(days, later, ZONE, [{ startMinute: 425, endMinute: 450 }], 9 * 60)).toBe(360);
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

describe('the member zone', () => {
  // 23:30 UTC on Tuesday 20 October is 05:00 on Wednesday 21 October in Kolkata, and 16:30 on the Tuesday in
  // Los Angeles: the week reads it on the member's clock, never the runner's.
  const startsAt = '2026-10-20T23:30:00.000Z';
  const endsAt = '2026-10-21T00:30:00.000Z';
  const days = weekDays('2026-10-19');

  it('puts an event at 23:30 UTC on the right day and hour for a member in Asia/Kolkata', () => {
    expect(dayKeyOf(new Date(startsAt), ZONE)).toBe('2026-10-21');
    expect(minuteOfDay(new Date(startsAt), ZONE)).toBe(5 * 60);
    expect(piecesOf('e', startsAt, endsAt, days, ZONE)).toEqual([
      { id: 'e:2026-10-21', sourceId: 'e', dayKey: '2026-10-21', startMinute: 300, endMinute: 360 },
    ]);
    const booking = { id: 'b', startsAt, endsAt } as BookingListItem;
    expect(bookingPieces([booking], days, ZONE).map((piece) => piece.dayKey)).toEqual(['2026-10-21']);
  });

  it('puts the same event on the day before, in the afternoon, for a member in Los Angeles', () => {
    expect(piecesOf('e', startsAt, endsAt, days, 'America/Los_Angeles')).toEqual([
      { id: 'e:2026-10-20', sourceId: 'e', dayKey: '2026-10-20', startMinute: 990, endMinute: 1050 },
    ]);
  });

  it('reads the week from its first midnight in the zone to the next week’s', () => {
    expect(weekRange('2026-10-19', ZONE)).toEqual({
      from: '2026-10-18T18:30:00.000Z',
      to: '2026-10-25T18:30:00.000Z',
    });
    expect(weekRange('2026-10-19', 'UTC')).toEqual({
      from: '2026-10-19T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
    });
  });

  it('names times on the zone’s clock', () => {
    expect(timeRange(startsAt, endsAt, 'en-GB', ZONE)).toBe('5:00 – 6:00');
    expect(timeRange(startsAt, endsAt, 'en-GB', 'UTC')).toBe('23:30 – 0:30');
  });

  it('turns a day and minute back into the instant, the inverse of the grid', () => {
    expect(instantAt('2026-10-21', 300, ZONE).toISOString()).toBe(startsAt);
    expect(instantAt('2026-10-21', 1440, ZONE).toISOString()).toBe('2026-10-21T18:30:00.000Z');
    expect(midnightIn('2026-10-21', ZONE).toISOString()).toBe('2026-10-20T18:30:00.000Z');
  });

  it('keeps the clock’s hours on a day daylight saving changes', () => {
    // London goes back an hour at 02:00 BST on Sunday 25 October 2026 (01:00 UTC).
    const london = 'Europe/London';
    expect(midnightIn('2026-10-25', london).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    // 10:00 to 11:00 on the clock (GMT by then) sits at 10:00 on the grid, not an hour late.
    expect(
      piecesOf('d', '2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z', weekDays('2026-10-19'), london),
    ).toEqual([{ id: 'd:2026-10-25', sourceId: 'd', dayKey: '2026-10-25', startMinute: 600, endMinute: 660 }]);
    expect(instantAt('2026-10-25', 600, london).toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(minuteOfDay(new Date('2026-10-25T10:00:00.000Z'), london)).toBe(600);
    // Across the repeated hour (01:30 BST to 01:30 GMT) the piece keeps its hour.
    expect(
      piecesOf('r', '2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z', weekDays('2026-10-19'), london),
    ).toEqual([{ id: 'r:2026-10-25', sourceId: 'r', dayKey: '2026-10-25', startMinute: 90, endMinute: 150 }]);
  });
});
