// The prefill seam (spec 0025 AC-642 and AC-671, spec 0023's "Book a quick
// meeting"): a form hands the visitor to this page with their name and email
// filled in, through a signed, single use link valid for two hours
// (`?p=<token>`). The token is checked by the API with the forms hand off
// (milestone 3); until then no token is read and the page starts empty. Never
// from plain query parameters, so nobody can make a link that puts words in a
// visitor's mouth.

/** A visitor's name and email handed in by a form. */
export interface Prefill {
  readonly name?: string;
  readonly email?: string;
}

/** The prefill a link carries, or undefined. A stub until the signed token lands (milestone 3). */
export function readPrefill(_address: URL): Prefill | undefined {
  return undefined;
}
