import type { PlaceHours } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { calendarStart } from './day-hours.ts';

// Lunch from 11:30 on Tuesdays and dinner only on Wednesdays; one Tuesday opens at 8:00 for a breakfast, another
// is closed.
const HOURS: PlaceHours = {
  weekly: {
    tue: [
      { from: '11:30', to: '15:00', name: 'Lunch' },
      { from: '18:00', to: '23:00', name: 'Dinner' },
    ],
    wed: [{ from: '18:00', to: '02:00' }],
  },
  exceptions: [
    { date: '2026-11-17', ranges: [{ from: '08:00', to: '11:00' }] },
    { date: '2026-11-24', closed: true },
  ],
};

describe('calendarStart (checklabs’ day calendar from 10:00)', () => {
  it('starts at 10:00 when the day’s first service starts later', () => {
    // Wednesday 11 November 2026: dinner only; Tuesday 10 November: lunch from 11:30.
    expect(calendarStart(HOURS, '2026-11-11', [])).toBe(10 * 60);
    expect(calendarStart(HOURS, '2026-11-10', [])).toBe(10 * 60);
  });

  it('starts on the hour of an earlier first service, a dated exception’s first', () => {
    expect(calendarStart(HOURS, '2026-11-17', [])).toBe(8 * 60);
  });

  it('starts early enough for a booking before the hours, and keeps 10:00 on a closed day', () => {
    expect(calendarStart(HOURS, '2026-11-11', [9 * 60 + 45])).toBe(9 * 60);
    expect(calendarStart(HOURS, '2026-11-24', [])).toBe(10 * 60);
  });
});
