// Where to go after signing in (spec 0005, Value sourcing): `?redirect=` is
// honoured only when it is a path in this app, so a link can never send a
// person to another site after they sign in.

/** The sign in pages themselves, lowercase: going back to one after signing in would loop. */
const SIGN_IN_PATHS = ['/sign-in', '/verify'];

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

/** The sign in page, coming back to `redirectTo` afterwards (left off when it is `/`). */
export function signInHref(redirectTo: string): string {
  const target = safeRedirect(redirectTo);
  return target === '/' ? '/sign-in' : `/sign-in?${new URLSearchParams({ redirect: target }).toString()}`;
}

/** The longest `?error=` kept: sign in errors are short codes. */
const ERROR_MAX = 64;

/** The sign in pages' search: where to go afterwards, and the code a refused Google sign in came back with. */
export interface SignInSearch {
  readonly redirect?: string;
  readonly error?: string;
}

/**
 * A sign in route's search: `redirect` kept when it is a string, and `error`
 * (Better Auth's code after a refused Google sign in) when it is a short
 * string. The page maps the code to its own words and never shows it as given.
 */
export function redirectSearch(search: Record<string, unknown>): SignInSearch {
  const { redirect, error } = search;
  return {
    ...(typeof redirect === 'string' ? { redirect } : {}),
    ...(typeof error === 'string' && error !== '' && error.length <= ERROR_MAX ? { error } : {}),
  };
}
