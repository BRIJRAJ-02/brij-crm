// A schedule's hours on the screen (spec 0035): the checks the server makes, said on a day's row before anything is
// sent (an end before its start, an overlap, and since AC-961 a time off the quarter hour), and whether a draft
// differs from what is saved, whatever order its date overrides came back in.
import type { BookingAvailability } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  availabilityIsValid,
  awayOf,
  datesBetween,
  hoursLessAway,
  rangesProblem,
  sameHours,
  upcomingOverrides,
  weekGroups,
  weeklyOn,
  weekRows,
  withDay,
  withHoursAway,
  withOverride,
} from './hours.ts';
import { strings } from './strings.ts';

const hours: BookingAvailability = {
  timeZone: 'America/New_York',
  weekly: { mon: [['09:00', '17:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  overrides: [
    { date: '2026-11-03', ranges: [] },
    { date: '2026-11-04', ranges: [['13:00', '14:00']], note: 'Dentist' },
  ],
};

describe('a schedule’s hours', () => {
  it('says what is wrong with a day: an end before its start, an overlap, a time off the quarter hour', () => {
    expect(rangesProblem([['09:00', '17:00']])).toBeUndefined();
    expect(rangesProblem([['09:15', '09:45']])).toBeUndefined();
    expect(rangesProblem([['10:00', '09:00']])).toBe(strings.endBeforeStart);
    expect(
      rangesProblem([
        ['09:00', '12:00'],
        ['11:00', '13:00'],
      ]),
    ).toBe(strings.overlap);
    expect(rangesProblem([['09:10', '10:00']])).toBe(strings.quarterHour);
    expect(rangesProblem([['00:00', '24:00']])).toBeUndefined();
  });

  it('holds the save back while any day or date override is wrong, and says so on that day', () => {
    expect(availabilityIsValid(hours)).toBe(true);
    const offStep = withDay(hours, 'tue', [['08:05', '09:00']]);
    expect(availabilityIsValid(offStep)).toBe(false);
    expect(weekRows(offStep).find((row) => row.id === 'tue')).toMatchObject({ error: strings.quarterHour });
    expect(availabilityIsValid({ ...hours, overrides: [{ date: '2026-11-05', ranges: [['14:00', '13:00']] }] })).toBe(
      false,
    );
  });

  it('calls hours the same whatever order the date overrides came back in, and different on any change', () => {
    const reordered: BookingAvailability = { ...hours, overrides: [...hours.overrides].reverse() };
    expect(sameHours(hours, reordered)).toBe(true);
    expect(sameHours(hours, { ...hours, timeZone: 'Asia/Kolkata' })).toBe(false);
    expect(sameHours(hours, withDay(hours, 'mon', [['09:00', '16:30']]))).toBe(false);
    expect(sameHours(hours, { ...hours, overrides: hours.overrides.slice(1) })).toBe(false);
    expect(
      sameHours(hours, {
        ...hours,
        overrides: hours.overrides.map((override) => ({ ...override, note: 'Another' })),
      }),
    ).toBe(false);
  });
});

describe('weekGroups', () => {
  it('groups days in a row with the same hours, Calendly style', () => {
    const nine = [['09:00', '17:00']] as const;
    const availability = {
      timeZone: 'Asia/Kolkata',
      weekly: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: [], sun: [] },
      overrides: [],
    } as unknown as BookingAvailability;
    expect(weekGroups(availability, 'en-US')).toEqual([
      { days: 'Mon to Fri', hours: '9:00 AM to 5:00 PM' },
      { days: 'Sat, Sun', hours: 'Unavailable' },
    ]);
  });
});

describe('time off for some hours (Availability, 10 November 2026)', () => {
  const week: BookingAvailability = {
    timeZone: 'Asia/Kolkata',
    weekly: { mon: [], tue: [], wed: [], thu: [], fri: [['09:00', '18:00']], sat: [], sun: [] },
    overrides: [],
  };

  it('takes the hours away out of the day, in pieces, and all of it is a day off', () => {
    expect(hoursLessAway([['09:00', '18:00']], [['14:00', '16:00']])).toEqual([
      ['09:00', '14:00'],
      ['16:00', '18:00'],
    ]);
    expect(hoursLessAway([['09:00', '18:00']], [['08:00', '19:00']])).toEqual([]);
    expect(hoursLessAway([['09:00', '12:00']], [['13:00', '14:00']])).toEqual([['09:00', '12:00']]);
  });

  it('reads a date’s own hours back as time away, and hours it adds as extra', () => {
    expect(awayOf([['09:00', '18:00']], [['09:00', '14:00']])).toEqual({ away: [['14:00', '18:00']], extra: [] });
    expect(awayOf([['09:00', '18:00']], [])).toEqual({ away: [['09:00', '18:00']], extra: [] });
    expect(awayOf([['09:00', '12:00']], [['09:00', '20:00']]).extra).toEqual([['12:00', '20:00']]);
  });

  it('saves some hours away on each working date of a run, with the note, and skips a date with no hours', () => {
    // Friday 13 November 2026 works 9 to 6; Saturday doesn't.
    const next = withHoursAway(week, datesBetween('2026-11-13', '2026-11-14'), [['14:00', '18:00']], ' Dentist ');
    expect(next.overrides).toEqual([{ date: '2026-11-13', ranges: [['09:00', '14:00']], note: 'Dentist' }]);
    // Edited again, it reads the usual week, not the hours it already had.
    const edited = withHoursAway(next, ['2026-11-13'], [['09:00', '10:00']], '', '2026-11-13');
    expect(edited.overrides).toEqual([{ date: '2026-11-13', ranges: [['10:00', '18:00']] }]);
  });

  it('puts a date back as it was for an Undo, and lists dates from today on', () => {
    const next = withHoursAway(week, ['2026-11-13'], [['14:00', '18:00']], '');
    expect(withOverride(next, '2026-11-13', undefined).overrides).toEqual([]);
    const was = next.overrides[0];
    expect(withOverride(week, '2026-11-13', was).overrides).toEqual(next.overrides);
    expect(upcomingOverrides(next, '2026-11-14')).toEqual([]);
    expect(upcomingOverrides(next, '2026-11-13')).toHaveLength(1);
    expect(weeklyOn(week, '2026-11-13')).toEqual([['09:00', '18:00']]);
  });
});
