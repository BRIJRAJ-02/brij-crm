// A place's hours read at an instant (spec 0065, AC-6508): ranges that cross midnight belong to the day they start
// on, exceptions replace only that date's ranges, and clock changes never move an opening time.
import { hoursProblem, type PlaceHoursShape } from '@crm/contracts/hospitality';
import { describe, expect, it } from 'vitest';
import { nextOpening, openAt, rangesOn, wallToInstant, weekDayOf } from './hours.ts';

const LONDON = 'Europe/London';

const HOURS: PlaceHoursShape = {
  weekly: {
    mon: [],
    tue: [
      { from: '12:00', to: '15:00', name: 'Lunch' },
      { from: '18:00', to: '23:00', name: 'Dinner' },
    ],
    fri: [{ from: '18:00', to: '02:00' }],
    sat: [{ from: '10:00', to: '16:00' }],
    sun: [{ from: '01:00', to: '04:00' }],
  },
  exceptions: [
    { date: '2026-12-25', closed: true, note: 'Christmas' },
    { date: '2026-12-26', ranges: [{ from: '19:00', to: '22:00' }], note: 'Private event' },
  ],
};

const at = (iso: string) => new Date(iso);

describe('rangesOn', () => {
  it('reads the weekly pattern by weekday, and an exception in its place', () => {
    expect(weekDayOf('2026-11-03')).toBe('tue');
    expect(rangesOn(HOURS, '2026-11-03').map((range) => range.name)).toEqual(['Lunch', 'Dinner']);
    expect(rangesOn(HOURS, '2026-11-02')).toEqual([]);
    expect(rangesOn(HOURS, '2026-12-25')).toEqual([]);
    expect(rangesOn(HOURS, '2026-12-26')).toEqual([{ from: '19:00', to: '22:00' }]);
  });
});

describe('openAt', () => {
  it('is open inside a range and closed between ranges', () => {
    // 3 Nov 2026 is GMT in London.
    expect(openAt(HOURS, at('2026-11-03T13:00:00Z'), LONDON)).toMatchObject({ open: true, since: '2026-11-03' });
    expect(openAt(HOURS, at('2026-11-03T16:00:00Z'), LONDON).open).toBe(false);
    expect(openAt(HOURS, at('2026-11-03T15:00:00Z'), LONDON).open).toBe(false);
  });

  it('keeps Friday’s late range open past midnight into Saturday, as Friday’s', () => {
    const late = openAt(HOURS, at('2026-11-07T01:30:00Z'), LONDON);
    expect(late).toMatchObject({ open: true, since: '2026-11-06' });
    expect(late.closesAt?.toISOString()).toBe('2026-11-07T02:00:00.000Z');
    expect(openAt(HOURS, at('2026-11-07T02:00:00Z'), LONDON).open).toBe(false);
  });

  it('reads the wall clock in the place’s own zone', () => {
    // 18:30 in London is 13:30 in New York: Tuesday dinner there, not lunch.
    expect(openAt(HOURS, at('2026-11-03T18:30:00Z'), LONDON).range?.name).toBe('Dinner');
    expect(openAt(HOURS, at('2026-11-03T18:30:00Z'), 'America/New_York').range?.name).toBe('Lunch');
  });

  it('keeps opening times on the wall clock across both clock changes', () => {
    // 28 Mar 2026 is Saturday, GMT; 4 Apr is Saturday, BST: 10:00 opens at 10:00Z, then 09:00Z.
    expect(openAt(HOURS, at('2026-03-28T10:00:00Z'), LONDON).open).toBe(true);
    expect(openAt(HOURS, at('2026-04-04T09:00:00Z'), LONDON).open).toBe(true);
    expect(openAt(HOURS, at('2026-04-04T15:30:00Z'), LONDON).open).toBe(false);
  });
});

describe('nextOpening', () => {
  it('finds the next range, skipping a closed day and an exception', () => {
    // Monday 2 Nov, 10:00 London: Monday is closed, so Tuesday's lunch.
    expect(nextOpening(HOURS, at('2026-11-02T10:00:00Z'), LONDON)).toMatchObject({
      at: at('2026-11-03T12:00:00Z'),
      date: '2026-11-03',
    });
    // Between lunch and dinner on Tuesday: dinner.
    expect(nextOpening(HOURS, at('2026-11-03T16:00:00Z'), LONDON)?.range.name).toBe('Dinner');
    // Christmas Day is closed; Boxing Day opens late.
    expect(nextOpening(HOURS, at('2026-12-24T23:30:00Z'), LONDON)?.at).toEqual(at('2026-12-26T19:00:00Z'));
  });

  it('answers nothing for a place with no hours', () => {
    expect(nextOpening({ weekly: {}, exceptions: [] }, at('2026-11-03T12:00:00Z'), LONDON)).toBeUndefined();
  });
});

describe('wallToInstant across clock changes', () => {
  it('reads a time the spring change skips forward, and one the autumn change repeats as its first', () => {
    // 29 Mar 2026, 01:30 does not exist in London: it reads as 02:30 BST, 01:30Z.
    expect(wallToInstant('2026-03-29', 90, LONDON).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 25 Oct 2026, 01:30 happens twice: the first is 01:30 BST, 00:30Z.
    expect(wallToInstant('2026-10-25', 90, LONDON).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    // Past midnight: Friday's 02:00 close is Saturday 02:00.
    expect(wallToInstant('2026-11-06', 26 * 60, LONDON).toISOString()).toBe('2026-11-07T02:00:00.000Z');
  });

  it('keeps Sunday’s 01:00 to 04:00 the same three wall hours on the spring change night, two real ones', () => {
    const opens = wallToInstant('2026-03-29', 60, LONDON);
    const closes = wallToInstant('2026-03-29', 240, LONDON);
    expect(opens.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(closes.toISOString()).toBe('2026-03-29T03:00:00.000Z');
  });
});

describe('hoursProblem', () => {
  it('takes the example hours', () => {
    expect(hoursProblem(HOURS)).toBeUndefined();
  });

  it('refuses overlaps, a fourth range, a crossing range that is not last, and a late range into the next day', () => {
    expect(
      hoursProblem({
        weekly: {
          mon: [
            { from: '12:00', to: '15:00' },
            { from: '14:00', to: '16:00' },
          ],
        },
        exceptions: [],
      }),
    ).toMatch(/overlap/);
    expect(
      hoursProblem({
        weekly: {
          mon: [
            { from: '08:00', to: '09:00' },
            { from: '10:00', to: '11:00' },
            { from: '12:00', to: '13:00' },
            { from: '14:00', to: '15:00' },
          ],
        },
        exceptions: [],
      }),
    ).toMatch(/up to 3/);
    expect(
      hoursProblem({
        weekly: {
          mon: [
            { from: '22:00', to: '01:00' },
            { from: '23:30', to: '23:45' },
          ],
        },
        exceptions: [],
      }),
    ).toBeDefined();
    expect(
      hoursProblem({
        weekly: { mon: [{ from: '18:00', to: '03:00' }], tue: [{ from: '02:00', to: '05:00' }] },
        exceptions: [],
      }),
    ).toMatch(/next day/);
    expect(
      hoursProblem({
        weekly: { sun: [{ from: '18:00', to: '02:00' }], mon: [{ from: '02:00', to: '05:00' }] },
        exceptions: [],
      }),
    ).toBeUndefined();
  });

  it('refuses a special day twice, or one both closed and open', () => {
    expect(
      hoursProblem({
        weekly: {},
        exceptions: [
          { date: '2026-12-25', closed: true },
          { date: '2026-12-25', closed: true },
        ],
      }),
    ).toMatch(/only one/);
    expect(
      hoursProblem({
        weekly: {},
        exceptions: [{ date: '2026-12-25', closed: true, ranges: [{ from: '10:00', to: '11:00' }] }],
      }),
    ).toMatch(/either closed/);
  });
});
