// The member's calendars as Select options, built in one place so every calendar picker lists them the same way:
// a booking page's "Add bookings to" (its editor) and the default in Settings › Calendars.
import type { CalendarAccountView, CalendarItem } from '@crm/data';
import type { SelectItem } from '@crm/ui';
import { isCalendarInUse } from './in-use.ts';

/** What to list, and what to put first. */
export interface CalendarOptionsInput {
  /** The member's accounts, each with its calendars, in the order Settings lists them. */
  readonly accounts: readonly Pick<CalendarAccountView, 'accountEmail' | 'calendars'>[];
  /** Options before the calendars, ungrouped (a page's "Default (ada@acme.dev)"). */
  readonly lead?: readonly SelectItem[];
  /** Which calendars to list, of those in use (the only ones the app shows); every one in use by default. */
  readonly include?: (calendar: CalendarItem) => boolean;
  /** The calendar already chosen here (a page's own "Add bookings to"): listed even when not in use. */
  readonly chosen?: string;
  /** A listed calendar that can't be chosen now, shown muted. */
  readonly isDisabled?: (calendar: CalendarItem) => boolean;
}

/**
 * The calendars in use as dot options, each dot in that calendar's own colour. An account that lists two or more sits
 * under a heading with its address; an account with one lists it flat, since a heading repeating the address over
 * a single calendar says nothing the option doesn't. Pass `optionStyle="dot"` to the Select.
 */
export function calendarOptions({
  accounts,
  lead = [],
  include = () => true,
  chosen,
  isDisabled = () => false,
}: CalendarOptionsInput): SelectItem[] {
  const listed = accounts.map((account) => ({
    email: account.accountEmail,
    calendars: account.calendars.filter(
      (calendar) => (isCalendarInUse(calendar) || calendar.id === chosen) && include(calendar),
    ),
  }));
  return [
    ...lead,
    ...listed.flatMap(({ email, calendars }) =>
      calendars.map((calendar): SelectItem => ({
        id: calendar.id,
        label: calendar.name,
        hue: calendar.hue,
        ...(calendars.length > 1 ? { group: email } : {}),
        ...(isDisabled(calendar) ? { isDisabled: true } : {}),
      })),
    ),
  ];
}
