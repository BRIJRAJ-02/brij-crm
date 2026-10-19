// The slot engine alone (spec 0025, AC-624, AC-629): zones with fractional
// offsets, both DST transitions, midnight, month and year ends, Feb 29,
// notice, buffers, overrides, split shifts, busy blocks, the step, the window
// and the daily limit. Ported from an earlier scheduling build's suite.
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { computeSlots, subtractBlocked, type SlotEngineInput, type WeeklyRule } from './engine.ts';

/** Every weekday open between these local minutes. */
const week = (startMinute: number, endMinute: number): WeeklyRule[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute, endMinute }));

type Opts = Partial<SlotEngineInput>;

/** Slots on ONE host zone date, `now` the midnight before so no notice clips it. */
function slotsOn(zone: string, isoDate: string, opts: Opts = {}) {
  const day = DateTime.fromISO(isoDate, { zone });
  const all = computeSlots({
    rules: week(9 * 60, 17 * 60),
    overrides: [],
    busy: [],
    bookings: [],
    durationMinutes: 60,
    bufferBefore: 0,
    bufferAfter: 0,
    hostZone: zone,
    now: day.minus({ days: 1 }).toJSDate(),
    from: day.minus({ days: 1 }).toJSDate(),
    to: day.plus({ days: 2 }).toJSDate(),
    ...opts,
  });
  return all.filter((slot) => DateTime.fromJSDate(slot.start, { zone }).toISODate() === isoDate);
}

const iso = (date: Date) => DateTime.fromJSDate(date).toUTC().toISO({ suppressMilliseconds: true });
const local = (date: Date, zone: string) => DateTime.fromJSDate(date, { zone }).toFormat('HH:mm');
const at = (zone: string, text: string) => DateTime.fromISO(text, { zone }).toJSDate();

describe('offsets: 09:00 local on 2026-06-15', () => {
  it.each([
    ['America/New_York', '2026-06-15T13:00:00Z'],
    ['Europe/London', '2026-06-15T08:00:00Z'],
    ['Asia/Dubai', '2026-06-15T05:00:00Z'],
    ['Asia/Kolkata', '2026-06-15T03:30:00Z'],
    ['Asia/Kathmandu', '2026-06-15T03:15:00Z'],
    ['America/St_Johns', '2026-06-15T11:30:00Z'],
    ['Australia/Lord_Howe', '2026-06-14T22:30:00Z'],
    ['Pacific/Chatham', '2026-06-14T20:15:00Z'],
  ])('%s starts at %s with eight hourly slots', (zone, expected) => {
    const slots = slotsOn(zone, '2026-06-15');
    expect(slots[0] && iso(slots[0].start)).toBe(expected);
    expect(slots).toHaveLength(8);
  });
});

describe('DST: hourly slots across a whole transition day', () => {
  const cases: [string, string, number][] = [
    ['America/New_York', '2027-03-14', 23],
    ['America/New_York', '2027-11-07', 25],
    ['Europe/London', '2027-03-28', 23],
    ['Europe/London', '2027-10-31', 25],
    ['America/St_Johns', '2027-03-14', 23],
    ['Asia/Dubai', '2027-03-14', 24],
    ['Asia/Kathmandu', '2027-03-14', 24],
    ['Australia/Lord_Howe', '2027-04-04', 24],
    ['Australia/Lord_Howe', '2027-10-03', 23],
  ];
  it.each(cases)('%s %s has %i slots, each 60 real minutes, no instant twice', (zone, date, count) => {
    const slots = slotsOn(zone, date, { rules: week(0, 1440) });
    expect(slots).toHaveLength(count);
    expect(slots.every((slot) => slot.end.getTime() - slot.start.getTime() === 3_600_000)).toBe(true);
    expect(new Set(slots.map((slot) => slot.start.getTime())).size).toBe(slots.length);
  });

  it('a block on the spring forward day removes exactly one slot, the rest still 60 real minutes', () => {
    const zone = 'America/New_York';
    const day = '2026-03-08';
    const plain = slotsOn(zone, day);
    const blocked = slotsOn(zone, day, { busy: [{ start: at(zone, `${day}T13:00`), end: at(zone, `${day}T14:00`) }] });
    expect(plain.length - blocked.length).toBe(1);
    expect(blocked.every((slot) => slot.end.getTime() - slot.start.getTime() === 3_600_000)).toBe(true);
  });
});

describe('midnight', () => {
  it('a window ending at 1440 yields slots up to the following midnight, two on the 25 hour day too', () => {
    const zone = 'America/New_York';
    const slots = slotsOn(zone, '2026-06-15', { rules: week(22 * 60, 1440) });
    expect(slots.map((slot) => local(slot.start, zone))).toEqual(['22:00', '23:00']);
    expect(DateTime.fromJSDate(slots[1]?.end ?? new Date(0), { zone }).toISO({ suppressMilliseconds: true })).toBe(
      DateTime.fromISO('2026-06-16T00:00:00', { zone }).toISO({ suppressMilliseconds: true }),
    );
    expect(slotsOn(zone, '2027-11-07', { rules: week(22 * 60, 1440) })).toHaveLength(2);
  });

  it('"any time" offers 24 starts with no seam at midnight', () => {
    const slots = slotsOn('Asia/Kolkata', '2026-09-15', { rules: week(0, 1440) });
    expect(slots).toHaveLength(24);
    expect(local(slots[0]?.start ?? new Date(0), 'Asia/Kolkata')).toBe('00:00');
  });
});

describe('calendar edges', () => {
  const zone = 'Europe/London';
  const spanning = (from: string, days: number) => {
    const start = DateTime.fromISO(from, { zone }).startOf('day');
    return computeSlots({
      rules: week(9 * 60, 10 * 60),
      overrides: [],
      busy: [],
      bookings: [],
      durationMinutes: 60,
      bufferBefore: 0,
      bufferAfter: 0,
      hostZone: zone,
      now: start.toJSDate(),
      from: start.toJSDate(),
      to: start.plus({ days }).toJSDate(),
    }).map((slot) => DateTime.fromJSDate(slot.start, { zone }).toISODate());
  };

  it('crosses month end, the year, and knows Feb 29 only in a leap year', () => {
    expect(spanning('2026-08-30', 3)).toEqual(expect.arrayContaining(['2026-08-31', '2026-09-01']));
    expect(spanning('2026-12-30', 4)).toEqual(expect.arrayContaining(['2026-12-31', '2027-01-01']));
    expect(spanning('2028-02-27', 4)).toContain('2028-02-29');
    expect(spanning('2027-02-27', 4)).not.toContain('2027-02-29');
  });
});

describe('minimum notice', () => {
  const zone = 'America/New_York';
  const from = (hhmm: string, opts: Opts = {}) => {
    const now = DateTime.fromISO(`2026-06-15T${hhmm}:00`, { zone });
    return computeSlots({
      rules: week(9 * 60, 17 * 60),
      overrides: [],
      busy: [],
      bookings: [],
      durationMinutes: 30,
      bufferBefore: 0,
      bufferAfter: 0,
      hostZone: zone,
      now: now.toJSDate(),
      from: now.startOf('day').toJSDate(),
      to: now.startOf('day').plus({ days: 1 }).toJSDate(),
      ...opts,
    }).map((slot) => local(slot.start, zone));
  };

  it('defaults to none: the slot starting now is offered, one already started is not', () => {
    expect(from('09:30')[0]).toBe('09:30');
    expect(from('09:30')).not.toContain('09:00');
    expect(from('08:00')[0]).toBe('09:00');
  });

  it('pushes the first offer past the notice, and a day of notice empties today', () => {
    expect(from('08:31', { minNoticeMinutes: 60 })[0]).toBe('10:00');
    expect(from('08:00', { minNoticeMinutes: 1440 })).toEqual([]);
  });
});

describe('buffers', () => {
  const zone = 'America/New_York';
  const booking = { start: at(zone, '2026-06-15T10:00'), end: at(zone, '2026-06-15T10:30') };

  it('extend what a slot blocks, not what the visitor sees', () => {
    const withBuffers = slotsOn(zone, '2026-06-15', {
      rules: week(9 * 60, 12 * 60),
      durationMinutes: 30,
      bufferBefore: 15,
      bufferAfter: 15,
      bookings: [booking],
    });
    expect(withBuffers.map((slot) => local(slot.start, zone))).toEqual(['09:00', '11:00', '11:30']);
    expect((withBuffers[0]?.end.getTime() ?? 0) - (withBuffers[0]?.start.getTime() ?? 0)).toBe(1_800_000);
    const without = slotsOn(zone, '2026-06-15', {
      rules: week(9 * 60, 12 * 60),
      durationMinutes: 30,
      bookings: [booking],
    });
    expect(without.map((slot) => local(slot.start, zone))).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it("a booking's own blocked range (its buffers) counts, as the exclusion constraint does", () => {
    const blocked = {
      ...booking,
      blockStart: at(zone, '2026-06-15T09:45'),
      blockEnd: at(zone, '2026-06-15T11:15'),
    };
    const slots = slotsOn(zone, '2026-06-15', {
      rules: week(9 * 60, 12 * 60),
      durationMinutes: 30,
      bookings: [blocked],
    });
    expect(slots.map((slot) => local(slot.start, zone))).toEqual(['09:00', '11:30']);
  });
});

describe('overrides and split shifts', () => {
  const zone = 'America/New_York';
  it('a day off closes the day; ranges replace the week, several of them on one date', () => {
    expect(slotsOn(zone, '2026-06-15', { overrides: [{ date: '2026-06-15', windows: [] }] })).toHaveLength(0);
    const narrowed = slotsOn(zone, '2026-06-15', {
      overrides: [{ date: '2026-06-15', windows: [{ startMinute: 13 * 60, endMinute: 15 * 60 }] }],
    });
    expect(narrowed.map((slot) => local(slot.start, zone))).toEqual(['13:00', '14:00']);
    const split = slotsOn(zone, '2026-06-15', {
      overrides: [
        {
          date: '2026-06-15',
          windows: [
            { startMinute: 8 * 60, endMinute: 10 * 60 },
            { startMinute: 14 * 60, endMinute: 16 * 60 },
          ],
        },
      ],
    });
    expect(split.map((slot) => local(slot.start, zone))).toEqual(['08:00', '09:00', '14:00', '15:00']);
    expect(slotsOn(zone, '2026-06-16', { overrides: [{ date: '2026-06-15', windows: [] }] })).toHaveLength(8);
  });

  it('a split shift leaves the break empty; touching ranges join', () => {
    const split = slotsOn(zone, '2026-06-15', { rules: [...week(9 * 60, 12 * 60), ...week(14 * 60, 17 * 60)] });
    expect(split).toHaveLength(6);
    expect(split.map((slot) => local(slot.start, zone))).not.toContain('12:00');
    const joined = slotsOn(zone, '2026-06-15', {
      rules: [...week(9 * 60, 12 * 60 + 30), ...week(12 * 60 + 30, 15 * 60)],
      durationMinutes: 60,
    });
    expect(joined.map((slot) => local(slot.start, zone))).toContain('12:00');
  });
});

describe('busy blocks (what freeBusy returns)', () => {
  const zone = 'Europe/London';
  const day = '2026-06-15';
  const block = (from: string, to: string) => ({ start: at(zone, `${day}T${from}`), end: at(zone, `${day}T${to}`) });

  it('an all day block clears the day; one ending as a slot starts does not block it', () => {
    expect(slotsOn(zone, day, { busy: [block('00:00', '23:59')] })).toHaveLength(0);
    expect(slotsOn(zone, day, { busy: [block('08:00', '09:00')] })).toHaveLength(8);
  });

  it('an hour off the middle keeps the morning and the afternoon', () => {
    const lunch = slotsOn(zone, day, { busy: [block('13:00', '14:00')] }).map((slot) => local(slot.start, zone));
    expect(lunch).toHaveLength(7);
    expect(lunch).not.toContain('13:00');
    expect(lunch).toEqual(expect.arrayContaining(['09:00', '16:00']));
    expect(
      slotsOn(zone, day, { busy: [block('13:30', '14:00')] }).map((slot) => local(slot.start, zone)),
    ).not.toContain('13:00');
    expect(slotsOn(zone, day, { busy: [block('10:00', '11:00'), block('15:00', '16:00')] })).toHaveLength(6);
  });
});

describe('durations, the weekday map and the zone', () => {
  const zone = 'America/New_York';
  it('fits whole slots only', () => {
    expect(slotsOn(zone, '2026-06-15', { rules: week(9 * 60, 9 * 60 + 45), durationMinutes: 30 })).toHaveLength(1);
    expect(slotsOn(zone, '2026-06-15', { rules: week(9 * 60, 10 * 60), durationMinutes: 15 })).toHaveLength(4);
    expect(slotsOn(zone, '2026-06-15', { rules: week(9 * 60, 12 * 60), durationMinutes: 90 })).toHaveLength(2);
  });

  it('dayOfWeek 0 is Sunday and 6 Saturday', () => {
    const sunday = [{ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 10 * 60 }];
    expect(slotsOn(zone, '2026-06-14', { rules: sunday })).toHaveLength(1);
    expect(slotsOn(zone, '2026-06-15', { rules: sunday })).toHaveLength(0);
    expect(slotsOn(zone, '2026-06-20', { rules: [{ dayOfWeek: 6, startMinute: 540, endMinute: 600 }] })).toHaveLength(
      1,
    );
  });

  it('the wall clock holds when the host changes zone, and the instant moves', () => {
    const dubai = slotsOn('Asia/Dubai', '2026-06-15')[0]?.start ?? new Date(0);
    const kolkata = slotsOn('Asia/Kolkata', '2026-06-15')[0]?.start ?? new Date(0);
    expect(local(dubai, 'Asia/Dubai')).toBe('09:00');
    expect(local(kolkata, 'Asia/Kolkata')).toBe('09:00');
    expect(dubai.getTime() - kolkata.getTime()).toBe(90 * 60_000);
  });
});

describe('the slot step', () => {
  const zone = 'Asia/Dubai';
  const day = '2026-09-01';

  it('defaults to the duration, and a finer step offers overlapping starts that still end by closing', () => {
    const venue: Opts = { rules: week(10 * 60, 24 * 60), durationMinutes: 90 };
    expect(slotsOn(zone, day, venue)).toHaveLength(9);
    const fine = slotsOn(zone, day, { ...venue, slotStepMinutes: 15 }).map((slot) => local(slot.start, zone));
    expect(fine).toHaveLength(51);
    expect(fine).toContain('20:00');
    expect(fine.at(-1)).toBe('22:30');
    expect(fine).not.toContain('22:45');
  });

  it('a booking blocks every overlapping start; touching ends do not overlap', () => {
    const open = slotsOn(zone, day, {
      rules: week(10 * 60, 15 * 60),
      durationMinutes: 90,
      slotStepMinutes: 15,
      bookings: [{ start: at(zone, `${day}T12:00`), end: at(zone, `${day}T13:30`) }],
    }).map((slot) => local(slot.start, zone));
    expect(open).toEqual(expect.arrayContaining(['10:00', '10:30', '13:30']));
    expect(open).not.toEqual(expect.arrayContaining(['10:45']));
    expect(open).not.toContain('12:00');
    expect(open).not.toContain('13:15');
  });

  it('zero and negative fall back to the duration; coarser leaves gaps on the hour', () => {
    expect(slotsOn(zone, day, { slotStepMinutes: 0 })).toHaveLength(8);
    expect(slotsOn(zone, day, { slotStepMinutes: -30 })).toHaveLength(8);
    const coarse = slotsOn(zone, day, { durationMinutes: 30, slotStepMinutes: 60 });
    expect(coarse).toHaveLength(8);
    expect(coarse.every((slot) => local(slot.start, zone).endsWith(':00'))).toBe(true);
  });
});

describe('the booking window, the daily limit and the range', () => {
  const zone = 'Europe/London';
  const now = DateTime.fromISO('2026-06-15T00:00', { zone });
  const base: SlotEngineInput = {
    rules: week(9 * 60, 12 * 60),
    overrides: [],
    busy: [],
    bookings: [],
    durationMinutes: 60,
    bufferBefore: 0,
    bufferAfter: 0,
    hostZone: zone,
    now: now.toJSDate(),
    from: now.toJSDate(),
    to: now.plus({ days: 7 }).toJSDate(),
  };
  const dates = (input: SlotEngineInput) => [
    ...new Set(computeSlots(input).map((slot) => DateTime.fromJSDate(slot.start, { zone }).toISODate())),
  ];

  it('nothing starts past now plus the window', () => {
    expect(dates({ ...base, windowDays: 2 })).toEqual(['2026-06-15', '2026-06-16']);
  });

  it('a day at its daily limit offers nothing, the day before it still does', () => {
    const booked = { start: at(zone, '2026-06-16T09:00'), end: at(zone, '2026-06-16T10:00') };
    expect(dates({ ...base, to: now.plus({ days: 2 }).toJSDate(), bookings: [booked], dailyLimit: 1 })).toEqual([
      '2026-06-15',
    ]);
    expect(dates({ ...base, to: now.plus({ days: 2 }).toJSDate(), bookings: [booked], dailyLimit: 2 })).toEqual([
      '2026-06-15',
      '2026-06-16',
    ]);
  });

  it("counts only this page's bookings toward the limit; another page's only blocks its own time", () => {
    const elsewhere = {
      start: at(zone, '2026-06-16T09:00'),
      end: at(zone, '2026-06-16T10:00'),
      countsToLimit: false,
    };
    const input = { ...base, to: now.plus({ days: 2 }).toJSDate(), bookings: [elsewhere], dailyLimit: 1 };
    expect(dates(input)).toEqual(['2026-06-15', '2026-06-16']);
    const tuesday = computeSlots(input).filter(
      (slot) => DateTime.fromJSDate(slot.start, { zone }).toISODate() === '2026-06-16',
    );
    expect(tuesday.map((slot) => local(slot.start, zone))).toEqual(['10:00', '11:00']);
  });

  it('answers only starts inside [from, to)', () => {
    const slots = computeSlots({ ...base, from: at(zone, '2026-06-15T10:00'), to: at(zone, '2026-06-15T11:00') });
    expect(slots.map((slot) => local(slot.start, zone))).toEqual(['10:00']);
  });
});

describe('subtractBlocked', () => {
  it('sweeps sorted blocks once, overlapping ones too, clipped at the floor', () => {
    expect(
      subtractBlocked(
        0,
        100,
        [
          { start: 10, end: 20 },
          { start: 15, end: 30 },
          { start: 90, end: 120 },
        ],
        5,
      ),
    ).toEqual([
      { start: 5, end: 10 },
      { start: 30, end: 90 },
    ]);
  });
});

describe('extra windows: a private page’s holds (spec 0027, AC-707)', () => {
  const zone = 'Europe/London';

  it('opens a span outside the hours, merged with the day and clipped to it', () => {
    const slots = slotsOn(zone, '2026-06-15', {
      extraWindows: [{ start: at(zone, '2026-06-15T17:00'), end: at(zone, '2026-06-15T19:00') }],
    });
    // 09:00 to 17:00 and the hold join into one window, so the last hour is 18:00.
    expect(slots.map((slot) => local(slot.start, zone)).at(-1)).toBe('18:00');
    expect(slots).toHaveLength(10);
  });

  it('still takes busy time and bookings out of a hold', () => {
    const slots = slotsOn(zone, '2026-06-15', {
      rules: [],
      extraWindows: [{ start: at(zone, '2026-06-15T18:00'), end: at(zone, '2026-06-15T21:00') }],
      busy: [{ start: at(zone, '2026-06-15T19:00'), end: at(zone, '2026-06-15T20:00') }],
    });
    expect(slots.map((slot) => local(slot.start, zone))).toEqual(['18:00', '20:00']);
  });
});
