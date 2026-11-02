// The Bookings page's tabs, their views and their addresses, kept apart from the tab strip so routes and other
// screens can link to a tab without loading it.

/**
 * Bookings' tabs, in their order. Four areas, one job each (2 November 2026, the owner: "the whole bookings is now
 * confusing", "too much going on"). Seven tabs had grown out of seven reasonable arrivals, and three of the words
 * collided: Calendar beside Calendars, Availability beside Roster (both hours), Round robin beside Routing (both
 * decide who hosts). So each job is one tab, and what used to be a tab of its own is a view inside it:
 *
 * - `meetings`: what is booked. Views `day`, `week` (the default), `team` (the Team day, spec 0030) and `list`.
 *   Was Calendar and List.
 * - `hours`: when we are free. Views `mine` (the member's own schedules, spec 0035) and `team` (the team's
 *   bookable week, spec 0037 job J6, shown only to whoever sees someone else's scheduling, `rosterIsShown`).
 *   Was Availability and Roster.
 * - `hosts`: who takes the booking, the tab reading "Who hosts" (not "Hosts", which is one letter from Hours and
 *   the tab beside it). Views `groups` (round robin, spec 0029) and `rules` (routing, spec 0037 AC-1383, for
 *   holders of `routing.manage` only). Was Round robin and Routing.
 * - `calendars`: where it lands (specs 0024 and 0026). It keeps a tab of its own rather than joining a setup
 *   page, because a member with no calendar connected is why every other tab is empty.
 *
 * Every old address redirects to its view, search and all (`w.$slug.bookings.*.tsx`).
 */
export const BOOKINGS_TABS = ['meetings', 'hours', 'hosts', 'calendars'] as const;

/** One of Bookings' tabs. */
export type BookingsPageTab = (typeof BOOKINGS_TABS)[number];

/** Whether `value` names one of Bookings' tabs. */
export const isBookingsPageTab = (value: string): value is BookingsPageTab =>
  (BOOKINGS_TABS as readonly string[]).includes(value);

/** Meetings' views, in the order their switch shows them. */
export const MEETINGS_VIEWS = ['day', 'week', 'team', 'list'] as const;
/** One of Meetings' views. */
export type MeetingsView = (typeof MEETINGS_VIEWS)[number];

/** Hours' views: the member's own, and the team's week. */
export const HOURS_VIEWS = ['mine', 'team'] as const;
/** One of Hours' views. */
export type HoursView = (typeof HOURS_VIEWS)[number];

/**
 * Hosts' views: the round robin groups, and the routing rules. A third, Insights (lane L9), slots in after
 * `rules` when it lands: it is a view of the same job, not a fifth tab.
 */
export const HOSTS_VIEWS = ['groups', 'rules'] as const;
/** One of Hosts' views. */
export type HostsView = (typeof HOSTS_VIEWS)[number];

/** Whether `value` names one of Hours' views. */
export const isHoursView = (value: unknown): value is HoursView =>
  typeof value === 'string' && (HOURS_VIEWS as readonly string[]).includes(value);

/** Whether `value` names one of Hosts' views. */
export const isHostsView = (value: unknown): value is HostsView =>
  typeof value === 'string' && (HOSTS_VIEWS as readonly string[]).includes(value);

/** A Bookings tab's address. */
export const bookingsTabHref = (slug: string, tab: BookingsPageTab) => `/w/${slug}/bookings/${tab}`;

/** The tab an address under Bookings shows: its last segment when that names a tab, else Meetings. */
export function bookingsTabOf(pathname: string): BookingsPageTab {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return isBookingsPageTab(last) ? last : 'meetings';
}
