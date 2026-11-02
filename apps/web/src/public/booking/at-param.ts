// A next times chip's hand off (spec 0061, AC-6110): `/<handle>/<slug>?at=<start>&len=<minutes>`. The link page
// draws a booking page's next open times as chips; pressing one opens that page on that day with that time chosen
// and the details form ready.
//
// Both parts arrive in a public address anyone can write, so both are read as untrusted text: an `at` that is not
// an instant, or is not this century, and a `len` that is not a whole number of minutes in range are dropped and
// the page opens exactly as it would with no query at all. Nothing is ever said about a value that didn't fit,
// the way the prefill token is handled next door (`prefill.ts`).
import { readReturn, type Chosen, type ConnectResult } from './visitor.ts';

/** The longest `at` read: anything longer is not an instant, and is never parsed. */
const AT_MAX = 64;

/** The shortest and longest meeting `len` may name, in minutes, as `BookingDuration` allows. */
const LEN_MIN = 1;
const LEN_MAX = 24 * 60;

/** How far either side of now an `at` may stand (two years): past that it names no bookable time. */
const AT_RANGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** What a chip asked for: the time, as the instant it names, and the length its page offered. */
export interface AtChoice {
  /** The start as one spelling, so the page can match it against a slot whatever the address wrote. */
  readonly start: string;
  readonly startMs: number;
  readonly duration?: number;
}

/** A whole number of minutes `len` may name, else undefined. */
function lengthOf(given: string | null): number | undefined {
  if (given === null || given === '' || given.length > 4 || !/^\d+$/.test(given)) return undefined;
  const minutes = Number(given);
  return Number.isInteger(minutes) && minutes >= LEN_MIN && minutes <= LEN_MAX ? minutes : undefined;
}

/**
 * The `at` and `len` an address carries (AC-6110), or undefined for an address without a usable `at`. `now` is the
 * page's clock, so a time long gone or far ahead is dropped rather than read as a choice.
 */
export function readAt(address: URL, now: number): AtChoice | undefined {
  const given = address.searchParams.get('at');
  if (given === null || given === '' || given.length > AT_MAX) return undefined;
  const startMs = Date.parse(given);
  if (!Number.isFinite(startMs) || Math.abs(startMs - now) > AT_RANGE_MS) return undefined;
  const duration = lengthOf(address.searchParams.get('len'));
  return {
    start: new Date(startMs).toISOString(),
    startMs,
    ...(duration === undefined ? {} : { duration }),
  };
}

/** What this visit opened with: the return from Google (`visitor.ts`), and the time a chip asked for. */
export interface Opening {
  readonly chosen: Chosen;
  readonly result?: ConnectResult;
  /** The chip's time as an instant, when the address carried a usable one. */
  readonly at?: string;
}

/**
 * How the booking page opens: what a return from Google carried, with a next times chip's `at` and `len` folded in
 * (AC-6110). The chip decides the day and the length, since the visitor pressed a time, not a day; a return from
 * Google carries its own and never meets an `at`, because the return address keeps neither.
 *
 * `dayOf` turns the instant into the day key of the zone the page opens in, which only the page knows.
 */
export function openingOf(address: URL, now: number, dayOf: (startMs: number) => string): Opening {
  const back = readReturn(address);
  const at = readAt(address, now);
  if (at === undefined) return back;
  return {
    chosen: {
      ...back.chosen,
      day: dayOf(at.startMs),
      ...(at.duration === undefined ? {} : { duration: at.duration }),
    },
    ...(back.result === undefined ? {} : { result: back.result }),
    at: at.start,
  };
}
