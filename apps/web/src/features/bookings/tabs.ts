// The Bookings page's tabs and their addresses, kept apart from the tab strip so routes and other screens can
// link to a tab without loading it.

/**
 * Bookings' tabs, in their order: the week calendar, the list, the member's own hours, the groups a booking is
 * shared out between, and the calendars it reads. The last two came up out of Settings › Scheduling (25 October
 * 2026): they are what somebody setting up bookings does next, not workspace housekeeping, and a person who had
 * not connected a calendar had no reason to go looking three levels into Settings for the one thing that makes
 * every other tab work.
 */
export const BOOKINGS_TABS = ['calendar', 'list', 'availability', 'round-robin', 'calendars'] as const;

/** One of Bookings' tabs. */
export type BookingsPageTab = (typeof BOOKINGS_TABS)[number];

/** Whether `value` names one of Bookings' tabs. */
export const isBookingsPageTab = (value: string): value is BookingsPageTab =>
  (BOOKINGS_TABS as readonly string[]).includes(value);

/** A Bookings tab's address. */
export const bookingsTabHref = (slug: string, tab: BookingsPageTab) => `/w/${slug}/bookings/${tab}`;

/** The tab an address under Bookings shows: its last segment when that names a tab, else Calendar. */
export function bookingsTabOf(pathname: string): BookingsPageTab {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return isBookingsPageTab(last) ? last : 'calendar';
}
