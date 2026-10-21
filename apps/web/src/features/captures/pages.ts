// Booking pages and Forms (spec 0034, AC-928): Scheduling's two list pages, which took over Captures' Links and
// Forms tabs, and their addresses. Kept apart from the screens, so routes and other screens link to them without
// loading them. Every old `/captures` address redirects to one of them (`workspace/moved.ts`, AC-929).

/** The two list pages that share the Captures chrome, in the sidebar's order: the booking pages, then the forms. */
export const CAPTURE_PAGES = ['links', 'forms'] as const;

/** One of the two list pages. */
export type CapturePage = (typeof CAPTURE_PAGES)[number];

/** Scheduling › Booking pages: the booking pages list. */
export const linksHref = (slug: string) => `/w/${slug}/booking-pages`;

/** Scheduling › Forms: the lead capture forms list. */
export const formsHref = (slug: string) => `/w/${slug}/forms`;

/** A list page's address. */
export const capturePageHref = (slug: string, page: CapturePage) =>
  page === 'links' ? linksHref(slug) : formsHref(slug);
