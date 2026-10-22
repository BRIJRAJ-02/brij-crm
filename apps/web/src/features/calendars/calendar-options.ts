// The member's calendars as Select options, built in one place so every calendar picker lists them the same way:
// a booking page's "Add bookings to" (its editor) and the default in Settings › Calendars.
import type { CalendarAccountView, CalendarItem } from '@crm/data';
import type { SelectItem } from '@crm/ui';

/** What to list, and what to put first. */
export interface CalendarOptionsInput {
  /** The member's accounts, each with its calendars, in the order Settings lists them. */
  readonly accounts: readonly Pick<CalendarAccountView, 'accountEmail' | 'calendars'>[];
  /** Options before the calendars, ungrouped (a page's "Default (ada@acme.dev)"). */
  readonly lead?: readonly SelectItem[];
  /** Which calendars to list; every one by default. */
  readonly include?: (calendar: CalendarItem) => boolean;
  /** A listed calendar that can't be chosen now, shown muted. */
  readonly isDisabled?: (calendar: CalendarItem) => boolean;
}

/**
 * The calendars as dot options, each dot in that calendar's own colour. An account that lists two or more sits
 * under a heading with its address; an account with one lists it flat, since a heading repeating the address over
 * a single calendar says nothing the option doesn't. Pass `optionStyle="dot"` to the Select.
 */
export function calendarOptions({
  accounts,
  lead = [],
  include = () => true,
  isDisabled = () => false,
}: CalendarOptionsInput): SelectItem[] {
  const listed = accounts.map((account) => ({
    email: account.accountEmail,
    calendars: account.calendars.filter(include),
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
