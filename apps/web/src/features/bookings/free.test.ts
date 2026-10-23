// Where New meeting starts (free.ts): the next free half hour of the week on screen, inside the member's hours and
// clear of what holds their time, else the first in the next two weeks (Q72), in the member's zone (Asia/Kolkata here, whatever zone the runner is in).
import type { BookingAvailability, BookingsCalendarView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { busyOf, findFreeSpan, freeSpanIn, lookAheadWeeks, nextFreeSpan, workingRanges } from './free.ts';
import { instantOf } from './span.ts';

/** Monday 19 October 2026, the week the tests look at. */
const WEEK = '2026-10-19';

/** The member's zone in these tests: not the runner's, so nothing leans on the browser's. */
const ZONE = 'Asia/Kolkata';

/** An instant in the member's zone: day, then minutes from midnight. */
const at = (dayKey: string, minute: number) => instantOf(dayKey, minute, ZONE);

/** A span held on a day, in minutes, as the week's read gives it. */
const held = (dayKey: string, start: number, end: number) => ({
  start: at(dayKey, start).getTime(),
  end: at(dayKey, end).getTime(),
});

const NINE_TO_FIVE: BookingAvailability = {
  timeZone: 'UTC',
  weekly: {
    mon: [['09:00', '17:00']],
    tue: [['09:00', '17:00']],
    wed: [['09:00', '12:00']],
    thu: [['09:00', '17:00']],
    fri: [['09:00', '17:00']],
    sat: [],
    sun: [],
  },
  overrides: [{ date: '2026-10-22', ranges: [] }],
};

describe('nextFreeSpan', () => {
  it('starts at the next half hour from now, today, inside the day', () => {
    const now = at('2026-10-20', 10 * 60 + 7);
    expect(nextFreeSpan({ now, week: WEEK, minutes: 30, busy: [], zone: ZONE })).toEqual({
      dayKey: '2026-10-20',
      startMinute: 10 * 60 + 30,
      endMinute: 11 * 60,
    });
  });

  it('steps past whatever holds the time, the whole meeting clear of it', () => {
    const now = at('2026-10-20', 10 * 60);
    const busy = [held('2026-10-20', 10 * 60, 11 * 60), held('2026-10-20', 11 * 60 + 30, 12 * 60)];
    expect(nextFreeSpan({ now, week: WEEK, minutes: 60, busy, zone: ZONE })).toEqual({
      dayKey: '2026-10-20',
      startMinute: 12 * 60,
      endMinute: 13 * 60,
    });
  });

  it('keeps to the member’s hours: a short day, a day off by date, the weekend', () => {
    // Wednesday after its noon close: Thursday is a day off, so Friday at nine.
    const now = at('2026-10-21', 12 * 60 + 15);
    expect(nextFreeSpan({ now, week: WEEK, minutes: 30, busy: [], availability: NINE_TO_FIVE, zone: ZONE })).toEqual({
      dayKey: '2026-10-23',
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
    });
  });

  it('opens a later week at its first working morning', () => {
    const now = at('2026-10-14', 15 * 60);
    expect(nextFreeSpan({ now, week: WEEK, minutes: 30, busy: [], zone: ZONE })).toEqual({
      dayKey: WEEK,
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
    });
  });

  it('falls back to the next half hour from now when the week has no free time left', () => {
    // Saturday afternoon of the week shown, nothing worked at weekends: the next half hour, which the dialog can move.
    const now = at('2026-10-24', 14 * 60 + 40);
    expect(nextFreeSpan({ now, week: WEEK, minutes: 30, busy: [], zone: ZONE })).toEqual({
      dayKey: '2026-10-24',
      startMinute: 15 * 60,
      endMinute: 15 * 60 + 30,
    });
    // Too late in the day for that: tomorrow at nine.
    const late = at('2026-10-24', 23 * 60 + 50);
    expect(nextFreeSpan({ now: late, week: WEEK, minutes: 30, busy: [], zone: ZONE })).toEqual({
      dayKey: '2026-10-25',
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
    });
  });
});

describe('looking ahead when the week on screen has no free time left (Q72)', () => {
  it('starts at the first free half hour of next week, inside the member’s hours, not tonight', () => {
    // Friday at five, the day's hours over: Monday at nine, not 5:30 tonight.
    const now = at('2026-10-23', 17 * 60);
    const laterWeeks = lookAheadWeeks(WEEK, now, ZONE);
    expect(laterWeeks).toEqual(['2026-10-26', '2026-11-02']);
    expect(freeSpanIn({ now, week: WEEK, minutes: 30, busy: [], availability: NINE_TO_FIVE, zone: ZONE })).toBe(
      undefined,
    );
    expect(
      nextFreeSpan({ now, week: WEEK, laterWeeks, minutes: 30, busy: [], availability: NINE_TO_FIVE, zone: ZONE }),
    ).toEqual({ dayKey: '2026-10-26', startMinute: 9 * 60, endMinute: 9 * 60 + 30 });
  });

  it('steps past next week’s busy times, into the week after', () => {
    const now = at('2026-10-23', 17 * 60);
    const laterWeeks = lookAheadWeeks(WEEK, now, ZONE);
    // Next week held from Monday morning to Friday evening: the Monday after at nine.
    const busy = [{ start: at('2026-10-26', 0).getTime(), end: at('2026-10-31', 0).getTime() }];
    expect(nextFreeSpan({ now, week: WEEK, laterWeeks, minutes: 30, busy, zone: ZONE })).toEqual({
      dayKey: '2026-11-02',
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
    });
  });

  it('falls back to the next half hour from now only when two weeks ahead are full too', () => {
    const now = at('2026-10-23', 17 * 60 + 10);
    const laterWeeks = lookAheadWeeks(WEEK, now, ZONE);
    const busy = [{ start: at('2026-10-26', 0).getTime(), end: at('2026-11-09', 0).getTime() }];
    expect(nextFreeSpan({ now, week: WEEK, laterWeeks, minutes: 30, busy, zone: ZONE })).toEqual({
      dayKey: '2026-10-23',
      startMinute: 17 * 60 + 30,
      endMinute: 18 * 60,
    });
  });

  it('looks in this week and the next when the week on screen is long past', () => {
    const now = at('2026-10-21', 10 * 60);
    expect(lookAheadWeeks('2026-08-03', now, ZONE)).toEqual(['2026-10-19', '2026-10-26']);
    // A week starting on Sunday keeps its first day.
    expect(lookAheadWeeks('2026-10-18', now, ZONE)).toEqual(['2026-10-25', '2026-11-01']);
  });
});

describe('findFreeSpan: reading a week at a time (Q72)', () => {
  const FRIDAY_FIVE = at('2026-10-23', 17 * 60);
  const base = { now: FRIDAY_FIVE, week: WEEK, minutes: 30, availability: NINE_TO_FIVE, zone: ZONE };

  it('reads only the week on screen when it has room', async () => {
    const read: string[] = [];
    const span = await findFreeSpan({
      ...base,
      now: at('2026-10-20', 10 * 60),
      busyIn: (week) => {
        read.push(week);
        return Promise.resolve([]);
      },
    });
    expect(span).toEqual({ dayKey: '2026-10-20', startMinute: 10 * 60, endMinute: 10 * 60 + 30 });
    expect(read).toEqual([WEEK]);
  });

  it('reads next week only once this one is full, and the week after only once that one is', async () => {
    const read: string[] = [];
    const fullWeek = (monday: string) => [{ start: at(monday, 0).getTime(), end: at(monday, 7 * 1440).getTime() }];
    const span = await findFreeSpan({
      ...base,
      busyIn: (week) => {
        read.push(week);
        return Promise.resolve(week === '2026-10-26' ? fullWeek(week) : []);
      },
    });
    expect(span).toEqual({ dayKey: '2026-11-02', startMinute: 9 * 60, endMinute: 9 * 60 + 30 });
    expect(read).toEqual([WEEK, '2026-10-26', '2026-11-02']);
  });

  it('ends the look at a week it couldn’t read, then falls back to the next half hour from now', async () => {
    const read: string[] = [];
    const span = await findFreeSpan({
      ...base,
      busyIn: (week) => {
        read.push(week);
        return Promise.resolve(week === WEEK ? [] : undefined);
      },
    });
    expect(span).toEqual({ dayKey: '2026-10-23', startMinute: 17 * 60 + 30, endMinute: 18 * 60 });
    expect(read).toEqual([WEEK, '2026-10-26']);
    // The week on screen unread: never a guess that it is free.
    const unread = await findFreeSpan({
      ...base,
      now: at('2026-10-20', 10 * 60),
      busyIn: () => Promise.resolve(undefined),
    });
    expect(unread).toEqual({ dayKey: '2026-10-20', startMinute: 10 * 60 + 30, endMinute: 11 * 60 });
  });
});

describe('busyOf and workingRanges', () => {
  it('counts confirmed bookings, timed events, busy times and closed time; never a cancelled booking or a day’s event', () => {
    const week = {
      bookings: [
        { status: 'confirmed', startsAt: '2026-10-20T09:00:00.000Z', endsAt: '2026-10-20T09:30:00.000Z' },
        { status: 'cancelled', startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T10:30:00.000Z' },
      ],
      events: [
        { allDay: false, startsAt: '2026-10-20T11:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z' },
        { allDay: true, startsAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-10-21T00:00:00.000Z' },
      ],
      busy: [{ startsAt: '2026-10-20T13:00:00.000Z', endsAt: '2026-10-20T14:00:00.000Z' }],
      blocks: [{ startsAt: '2026-10-20T15:00:00.000Z', endsAt: '2026-10-20T16:00:00.000Z' }],
    } as unknown as BookingsCalendarView;
    expect(busyOf(week).map((span) => new Date(span.start).toISOString())).toEqual([
      '2026-10-20T09:00:00.000Z',
      '2026-10-20T11:00:00.000Z',
      '2026-10-20T13:00:00.000Z',
      '2026-10-20T15:00:00.000Z',
    ]);
    expect(busyOf(undefined)).toEqual([]);
  });

  it('reads the member’s hours, a date’s own hours first, else nine to five on weekdays', () => {
    expect(workingRanges(NINE_TO_FIVE, '2026-10-21')).toEqual([[9 * 60, 12 * 60]]);
    expect(workingRanges(NINE_TO_FIVE, '2026-10-22')).toEqual([]);
    expect(workingRanges(undefined, '2026-10-24')).toEqual([]);
    expect(workingRanges(undefined, '2026-10-23')).toEqual([[9 * 60, 17 * 60]]);
  });
});
