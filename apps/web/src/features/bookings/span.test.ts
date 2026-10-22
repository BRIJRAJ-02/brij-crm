// The member's open hours for shading the week: by date override first, else the weekday, and only in the zone the
// week is drawn in.
import type { BookingAvailability } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { openHoursOf } from './span.ts';

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
