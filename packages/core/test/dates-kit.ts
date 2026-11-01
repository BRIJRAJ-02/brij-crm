// A week of fixture days that rolls, so a booking suite never goes red the day
// its fixture arrives. Tests only: it lives outside src, beside the other kits.
//
// A booking fixture has to sit in the future, and not every clock a booking
// touches can be injected: `crm_enqueue_booking_mail` skips a reminder whose
// `run_at` has passed by comparing against the database's own clock, which no
// injected `now` can move. A fixed calendar date therefore turns a suite red
// the week it comes round, as 2 November 2026 did. Rolling a year out keeps the
// fixture comfortably ahead of both clocks, and keeps the weekday the fixture
// relies on: a booking page's hours usually open Monday to Friday, so most
// fixtures need a Monday.

/** Whole days, in milliseconds. */
const DAY_MS = 86_400_000;

/** A day as `YYYY-MM-DD`, read in UTC. */
const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** The days a booking fixture hangs off, all `YYYY-MM-DD` and all in UTC. */
export interface RollingWeek {
  /** The Monday about a year out: the day the fixture books. */
  readonly monday: string;
  /** The Sunday before it, the day a suite usually calls `now`. */
  readonly sunday: string;
  /** The Tuesday after it, the end of a one day range over the Monday. */
  readonly tuesday: string;
  /** Any other day around the Monday, by whole days either side. */
  readonly day: (offset: number) => string;
}

/**
 * The Monday about a year from `from` (today by default), with the days around
 * it, for a fixture that has to stay in the future. Prefer this to a date
 * literal in any suite that books, reminds, moves or cancels.
 */
export function rollingWeek(from: Date = new Date()): RollingWeek {
  const aYearOut = new Date(from.getTime() + 365 * DAY_MS);
  // `(8 - weekday) % 7` is the hop to the next Monday, and zero when it is one already.
  const monday = dayOf(new Date(aYearOut.getTime() + ((8 - aYearOut.getUTCDay()) % 7) * DAY_MS));
  const day = (offset: number): string => dayOf(new Date(Date.parse(`${monday}T00:00:00.000Z`) + offset * DAY_MS));
  return { monday, sunday: day(-1), tuesday: day(1), day };
}
