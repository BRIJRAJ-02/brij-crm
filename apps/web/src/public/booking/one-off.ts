// A one off link's token on the public booking page (spec 0062, AC-6204): the 43 characters after `#o=` in the
// address the host shared. The fragment never reaches a server log or a Referer, so the page asks the link's state
// by the token's SHA-256 and sends the token itself only in the booking's body.
//
// And a redirect page's address after a booking (AC-6201), kept for the guest page in this tab only: never read from
// the guest page's own address, which anyone could hand someone with another site in it.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The token in a page address's fragment, or undefined. */
export function oneOffTokenOf(fragment: string): string | undefined {
  const token = new URLSearchParams(fragment.replace(/^#/, '')).get('o') ?? undefined;
  return token !== undefined && TOKEN.test(token) ? token : undefined;
}

/** The token's SHA-256, in hex: what the server stores and compares. */
export async function oneOffHash(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Where the redirect after a booking is kept, by the booking's guest token: one tab, read once. */
const keyOf = (manageToken: string) => `tfx.next:${manageToken}`;

/** An https address, or undefined: the server sends only the host's saved one, and this checks again. */
export function safeRedirect(url: string | undefined): string | undefined {
  return url !== undefined && URL.canParse(url) && new URL(url).protocol === 'https:' ? url : undefined;
}

/** Keeps a redirect for the guest page this tab opens next. */
export function keepRedirect(storage: Pick<Storage, 'setItem'> | undefined, manageToken: string, url: string): void {
  try {
    storage?.setItem(keyOf(manageToken), url);
  } catch {
    // Storage refused (a private window's quota): the guest page simply stays, as a confirmation page does.
  }
}

/** The redirect kept for this guest page, once: read and forgotten. */
export function takeRedirect(
  storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined,
  manageToken: string,
): string | undefined {
  try {
    const url = storage?.getItem(keyOf(manageToken)) ?? undefined;
    storage?.removeItem(keyOf(manageToken));
    return safeRedirect(url);
  } catch {
    return undefined;
  }
}
