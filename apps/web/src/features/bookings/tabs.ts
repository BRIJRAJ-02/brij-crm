// The Bookings page's tabs and their addresses, kept apart from the tab strip so routes and other screens can
// link to a tab without loading it.

/**
 * Bookings' tabs, in their order (the IA brief of 5 November 2026, "do it as per competition", as Calendly and
 * Cal.com lay theirs out): Meetings (the week, the day, the team's day and the list, one switch between them), Pages
 * (the booking pages; round robin is a page's type, not an area of its own), Availability (the member's own hours,
 * and the team's Roster beside them for whoever sees a colleague's scheduling) and Routing (holders of
 * `routing.manage` only). Each tab is one or more views, each view its own address, so every old link still opens.
 */
export const BOOKINGS_TABS = ['meetings', 'pages', 'availability', 'routing'] as const;

/** One of Bookings' tabs. */
export type BookingsPageTab = (typeof BOOKINGS_TABS)[number];

/**
 * Bookings' views, each a route of its own (`/bookings/<view>`): the address a tab's switch moves between. Round
 * robin's groups and Calendars keep their addresses (and the command menu's way in), drawn under Pages and Meetings.
 */
export const BOOKINGS_VIEWS = [
  'calendar',
  'list',
  'calendars',
  'pages',
  'round-robin',
  'availability',
  'roster',
  'routing',
] as const;

/** One of Bookings' views (a route under `/bookings`). */
export type BookingsView = (typeof BOOKINGS_VIEWS)[number];

/** The tab each view sits under. */
const TAB_OF: Readonly<Record<BookingsView, BookingsPageTab>> = {
  calendar: 'meetings',
  list: 'meetings',
  calendars: 'meetings',
  pages: 'pages',
  'round-robin': 'pages',
  availability: 'availability',
  roster: 'availability',
  routing: 'routing',
};

/** The view a tab opens on. */
const FIRST_VIEW: Readonly<Record<BookingsPageTab, BookingsView>> = {
  meetings: 'calendar',
  pages: 'pages',
  availability: 'availability',
  routing: 'routing',
};

/** Whether `value` names one of Bookings' tabs. */
export const isBookingsPageTab = (value: string): value is BookingsPageTab =>
  (BOOKINGS_TABS as readonly string[]).includes(value);

/** Whether `value` names one of Bookings' views. */
export const isBookingsView = (value: string): value is BookingsView =>
  (BOOKINGS_VIEWS as readonly string[]).includes(value);

/** A view's address, or a tab's (the view it opens on). */
export const bookingsTabHref = (slug: string, to: BookingsView | BookingsPageTab) =>
  `/w/${slug}/bookings/${isBookingsView(to) ? to : FIRST_VIEW[to]}`;

/** The view an address under Bookings shows: its last segment when that names a view, else the calendar. */
export function bookingsViewOf(pathname: string): BookingsView {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return isBookingsView(last) ? last : 'calendar';
}

/** The tab a view sits under. */
export const tabOfView = (view: BookingsView): BookingsPageTab => TAB_OF[view];

/** The tab an address under Bookings shows: the tab its view sits under (bare `/bookings` is Meetings). */
export const bookingsTabOf = (pathname: string): BookingsPageTab => TAB_OF[bookingsViewOf(pathname)];
