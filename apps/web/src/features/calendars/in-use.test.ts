// Which calendars the app shows: the main one, any switched on, and where bookings go; never the rest.
import { describe, expect, it } from 'vitest';
import { isCalendarInUse, type CalendarUse } from './in-use.ts';

/** A calendar with nothing switched on, as Google lists a subscribed or shared one. */
const unused: CalendarUse = {
  isPrimary: false,
  checkConflicts: false,
  showInWeek: false,
  sync: false,
  isDestination: false,
};

describe('isCalendarInUse', () => {
  it('leaves out a calendar with nothing switched on', () => {
    expect(isCalendarInUse(unused)).toBe(false);
  });

  it('keeps the main calendar, even with every switch off', () => {
    expect(isCalendarInUse({ ...unused, isPrimary: true })).toBe(true);
  });

  it.each(['checkConflicts', 'showInWeek', 'sync'] as const)('keeps a calendar with %s on', (name) => {
    expect(isCalendarInUse({ ...unused, [name]: true })).toBe(true);
  });

  it('keeps where bookings go, when that is the only reason', () => {
    expect(isCalendarInUse({ ...unused, isDestination: true })).toBe(true);
  });
});
