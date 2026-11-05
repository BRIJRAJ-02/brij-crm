// The public booking page's rate limits and bot checks (spec 0025, AC-643).
// The limiter itself is the one central module (`../limits.ts`), shared with
// the public forms; the minimum fill time reads the server's fill ticket when
// the page sent one (`../forms/ticket.ts`).

import type { LimitRule } from '../limits.ts';

export { createMemoryLimiter, type LimitDecision, type LimitRule, type PublicLimiter } from '../limits.ts';

/**
 * AC-643 and spec 0023: per client address, 120 reads and 5 bookings a minute; per page, more. Reads were 60 an
 * address until B-18 (4 Nov 2026): one visit spends 3 to 5 (the facts, the first times, the viewer, a prefill, a
 * read per month moved), a chat turn spends one, and an office, a school or a mobile carrier's shared address holds
 * many visitors, so 60 refused real people. The per page 600 and the busy cache still bound what reads cost.
 */
export const BOOKING_LIMITS = {
  readsPerAddress: { max: 120, windowMs: 60_000 },
  booksPerAddress: { max: 5, windowMs: 60_000 },
  readsPerPage: { max: 600, windowMs: 60_000 },
  /** The guest page (spec 0025 experience): 20 a minute per address. */
  managePerAddress: { max: 20, windowMs: 60_000 },
  /** A guest's changes (move, guests, cancel): 8 a minute per booking, keyed by its id, never the token. */
  managePerBooking: { max: 8, windowMs: 60_000 },
  booksPerPage: { max: 50, windowMs: 60_000 },
  /**
   * B-02, the forms' numbers: 50 bookings a second across this instance (`forms:instance`'s ceiling), checked before
   * anything else, and 5 an hour per page and visitor email (hashed, a `+tag` dropped), since each booking mails its
   * visitor.
   * A form's per email limit only marks a submission for review; a booking that sends mail is refused instead.
   */
  booksPerInstance: { max: 50, windowMs: 1_000 },
  booksPerEmail: { max: 5, windowMs: 3_600_000 },
  /**
   * B-02: the guest invitations one page sends in a day, each guest one, from the booking and the guest page's Add
   * guests alike. Each booking may invite 10, so 200 is 20 full bookings a day before the page stops inviting more.
   */
  guestInvitesPerPage: { max: 200, windowMs: 86_400_000 },
  /** The booking chat (spec 0042, AC-1520): 30 turns a minute per address, 600 per page; a turn that books also counts as a booking. */
  chatPerAddress: { max: 30, windowMs: 60_000 },
  chatPerPage: { max: 600, windowMs: 60_000 },
  /**
   * Whether an address is free (25 Oct 2026): 10 a minute per client address, and 50 a second across this
   * instance. The page asks once, only after a profile read found nothing, so this is low on purpose. It slows a
   * sweep of which addresses are taken rather than stopping one: the per address window is this process's own
   * memory (#41), and a fresh client address starts a fresh one, so the instance ceiling is what holds a flood.
   */
  offersPerAddress: { max: 10, windowMs: 60_000 },
  offersPerInstance: { max: 50, windowMs: 1_000 },
  /** A host's picture (23 Oct 2026): 60 a minute per address, 600 per page or handle; the edge keeps most of them. */
  picturesPerAddress: { max: 60, windowMs: 60_000 },
  picturesPerTarget: { max: 600, windowMs: 60_000 },
  /**
   * A link page's contact card as a vCard (spec 0051, AC-5114): 20 a minute per address; past 300 a minute for one
   * handle, its cards go without the picture (the fetches of Google are what the handle's budget bounds).
   */
  vcardsPerAddress: { max: 20, windowMs: 60_000 },
  vcardsPerHandle: { max: 300, windowMs: 60_000 },
  /** A link page block's press (spec 0051, AC-5126): 60 a minute per address, 600 per handle; past them, uncounted. */
  pressesPerAddress: { max: 60, windowMs: 60_000 },
  pressesPerHandle: { max: 600, windowMs: 60_000 },
  /** A link page's views (AC-5126): past 600 a minute for one page, its reads are answered but not counted. */
  viewsPerHandle: { max: 600, windowMs: 60_000 },
  /**
   * A booking page's Insights beacons (spec 0067, AC-6702): a view and two steps a visit, so 60 a minute per address
   * and 3,000 per page; past them, answered 204 and uncounted, as a form's events are.
   */
  eventsPerAddress: { max: 60, windowMs: 60_000 },
  eventsPerPage: { max: 3_000, windowMs: 60_000 },
  /**
   * A link block's own icon (26 Oct 2026): tighter than a picture, because a miss costs a read of a site we do not
   * run, not a read of Google. 20 a minute per address and 60 per handle cover a page of 20 links loading cold
   * twice over; the edge keeps each one for a day, so a page in normal use asks once.
   */
  iconsPerAddress: { max: 20, windowMs: 60_000 },
  iconsPerHandle: { max: 60, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/**
 * The guest menu's reads (spec 0065, H1; security review, should-fix 4). A guest's own read counts against their
 * address, as a booking page's does. The `/m/<key>` server render reads on a guest's behalf from one function
 * address, so a read it vouches for (`EdgeGuard.rendered`) counts against the guest's forwarded address instead, and
 * against the key it names: 600 a minute per key, so a spray of made up keys spends only those keys' windows, never
 * the budget a real menu's renders draw on. The edge keeps the answer a day, so a real menu's renders rarely get here.
 */
export const MENU_LIMITS = {
  readsPerAddress: BOOKING_LIMITS.readsPerAddress,
  rendersPerKey: { max: 600, windowMs: 60_000 },
  /**
   * A table QR's code read (spec 0065, H2): a guest scans once and the page reads it once, so 20 a minute per address
   * is plenty for a table of phones behind one router. No per key window: the key is printed on every table, and
   * with 122 bit codes there is nothing to walk, so a key wide window would only let strangers switch scans off.
   */
  tablesPerAddress: { max: 20, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/**
 * The part of a client address a limit keys on (B-02): an IPv4 address whole, an IPv6 address by its /64, since one
 * home or one server holds a whole /64 and would otherwise be a new visitor at every address in it. An IPv4 mapped
 * IPv6 address (`::ffff:192.0.2.1`) is its IPv4 address. Anything else is taken as given.
 */
export function limitAddress(ip: string | undefined): string | undefined {
  if (ip === undefined || !ip.includes(':')) return ip;
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped !== null) return mapped[1];
  const [head = '', tail] = bare.toLowerCase().split('::');
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array.from({ length: Math.max(0, 8 - front.length - back.length) }, () => '0'), ...back];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return bare;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** A visitor's email as the per email limit keys it: lower case, trimmed, a `+tag` dropped (the forms' rule). */
export function limitEmail(email: string): string {
  const plain = email.trim().toLowerCase();
  const at = plain.lastIndexOf('@');
  return at < 0 ? plain : `${plain.slice(0, at).replace(/\+.*$/u, '')}${plain.slice(at)}`;
}

/** The least time a person takes from opening the page to booking. */
export const MIN_FILL_MS = 2_000;

/** Why a booking reads as a bot's: the honeypot filled, or sent faster than a person could. */
export type BotReason = 'trap' | 'too_fast';

/**
 * The bot checks a booking passes (AC-643): the honeypot left empty, and not
 * sent faster than a person could, by the server's clock: a valid fill ticket
 * (`ticketElapsedMs`) at least `MIN_FILL_MS` old. With tickets set up (every
 * deploy: `createApp` makes the book), a missing or invalid ticket is
 * `too_fast` (B-04): the client's own `startedAt` can say anything, so it is
 * read only where no ticket book exists (`tickets: false`). An `expired` one
 * passes: it is ours, and its age is past any fill time. The reason goes in
 * the refusal's log line, so a person refused can be traced.
 */
export function botReason(
  input: { readonly company_url?: string; readonly startedAt?: number },
  now: number,
  ticketElapsedMs?: number,
  options: { readonly tickets?: boolean; readonly expired?: boolean } = {},
): BotReason | undefined {
  if (input.company_url !== undefined && input.company_url !== '') return 'trap';
  if (ticketElapsedMs !== undefined) return ticketElapsedMs < MIN_FILL_MS ? 'too_fast' : undefined;
  // A ticket past its day is ours and was made more than `MIN_FILL_MS` ago: a tab left open overnight books.
  if (options.expired === true) return undefined;
  if (options.tickets !== false) return 'too_fast';
  return input.startedAt !== undefined && now - input.startedAt < MIN_FILL_MS ? 'too_fast' : undefined;
}
