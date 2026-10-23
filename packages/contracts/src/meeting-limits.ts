// Bookings' list of every meeting (the owner's ask of 21 October 2026): its
// limits as plain TypeScript with no Zod, so the browser's data layer reads
// them without the schema library. `booking/pages.ts` re-exports them with
// the schemas.

/** The most meetings one page of Bookings' list answers. */
export const MEETINGS_PAGE_MAX = 100;
