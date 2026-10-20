// The prefill seam (spec 0025 AC-642 and AC-671, spec 0023 AC-1058): a form
// hands the visitor to this page with a signed token (`?p=<token>`) holding
// the submission and their name and email. The page never reads the name or
// email from the address itself: it asks the API, which answers them only for
// a token it signed for this page and not yet expired, so nobody can make a
// link that puts words in a visitor's mouth. The token rides on the booking,
// which then links to the form's submission and the person.

/** A visitor's name and email handed in by a form. */
export interface Prefill {
  readonly name?: string;
  readonly email?: string;
}

/** The hand off token a link carries, or undefined. Its words come only from the API (`client.prefill`). */
export function readHandoff(address: URL): string | undefined {
  const token = address.searchParams.get('p');
  return token === null || token === '' || token.length > 4096 ? undefined : token;
}
