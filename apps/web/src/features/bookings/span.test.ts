// The member's open hours for shading the week: by date override first, else the weekday, and only in the zone the
// week is drawn in.
import type { BookingAvailability } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { instantOf, openHoursOf, spanNames } from './span.ts';

const hours: BookingAvailability = {
  timeZone: 'Europe/London',
  weekly: {
    mon: [['09:00', '17:00']],
    tue: [
      ['09:00', '12:00'],
      ['13:00', '17:30'],
    ],
    wed: [['09:00', '17:00']],
    thu: [['09:00', '17:00']],
    fri: [['09:00', '17:00']],
    sat: [],
    sun: [],
  },
  overrides: [{ date: '2026-10-21', ranges: [] }],
};

describe('openHoursOf', () => {
  it('reads the weekday, an override first, and nothing in another zone or unknown', () => {
    expect(openHoursOf(hours, '2026-10-20', 'Europe/London')).toEqual([
      { startMinute: 540, endMinute: 720 },
      { startMinute: 780, endMinute: 1050 },
    ]);
    expect(openHoursOf(hours, '2026-10-21', 'Europe/London')).toEqual([]);
    expect(openHoursOf(hours, '2026-10-24', 'Europe/London')).toEqual([]);
    expect(openHoursOf(hours, '2026-10-20', 'Asia/Kolkata')).toBeUndefined();
    // Another name for the same clock still shades.
    expect(openHoursOf({ ...hours, timeZone: 'Asia/Kolkata' }, '2026-10-20', 'Asia/Calcutta')).toHaveLength(2);
    expect(openHoursOf(undefined, '2026-10-20', 'Europe/London')).toBeUndefined();
  });
});

describe('a drawn span in the member zone', () => {
  it('is the instant on the member’s clock, and named on it', () => {
    const span = { dayKey: '2026-10-21', startMinute: 5 * 60, endMinute: 6 * 60 };
    expect(instantOf(span.dayKey, span.startMinute, 'Asia/Kolkata').toISOString()).toBe('2026-10-20T23:30:00.000Z');
    expect(spanNames(span, 'en-GB', 'Asia/Kolkata').title.replace(/[\u2009\u202f]/g, ' ')).toBe('5:00 – 6:00');
    expect(spanNames(span, 'en-GB', 'Asia/Kolkata').meta).toMatch(/^Wednesday 21 October/);
  });
});
