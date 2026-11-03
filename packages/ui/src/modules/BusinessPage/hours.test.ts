// The business page's hours in words (spec 0066, AC-6641): open now and until when, when it opens next, and the
// week's rows with today marked, all on the place's own clock.
import { describe, expect, it } from 'vitest';
import { openStatus, weekRows, zoneCity } from './hours.ts';

const HOURS = {
  weekly: {
    mon: [{ from: '12:00', to: '23:00' }],
    thu: [
      { from: '12:00', to: '15:30' },
      { from: '18:00', to: '23:30' },
    ],
    fri: [{ from: '18:00', to: '02:00' }],
  },
  exceptions: [{ date: '2026-10-12', closed: true }],
};
// Thursday 8 October 2026, 14:30 in London (13:30 UTC).
const THURSDAY = Date.parse('2026-10-08T13:30:00Z');

describe('openStatus', () => {
  it('is open in a range, saying when it closes', () => {
    expect(openStatus(HOURS, THURSDAY, 'Europe/London', 'en-GB')).toEqual({
      isOpen: true,
      state: 'Open now',
      detail: 'Closes at 15:30',
    });
  });

  it('between ranges, opens again today; late at night, tomorrow; else on its day', () => {
    const between = Date.parse('2026-10-08T15:00:00Z');
    expect(openStatus(HOURS, between, 'Europe/London', 'en-GB').detail).toBe('Opens at 18:00');
    const lateThursday = Date.parse('2026-10-08T22:40:00Z');
    expect(openStatus(HOURS, lateThursday, 'Europe/London', 'en-GB').detail).toBe('Opens tomorrow at 18:00');
    // Saturday: Friday's range ran to 02:00; Monday the 12th is closed, so next is Thursday the 15th.
    const saturday = Date.parse('2026-10-10T12:00:00Z');
    expect(openStatus(HOURS, saturday, 'Europe/London', 'en-GB').detail).toBe('Opens Thursday at 12:00');
  });

  it('reads past midnight on Friday’s range, and says closed with nothing in two weeks', () => {
    const fridayNight = Date.parse('2026-10-10T00:30:00Z');
    expect(openStatus(HOURS, fridayNight, 'Europe/London', 'en-GB').isOpen).toBe(true);
    expect(openStatus({ weekly: {}, exceptions: [] }, THURSDAY, 'Europe/London', 'en-GB')).toEqual({
      isOpen: false,
      state: 'Closed',
    });
  });
});

describe('weekRows', () => {
  it('lists Monday to Sunday with today marked and its ranges', () => {
    const rows = weekRows(HOURS, THURSDAY, 'Europe/London', 'en-GB');
    expect(rows.map((row) => row.name)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(rows.find((row) => row.isToday)).toEqual({
      day: 'thu',
      name: 'Thursday',
      ranges: ['12:00 – 15:30', '18:00 – 23:30'],
      isToday: true,
    });
    expect(rows.find((row) => row.day === 'tue')?.ranges).toEqual([]);
  });

  it('reads today on the place’s clock, and today’s exception', () => {
    // Monday 12 October, closed by its exception, 09:00 in Bengaluru.
    const monday = Date.parse('2026-10-12T03:30:00Z');
    const today = weekRows(HOURS, monday, 'Asia/Kolkata', 'en-GB').find((row) => row.isToday);
    expect(today).toMatchObject({ day: 'mon', ranges: [] });
  });
});

describe('zoneCity', () => {
  it('names a zone by its city', () => {
    expect(zoneCity('Asia/Kolkata')).toBe('Kolkata');
    expect(zoneCity('America/New_York')).toBe('New York');
  });
});
