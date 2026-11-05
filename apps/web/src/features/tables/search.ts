// The Reservations page's address (spec 0066 B7 lite): `?date=YYYY-MM-DD` names the day shown and `?place=<id>` the
// place, so a link (the new reservation email's) opens that place's day. No React, so a route's loader in the first
// load can import it.

/** What the Reservations page's address holds: the day when it isn't today, the place when it isn't the first. */
export interface ReservationsSearch {
  readonly date?: string;
  readonly place?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real calendar day as `YYYY-MM-DD`, or nothing: a mistyped day opens today rather than failing the page. */
function dayOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DAY.test(value)) return undefined;
  const at = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value ? undefined : value;
}

/** The day and the place the address names; anything else is left out, so the page opens on today's first place. */
export function reservationsSearch(search: Record<string, unknown>): ReservationsSearch {
  const date = dayOf(search.date);
  const place = typeof search.place === 'string' && ID.test(search.place) ? search.place.toLowerCase() : undefined;
  return { ...(date === undefined ? {} : { date }), ...(place === undefined ? {} : { place }) };
}
