// Where booking pages are (spec 0025): plain functions, no React, so loaders can use them.

/** Captures › Links: the booking pages list. */
export const linksHref = (slug: string) => `/w/${slug}/captures/links`;

/** One page's editor, optionally at a group (`#hours`). */
export const pageEditorHref = (slug: string, pageId: string) => `/w/${slug}/captures/links/${pageId}`;

/** Bookings › Availability: the member's schedules (spec 0035). */
export const availabilityHref = (slug: string) => `/w/${slug}/bookings/availability`;

/** One schedule's editor (spec 0035); `default` opens whichever schedule is the default, the virtual one included. */
export const scheduleHref = (slug: string, scheduleId: string) => `/w/${slug}/bookings/availability/${scheduleId}`;

/** The page's public link, on this app's origin (the public bundle answers `/b/<publicKey>`). */
export const publicBookingUrl = (publicKey: string) => `${globalThis.location.origin}/b/${publicKey}`;
