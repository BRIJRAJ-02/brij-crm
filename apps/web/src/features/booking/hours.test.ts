// A schedule's hours on the screen (spec 0035): the checks the server makes, said on a day's row before anything is
// sent (an end before its start, an overlap, and since AC-961 a time off the quarter hour), and whether a draft
// differs from what is saved, whatever order its date overrides came back in.
import type { BookingAvailability } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { availabilityIsValid, rangesProblem, sameHours, weekRows, withDay } from './hours.ts';
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
