// The prefill seam (spec 0025 AC-642, spec 0023's "Book a quick meeting"):
// a form hands the visitor to this page with their name and email filled in,
// through a signed, single use link valid for two hours (`?p=<token>`). The
// token is checked by the API (milestone 3, with the forms hand off); until
// then no token is read and the page starts empty. Never from plain query
// parameters, so nobody can make a link that puts words in a visitor's mouth.
import type { Prefill } from './BookingPage.tsx';

/** The prefill a link carries, or undefined. A stub until the signed token lands (milestone 3). */
export function readPrefill(_address: URL): Prefill | undefined {
  return undefined;
}
