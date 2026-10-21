// Where booking pages are (spec 0025): plain functions, no React, so loaders can use them.

/** Scheduling › Booking pages: the booking pages list (spec 0034). */
export const linksHref = (slug: string) => `/w/${slug}/booking-pages`;

/** One page's editor, optionally at a group (`#hours`). */
export const pageEditorHref = (slug: string, pageId: string) => `/w/${slug}/booking-pages/${pageId}`;

/** Scheduling › Availability: the member's own hours and days off (spec 0034). */
export const availabilityHref = (slug: string) => `/w/${slug}/availability`;

/** The page's public link, on this app's origin (the public bundle answers `/b/<publicKey>`). */
export const publicBookingUrl = (publicKey: string) => `${globalThis.location.origin}/b/${publicKey}`;
