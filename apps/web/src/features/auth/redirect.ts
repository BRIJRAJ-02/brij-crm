// Where to go after signing in (spec 0005, Value sourcing): `?redirect=` is
// honoured only when it is a path in this app, so a link can never send a
// person to another site after they sign in.

/** The sign in pages themselves: going back to one after signing in would loop. */
const SIGN_IN_PATHS = ['/sign-in', '/verify'];

/**
 * The path to go to after signing in: `value` when it starts with a single
 * `/` (not `//` or `/\`, which browsers read as another host) and isn't a
 * sign in page; otherwise `/`.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  // Spaces and control characters never belong in a path the app made.
  const codes = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
  if (/\s/.test(value) || codes.some((code) => code < 32 || code === 127)) return '/';
  const path = value.split(/[?#]/)[0] ?? '';
  if (SIGN_IN_PATHS.some((page) => path === page || path.startsWith(`${page}/`))) return '/';
  return value;
}

/** The sign in page, coming back to `redirectTo` afterwards (left off when it is `/`). */
export function signInHref(redirectTo: string): string {
  const target = safeRedirect(redirectTo);
  return target === '/' ? '/sign-in' : `/sign-in?${new URLSearchParams({ redirect: target }).toString()}`;
}

/** A route's `redirect` search value, kept only when it is a string. */
export function redirectSearch(search: Record<string, unknown>): { redirect?: string } {
  return typeof search.redirect === 'string' ? { redirect: search.redirect } : {};
}
