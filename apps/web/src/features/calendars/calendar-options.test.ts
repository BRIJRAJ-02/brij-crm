// The calendar pickers' options: only calendars in use, plus the one already chosen there.
import type { CalendarItem } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { calendarOptions } from './calendar-options.ts';

/** A writable calendar with nothing switched on, changed by `more`. */
const calendar = (id: string, name: string, more: Partial<CalendarItem> = {}): CalendarItem => ({
  id,
  connectionId: 'c1',
  name,
  hue: 'blue',
  accessRole: 'owner',
  isPrimary: false,
  checkConflicts: false,
  showInWeek: false,
  sync: false,
  isDestination: false,
  canBeDestination: true,
  ...more,
});

const accounts = [
  {
    accountEmail: 'ada@acme.dev',
    calendars: [
      calendar('work', 'Work', { isPrimary: true, isDestination: true }),
      calendar('team', 'Team', { checkConflicts: true }),
      calendar('shared', 'Shared', { accessRole: 'writer' }),
    ],
  },
];

const labels = (items: readonly { readonly label: string }[]) => items.map((item) => item.label);

describe('calendarOptions', () => {
  it('lists only the calendars in use', () => {
    expect(labels(calendarOptions({ accounts }))).toEqual(['Work', 'Team']);
  });

  it('lists the chosen calendar too, even when it isn’t in use', () => {
    expect(labels(calendarOptions({ accounts, chosen: 'shared' }))).toEqual(['Work', 'Team', 'Shared']);
  });

  it('applies include within the calendars in use', () => {
    expect(labels(calendarOptions({ accounts, include: (each) => each.checkConflicts }))).toEqual(['Team']);
  });
});
