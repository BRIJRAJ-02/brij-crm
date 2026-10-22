// The line under a booking page's "Add bookings to" (spec 0024, AC-997): where the page's bookings go, and, when its
// own calendar stopped taking bookings or went, which one stopped and the default the page uses instead.
import type { CalendarItem, PageDestinationView } from '@crm/data';
import { strings } from './strings.ts';

/** The owner's hint: the usual one, or the fall back naming the calendar that stopped and the default in its place. */
export function destinationHint(destination: PageDestinationView, calendars: readonly CalendarItem[]): string {
  if (destination.status !== 'unusable') return strings.addBookingsHint;
  const pick = calendars.find((calendar) => calendar.id === destination.calendarId)?.name ?? destination.removedName;
  const current = calendars.find((calendar) => calendar.isDestination);
  // The default names where bookings go only while it can take them itself.
  const usable = current !== undefined && current.id !== destination.calendarId && current.canBeDestination;
  return strings.destinationFellBack(pick, usable ? current.name : undefined);
}
