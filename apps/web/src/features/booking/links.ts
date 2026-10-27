// Where booking pages are (spec 0025): plain functions, no React, so loaders can use them.
import { bookingPagePath } from '@crm/contracts/handles';
import type { BookingPageView } from '@crm/data';

/** Captures › Links: the booking pages list. */
export const linksHref = (slug: string) => `/w/${slug}/captures/links`;

/** Captures › Links with the New booking page dialog open, preset to Link only (Bookings' reserved time). */
export const newLinkOnlyPageHref = (slug: string) => `/w/${slug}/captures/links?new=link-only`;

/** The booking page editor's tabs, in order (22 Oct 2026); Hosts shows on a round robin page only. */
export const PAGE_TABS = ['page', 'meeting', 'questions', 'hosts', 'hours', 'limits'] as const;
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

// Calendars and Round robin came up out of Settings into Bookings (25 October 2026). Their addresses sit here
// beside Availability's rather than in `bookings/tabs.ts`, because the command menu and the screens that link to
// them are in the first load and that module is not: one import of it would put the whole tab strip's model
// there, in a chunk of its own, for two strings (`build.test.ts` counts the files).

/** Bookings › Calendars: a member's own calendar connections (specs 0024 and 0026). */
export const calendarsHref = (slug: string) => `/w/${slug}/bookings/calendars`;

/** Bookings › Round robin: the groups a booking is shared out between (spec 0029). */
export const roundRobinHref = (slug: string) => `/w/${slug}/bookings/round-robin`;

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

/**
 * Where the public booking addresses are served: `VITE_BOOKING_PUBLIC_ORIGIN` (Timefix's own domain, beside the
 * app's), else this app's origin. The same deployment answers on both.
 */
export function publicBookingOrigin(): string {
  const configured = import.meta.env.VITE_BOOKING_PUBLIC_ORIGIN;
  if (configured !== undefined && configured !== '') {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed value falls back to this app's own origin rather than breaking every link.
    }
  }
  return globalThis.location.origin;
}

/**
 * A page's public path: `/<handle>/<slug>` for a Public page once its owner has a handle, else `/b/<publicKey>`
 * (a Link only page's only address).
 */
export const publicBookingPath = (page: Pick<BookingPageView, 'handle' | 'slug' | 'publicKey' | 'isPrivate'>) =>
  bookingPagePath(page);

/**
 * Whether a read of a page is at least as new as the copy held: every write to a page moves its `updatedAt`, and a
 * handle claimed in Profile leaves it as it was, so an equal one is taken too.
 */
export const isNotOlder = (
  read: Pick<BookingPageView, 'updatedAt'>,
  held: Pick<BookingPageView, 'updatedAt'>,
): boolean => Date.parse(read.updatedAt) >= Date.parse(held.updatedAt);

/** The page's public link, on the public booking origin. */
export const publicBookingUrl = (page: Pick<BookingPageView, 'handle' | 'slug' | 'publicKey' | 'isPrivate'>) =>
  `${publicBookingOrigin()}${publicBookingPath(page)}`;

/**
 * The public origin's host alone ("timefix.com"), for a field that shows the
 * address a visitor reads rather than the whole URL (first run's Your link).
 */
export function publicBookingHost(): string {
  try {
    return new URL(publicBookingOrigin()).host;
  } catch {
    return '';
  }
}

/** A person's public profile, `/<handle>`, on the public booking origin. */
export const publicProfileUrl = (handle: string) => `${publicBookingOrigin()}/${encodeURIComponent(handle)}`;
