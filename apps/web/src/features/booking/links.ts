// Where booking pages are (spec 0025): plain functions, no React, so loaders can use them.

/** Captures › Links: the booking pages list. */
export const linksHref = (slug: string) => `/w/${slug}/captures/links`;

/** One page's editor, optionally at a group (`#hours`). */
export const pageEditorHref = (slug: string, pageId: string) => `/w/${slug}/captures/links/${pageId}`;

/** A `?member=` query for an admin viewing a colleague's schedules (spec 0035, AC-971); none for the reader's own. */
const memberQuery = (member: string | undefined) =>
  member === undefined ? '' : `?member=${encodeURIComponent(member)}`;

/** Bookings › Availability: the member's schedules (spec 0035), or with `member` a colleague's. */
export const availabilityHref = (slug: string, member?: string) =>
  `/w/${slug}/bookings/availability${memberQuery(member)}`;

/** One schedule's editor (spec 0035); `default` opens whichever schedule is the default, the virtual one included. */
export const scheduleHref = (slug: string, scheduleId: string, member?: string) =>
  `/w/${slug}/bookings/availability/${scheduleId}${memberQuery(member)}`;

/** The `?member=` a route takes: a member id, else none (the reader's own). */
export function memberSearch(search: Record<string, unknown>): { readonly member?: string } {
  return typeof search.member === 'string' && /^[0-9a-f-]{36}$/i.test(search.member)
    ? { member: search.member.toLowerCase() }
    : {};
}

/** The page's public link, on this app's origin (the public bundle answers `/b/<publicKey>`). */
export const publicBookingUrl = (publicKey: string) => `${globalThis.location.origin}/b/${publicKey}`;
