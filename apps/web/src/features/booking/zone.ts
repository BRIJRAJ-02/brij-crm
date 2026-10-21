// The browser's time zone, alone in its file: the Bookings routes' loaders read
// it up front, so hours.ts, and every booking word it draws, loads only with the
// screens that use them (the first load budget, spec 0003, AC-18).

/** The browser's zone. */
export const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;
