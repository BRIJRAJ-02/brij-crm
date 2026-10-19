// Where booking pages are (spec 0025): plain functions, no React, so loaders and the nav can use them.

/** Settings › Booking pages. */
export const bookingPagesHref = (slug: string) => `/w/${slug}/settings/booking-pages`;

/** One page's builder. */
export const bookingPageHref = (slug: string, pageId: string) => `/w/${slug}/settings/booking-pages/${pageId}`;

/** The page's public link, on this app's origin (the public bundle answers `/b/<publicKey>`). */
export const publicBookingUrl = (publicKey: string) => `${globalThis.location.origin}/b/${publicKey}`;
