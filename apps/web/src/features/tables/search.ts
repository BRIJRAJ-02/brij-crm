// The Reservations page's address (spec 0066 B7 lite): `?date=YYYY-MM-DD` names the day shown. No React, so a route's
// loader in the first load can import it.

/** What the Reservations page's address holds: the day, when it isn't today. */
export interface ReservationsSearch {
  readonly date?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as `YYYY-MM-DD`, or nothing: a mistyped day opens today rather than failing the page. */
export function reservationsSearch(search: Record<string, unknown>): ReservationsSearch {
  const { date } = search;
  if (typeof date !== 'string' || !DAY.test(date)) return {};
  const at = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== date ? {} : { date };
}
