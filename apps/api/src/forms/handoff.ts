// The form to booking hand off (spec 0023 AC-1057 and AC-1058, spec 0025
// AC-642): after a send, a form names the booking page with a signed token
// holding only the submission and the page. Nothing personal rides in the
// link: the booking page asks the API for the name and email, which reads
// them from the stored submission once the signature, the expiry and the
// page check out, so a copied or logged link gives nothing away and nobody
// can make one that puts words in a visitor's mouth. Signed with a key
// derived for this one purpose from the session secret every environment has.
import { deriveKey, signValue, verifyValue, type BookingHandoff } from '@crm/core';

/** The token's version: a token made under another never reads as this one. */
const HANDOFF_VERSION = 'fb1';
/** How long a hand off holds: a day, so a visitor who books tomorrow still arrives filled in. */
export const HANDOFF_SECONDS = 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The hand off key, derived from the session secret. */
export function handoffKey(sessionSecret: string): Buffer {
  return deriveKey(Buffer.from(sessionSecret, 'utf8'), 'form-booking-handoff');
}

/** Signs a hand off for `HANDOFF_SECONDS`: the submission and the page, nothing else. */
export function signHandoff(key: Buffer, handoff: BookingHandoff, now: Date = new Date()): string {
  return signValue(key, HANDOFF_VERSION, { s: handoff.submissionId, b: handoff.bookingPageId }, HANDOFF_SECONDS, now);
}

/** The hand off a token holds, or undefined for anything not ours, tampered with, expired or malformed. */
export function readHandoff(
  key: Buffer,
  token: string | undefined,
  now: Date = new Date(),
): BookingHandoff | undefined {
  const payload = verifyValue(key, HANDOFF_VERSION, token, now);
  if (payload === undefined) return undefined;
  const { s, b } = payload;
  if (typeof s !== 'string' || typeof b !== 'string' || !UUID.test(s) || !UUID.test(b)) return undefined;
  return { submissionId: s, bookingPageId: b };
}

/** The hand off a token holds for the page `pageId`, or undefined: a token for another page counts for nothing. */
export function handoffForPage(
  key: Buffer | undefined,
  token: string | undefined,
  pageId: string,
  now: Date = new Date(),
): BookingHandoff | undefined {
  if (key === undefined || token === undefined || token === '') return undefined;
  const handoff = readHandoff(key, token, now);
  return handoff?.bookingPageId === pageId ? handoff : undefined;
}
