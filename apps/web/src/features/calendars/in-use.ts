// Which of an account's calendars the app shows (the owner, 23 October 2026: the ones not in use "don't show this
// anywhere"). One rule, so Settings › Calendars, the Bookings week and every calendar picker agree.
import type { CalendarItem } from '@crm/data';

/** The parts of a calendar that say whether it is in use. */
export type CalendarUse = Pick<CalendarItem, 'isPrimary' | 'checkConflicts' | 'showInWeek' | 'sync' | 'isDestination'>;

/**
 * Whether a calendar is in use: its account's main calendar, one switched on in any way (Check for conflicts, Show
 * on my week, Log meetings), or the one bookings go to. Only these show anywhere in the app; the rest Google lists
 * (subscribed, shared, read only) stay out of sight, their stored settings untouched. One still switched on counts,
 * so it shows, and nothing switched on is ever out of reach.
 */
export const isCalendarInUse = (calendar: CalendarUse): boolean =>
  calendar.isPrimary || calendar.checkConflicts || calendar.showInWeek || calendar.sync || calendar.isDestination;
