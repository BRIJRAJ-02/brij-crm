// The public booking page's rate limits and bot checks (spec 0025, AC-643).
// The limiter itself is the one central module (`../limits.ts`), shared with
// the public forms; the minimum fill time reads the server's fill ticket when
// the page sent one (`../forms/ticket.ts`).

import type { LimitRule } from '../limits.ts';

export { createMemoryLimiter, type LimitDecision, type LimitRule, type PublicLimiter } from '../limits.ts';

/** AC-643 and spec 0023: per client address, 60 slot reads and 5 bookings a minute; per page, more. */
export const BOOKING_LIMITS = {
  readsPerAddress: { max: 60, windowMs: 60_000 },
  booksPerAddress: { max: 5, windowMs: 60_000 },
  readsPerPage: { max: 600, windowMs: 60_000 },
  /** The guest page (spec 0025 experience): 20 a minute per address. */
  managePerAddress: { max: 20, windowMs: 60_000 },
  /** A guest's changes (move, guests, cancel): 8 a minute per booking, keyed by its id, never the token. */
  managePerBooking: { max: 8, windowMs: 60_000 },
  booksPerPage: { max: 50, windowMs: 60_000 },
  /** The booking chat (spec 0042, AC-1520): 30 turns a minute per address, 600 per page; a turn that books also counts as a booking. */
  chatPerAddress: { max: 30, windowMs: 60_000 },
  chatPerPage: { max: 600, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/** The least time a person takes from opening the page to booking. */
export const MIN_FILL_MS = 2_000;

/**
 * The bot checks a booking passes (AC-643): the honeypot left empty, and not
 * sent faster than a person could: by the server's clock when the page sent a
 * valid fill ticket (`ticketElapsedMs`), else by the page's `startedAt`.
 */
export function looksLikeBot(
  input: { readonly company_url?: string; readonly startedAt?: number },
  now: number,
  ticketElapsedMs?: number,
): boolean {
  if (input.company_url !== undefined && input.company_url !== '') return true;
  if (ticketElapsedMs !== undefined) return ticketElapsedMs < MIN_FILL_MS;
  return input.startedAt !== undefined && now - input.startedAt < MIN_FILL_MS;
}
