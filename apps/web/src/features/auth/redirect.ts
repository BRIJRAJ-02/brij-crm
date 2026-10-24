// Where to go after signing in (spec 0005, Value sourcing): `?redirect=` is
// honoured only when it is a path in this app, so a link can never send a
// person to another site after they sign in.

import { HANDLE_PATTERN } from '@crm/contracts/handles';

/** The sign in pages themselves, lowercase: going back to one after signing in would loop. */
const SIGN_IN_PATHS = ['/sign-in', '/verify', '/two-factor'];

/**
 * A stand in origin to resolve paths against. Any value that leaves it (a
 * full address, `//host`, `/\host`) resolves to another origin and is refused.
 */
const BASE = new URL('https://app.crm.invalid');

/** The path with its escapes undone, or undefined when they are malformed. */
function decoded(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

/**
 * The path to go to after signing in: `value` when it starts with `/` and,
 * resolved the way a browser would, stays on this origin with a path that
 * doesn't start with `//` (which browsers read as another host) and isn't a
 * sign in page (compared lowercase, after undoing escapes); otherwise `/`.
 * The path comes back as resolved, so `..` and escapes can't hide a sign in
 * page or another host.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  // Spaces and control characters never belong in a path the app made.
  const codes = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
  if (/\s/.test(value) || codes.some((code) => code < 32 || code === 127)) return '/';
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE.origin || url.pathname.startsWith('//')) return '/';
  const path = decoded(url.pathname)?.toLowerCase();
  if (path === undefined || path.startsWith('//') || path.includes('\\')) return '/';
  if (SIGN_IN_PATHS.some((page) => path === page || path.startsWith(`${page}/`))) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Why the session ended: `ended`, `unsaved` when a change was lost with it, or `deleted` (the account, spec 0033). */
export type SignedOut = 'ended' | 'unsaved' | 'deleted';

/**
 * The sign in page, coming back to `redirectTo` afterwards (left off when it
 * is `/`); with `signedOut`, the page says the session ended (and whether a
 * change was lost) until the person acts.
 */
export function signInHref(redirectTo: string, signedOut?: SignedOut): string {
  const target = safeRedirect(redirectTo);
  const search = new URLSearchParams({
    ...(target === '/' ? {} : { redirect: target }),
    ...(signedOut === undefined ? {} : { signedOut }),
  }).toString();
  return search === '' ? '/sign-in' : `/sign-in?${search}`;
}

/** The longest `?error=` kept: sign in errors are short codes. */
const ERROR_MAX = 64;

/**
 * The sign in pages' search: where to go afterwards, the code a refused
 * Google sign in came back with, why the session ended under the person, and a
 * free booking address the visitor was offered.
 */
export interface SignInSearch {
  readonly redirect?: string;
  readonly error?: string;
  readonly signedOut?: SignedOut;
  /**
   * The free address a visitor was offered at `/<handle>` (25 Oct 2026). Nothing reads it yet: first run has no
   * handle step, and a handle is claimed in Settings › Account › Profile, so it is kept here only so the address
   * stays in this page's own URL rather than being stripped off it. It does not survive the next navigation, and
   * the offer page says only that signing up is the step, never that the address is already claimed.
   */
  readonly handle?: string;
}

/**
 * A sign in route's search: `redirect` kept when it is a string, `signedOut`
 * when it is one of its two words, and `error`
 * (Better Auth's code after a refused Google sign in) when it is a short
 * string. The page maps the code to its own words and never shows it as given.
 */
export function redirectSearch(search: Record<string, unknown>): SignInSearch {
  const { redirect, error, signedOut, handle } = search;
  return {
    ...(typeof redirect === 'string' ? { redirect } : {}),
    // Kept only when it has a handle's shape, so nothing else can ride in the address.
    ...(typeof handle === 'string' && HANDLE_PATTERN.test(handle) ? { handle } : {}),
    ...(typeof error === 'string' && error !== '' && error.length <= ERROR_MAX ? { error } : {}),
    ...(signedOut === 'ended' || signedOut === 'unsaved' || signedOut === 'deleted' ? { signedOut } : {}),
  };
}
