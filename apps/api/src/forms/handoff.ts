// The form to booking hand off (spec 0023 AC-1057 and AC-1058, spec 0025
// AC-642): after a send, a form names the booking page with a signed token
// holding the submission, the page and the visitor's name and email. The
// booking page reads it back only through the API, which checks the
// signature, the expiry and the page, so nobody can make a link that puts
// words in a visitor's mouth. Signed with a key derived for this one purpose
// from the session secret every environment has.
import { deriveKey, signValue, verifyValue, type BookingHandoff } from '@crm/core';

/** The token's version: a token made under another never reads as this one. */
const HANDOFF_VERSION = 'fb1';
/** How long a hand off holds: a day, so a visitor who books tomorrow still arrives filled in. */
export const HANDOFF_SECONDS = 24 * 60 * 60;

/** The hand off key, derived from the session secret. */
export function handoffKey(sessionSecret: string): Buffer {
  return deriveKey(Buffer.from(sessionSecret, 'utf8'), 'form-booking-handoff');
}

/** Signs a hand off for `HANDOFF_SECONDS`. */
export function signHandoff(key: Buffer, handoff: BookingHandoff, now: Date = new Date()): string {
  return signValue(
    key,
    HANDOFF_VERSION,
    {
      s: handoff.submissionId,
      b: handoff.bookingPageId,
      ...(handoff.name === undefined ? {} : { n: handoff.name }),
      ...(handoff.email === undefined ? {} : { m: handoff.email }),
    },
    HANDOFF_SECONDS,
    now,
  );
}

/** The hand off a token holds, or undefined for anything not ours, tampered with, expired or malformed. */
export function readHandoff(
  key: Buffer,
  token: string | undefined,
  now: Date = new Date(),
): BookingHandoff | undefined {
  const payload = verifyValue(key, HANDOFF_VERSION, token, now);
  if (payload === undefined) return undefined;
  const { s, b, n, m } = payload;
  if (typeof s !== 'string' || typeof b !== 'string') return undefined;
  return {
    submissionId: s,
    bookingPageId: b,
    ...(typeof n === 'string' ? { name: n } : {}),
    ...(typeof m === 'string' ? { email: m } : {}),
  };
}
