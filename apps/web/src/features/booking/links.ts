// Where booking pages are (spec 0025): plain functions, no React, so loaders can use them.

/** Captures › Links: the booking pages list. */
export const linksHref = (slug: string) => `/w/${slug}/captures/links`;

/** The booking page editor's tabs, in order (22 Oct 2026); Hosts shows on a round robin page only. */
export const PAGE_TABS = ['page', 'meeting', 'hosts', 'hours', 'limits'] as const;
/** One of the editor's tabs, as `?tab=` holds it. */
export type PageTab = (typeof PAGE_TABS)[number];

/** A `?tab=` value as the editor's tab: Page for anything else. */
export const pageTabOf = (value: unknown): PageTab =>
  typeof value === 'string' && (PAGE_TABS as readonly string[]).includes(value) ? (value as PageTab) : 'page';

/** One page's editor, optionally at a tab (`?tab=hours`); Page, the first, needs none. */
export const pageEditorHref = (slug: string, pageId: string, tab?: PageTab) =>
  `/w/${slug}/captures/links/${pageId}${tab === undefined || tab === 'page' ? '' : `?tab=${tab}`}`;

/** The Availability tab's query: whose schedules (`member`, spec 0035 AC-971) and which one (`schedule`); none for the reader's own default. */
const availabilityQuery = (member: string | undefined, schedule?: string) => {
  const query = new URLSearchParams();
  if (schedule !== undefined && schedule !== 'default') query.set('schedule', schedule);
  if (member !== undefined) query.set('member', member);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
};

/** Bookings › Availability: the member's default schedule in its editor (spec 0035), or with `member` a colleague's. */
export const availabilityHref = (slug: string, member?: string) =>
  `/w/${slug}/bookings/availability${availabilityQuery(member)}`;

/**
 * One schedule open in the Availability tab (spec 0035, the Calendly way: the tab is the editor); `default` opens
 * whichever schedule is the default, the virtual one included.
 */
export const scheduleHref = (slug: string, scheduleId: string, member?: string) =>
  `/w/${slug}/bookings/availability${availabilityQuery(member, scheduleId)}`;

const UUID = /^[0-9a-f-]{36}$/i;

/** The `?member=` a route takes: a member id, else none (the reader's own). */
export function memberSearch(search: Record<string, unknown>): { readonly member?: string } {
  return typeof search.member === 'string' && UUID.test(search.member) ? { member: search.member.toLowerCase() } : {};
}

/** The Availability tab's search: `?member=` as `memberSearch`, and `?schedule=`, the schedule open (else the default). */
export function availabilitySearch(search: Record<string, unknown>): {
  readonly member?: string;
  readonly schedule?: string;
} {
  return {
    ...memberSearch(search),
    ...(typeof search.schedule === 'string' && UUID.test(search.schedule)
      ? { schedule: search.schedule.toLowerCase() }
      : {}),
  };
}

/** The page's public link, on this app's origin (the public bundle answers `/b/<publicKey>`). */
export const publicBookingUrl = (publicKey: string) => `${globalThis.location.origin}/b/${publicKey}`;
