// The prefill seam (spec 0025 AC-642 and AC-671, spec 0023 AC-1058): a form
// hands the visitor to this page with a signed token (`?p=<token>`) holding
// only the submission id and the page id. The page never reads a name or an
// email from the address: it asks the API, which reads them from the stored
// submission only for a token it signed for this page and not yet expired, so
// nobody can make a link that puts words in a visitor's mouth. The token
// rides on the booking, which then links to the form's submission.
//
// The token leaves the address as the page loads (security review, 21 October
// 2026): it is kept in this tab's session storage instead, so a copied,
// bookmarked or forwarded address, the history and Google's sign in never
// carry it, while a reload or the return from Google in the same tab still
// has it. No visual change.

/** A visitor's name and email handed in by a form. */
export interface Prefill {
  readonly name?: string;
  readonly email?: string;
  /** The form's answers to questions this page asks by the same key (spec 0057, AC-5713), as text. */
  readonly answers?: Readonly<Record<string, string>>;
  /** This page's questions the form already answered onto the same attribute (AC-5713): not asked again. */
  readonly skip?: readonly string[];
}

/** The longest token read; anything longer is not ours. */
const TOKEN_MAX = 4096;

/** Where a page keeps its hand off for the tab's visit. */
const keyOf = (publicKey: string) => `crm.handoff.${publicKey}`;

/** The tab's session storage as the page uses it; it may be missing, or refuse. */
export type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A token as the page takes it: one of ours in shape, else nothing. */
const tokenOf = (value: string | null): string | undefined =>
  value === null || value === '' || value.length > TOKEN_MAX ? undefined : value;

/**
 * The hand off this visit carries, and the address to show once it is out of
 * it: from the address the first time (then kept in `storage`), else from
 * `storage` (a reload, the return from Google). Its words come only from the
 * API (`client.prefill`). Storage that refuses keeps nothing, and the token
 * is still read from the address this once.
 */
export function takeHandoff(
  address: URL,
  publicKey: string,
  storage: HandoffStorage | undefined,
): { readonly handoff?: string; readonly tidied?: string } {
  const given = address.searchParams.get('p');
  if (given !== null) {
    const next = new URL(address.href);
    next.searchParams.delete('p');
    const tidied = `${next.pathname}${next.search}${next.hash}`;
    const token = tokenOf(given);
    if (token === undefined) return { tidied };
    try {
      storage?.setItem(keyOf(publicKey), token);
    } catch {
      // Storage refused: this load still has the token.
    }
    return { handoff: token, tidied };
  }
  try {
    const token = tokenOf(storage?.getItem(keyOf(publicKey)) ?? null);
    return token === undefined ? {} : { handoff: token };
  } catch {
    return {};
  }
}

/** Forgets a page's hand off once it is booked, so the tab's next booking there starts empty. */
export function forgetHandoff(publicKey: string, storage: HandoffStorage | undefined): void {
  try {
    storage?.removeItem(keyOf(publicKey));
  } catch {
    // Nothing kept, or storage refused: nothing to forget.
  }
}
