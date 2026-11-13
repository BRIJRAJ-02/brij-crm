// The shape of a public booking address, and the words no one may take as a handle (owner decision, 22 Oct 2026):
// what a guest page needs to read `/<handle>/<slug>`, kept apart from the rest of `handles.ts` (names, problems,
// suggestions), which only the app and the API use. Every guest page reads an address (`apps/web/src/public/frame.ts`),
// so whatever sits in this module is in their first load; `handles.ts` re-exports it all (spec 0074).

/** A handle's shape: lowercase letters, digits and single hyphens, 3 to 40 characters. */
export const HANDLE_PATTERN = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A booking page's slug shape (`BookingSlug`'s), as the router reads it. */
export const SLUG_PATTERN = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Words no one may take as a handle: every top level path the app serves (its routes, the public pages, the API,
 * the built files), and words a visitor would read as ours. A route added at the top level adds its word here;
 * `apps/web/public-paths.test.ts` fails until it does.
 */
export const RESERVED_HANDLES: readonly string[] = [
  'about',
  'account',
  'accounts',
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'availability',
  'b',
  'billing',
  'blog',
  'book',
  'booking',
  'bookings',
  'brand',
  'calendar',
  'callback',
  'cancel',
  'captures',
  'contact',
  'dashboard',
  'demo',
  'developers',
  'docs',
  'download',
  'edit',
  'email',
  'email-preferences',
  'embed',
  'f',
  'favicon',
  'form',
  'forms',
  'health',
  'help',
  'home',
  'inbox',
  'index',
  'integrations',
  'invite',
  'join',
  'legal',
  'links',
  'login',
  'logout',
  'mail',
  'manage',
  'manifest',
  'new',
  'null',
  'oauth',
  'objects',
  'pricing',
  'privacy',
  'profile',
  'public',
  'reschedule',
  'robots',
  'root',
  'schedule',
  'search',
  'security',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'sitemap',
  'static',
  'status',
  'support',
  'team',
  'terms',
  'theme-boot',
  'timefix',
  'two-factor',
  'undefined',
  'user',
  'users',
  'verify',
  'w',
  'webhooks',
  'welcome',
  'www',
];

/** Whether `handle` is one of the words kept for the app. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.includes(handle);
}

/** What a public booking address is: a profile (`/<handle>`), or one page (`/<handle>/<slug>`). */
export type HandleAddress =
  | { readonly kind: 'profile'; readonly handle: string }
  | { readonly kind: 'page'; readonly handle: string; readonly slug: string };

/** The handle address a path names, or undefined for any other path (the app's, `/b/…`, a reserved word). */
export function handleAddressOf(pathname: string): HandleAddress | undefined {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1);
  const [handle, slug, ...rest] = parts;
  if (handle === undefined || rest.length > 0 || !HANDLE_PATTERN.test(handle) || isReservedHandle(handle)) {
    return undefined;
  }
  if (slug === undefined) return { kind: 'profile', handle };
  return SLUG_PATTERN.test(slug) ? { kind: 'page', handle, slug } : undefined;
}
