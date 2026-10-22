// The public booking addresses' routing (22 Oct 2026): `/<handle>` (a person's profile) and `/<handle>/<slug>` (one
// of their booking pages) load the public booking bundle (book.html), beside `/b/<key>`. A handle is never one of
// the app's own top level words (`RESERVED_HANDLES`), so the app's routes, the API and the built files keep their
// paths. vercel.json can't import, so it holds these patterns as text: `public-paths.test.ts` fails until its
// rewrites and headers say exactly what this file builds, and until every top level route is a reserved word.
import { RESERVED_HANDLES } from '@crm/contracts/handles';

/** The reserved words a handle could look like (3 characters and more), longest first, as one alternation. */
const RESERVED = [...RESERVED_HANDLES]
  .filter((word) => word.length >= 3)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join('|');

/** A handle's path segment: 3 to 40 of a-z, 0-9 and hyphens, not starting or ending with one, never reserved. */
export const HANDLE_SEGMENT = `(?!(?:${RESERVED})(?:/|$))[a-z0-9][a-z0-9-]{1,38}[a-z0-9]`;

/** A booking page's slug segment: 1 to 60 of a-z, 0-9 and hyphens, starting with a letter or digit. */
export const SLUG_SEGMENT = '[a-z0-9][a-z0-9-]{0,59}';

/** vercel.json's rewrite source for a profile, `/<handle>`. */
export const PROFILE_SOURCE = `/(${HANDLE_SEGMENT})`;

/** vercel.json's rewrite source for a booking page, `/<handle>/<slug>`. */
export const PAGE_SOURCE = `/(${HANDLE_SEGMENT})/(${SLUG_SEGMENT})`;

/** vercel.json's header source for both: the booking page's policy (any site may frame it, as `/b/<key>`). */
export const HANDLE_HEADER_SOURCE = `/(${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?)`;

/** vercel.json's app policy source: every path but the API, the public pages (hosted forms, booking pages) and the embed script. */
export const APP_HEADER_SOURCE = `/((?!api/|api$|f/|b/[^/]+$|embed/|${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?$).*)`;

/** A path vercel.json sends to book.html as a handle address, matched as Vercel anchors it. */
export const HANDLE_PATH = new RegExp(`^/${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?/?$`);

/**
 * The built files at the top level, from `apps/web/public` (its folders are `/brand/…`): served on every host.
 * `public-paths.test.ts` fails until this lists exactly what that folder holds.
 */
export const TOP_LEVEL_FILES: readonly string[] = ['embed.js', 'favicon.ico', 'theme-boot.js'];

/** A string matched as itself inside a regular expression. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What the public booking origin serves (BOOKING_PUBLIC_ORIGIN, timefix.com; 22 Oct 2026): the handle addresses,
 * `/b/…`, `/f/…`, `/embed/…`, the built files (`/assets/…`, `/brand/…` and `TOP_LEVEL_FILES`) and the public API,
 * `/api/public/…`. Nothing else belongs on that host.
 */
const PUBLIC_HOST_PATH = new RegExp(
  `^(?:/(?:b|f|embed|assets|brand)/.*|/api/public(?:/.*)?|/(?:${TOP_LEVEL_FILES.map(literal).join('|')})|/${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?/?)$`,
);

/** Whether `pathname` belongs on the public booking origin's host. */
export function servedOnPublicHost(pathname: string): boolean {
  return PUBLIC_HOST_PATH.test(pathname);
}

/**
 * middleware.ts's matcher, which Vercel reads from its source as a literal, so it is written out there: every path
 * but the built files, which belong on every host, so the edge runs only for the API and the pages (Vercel's path
 * syntax: the group is a regular expression). `middleware.test.ts` fails until the two say the same.
 */
export const MIDDLEWARE_MATCHER = `/((?!assets/|brand/|${TOP_LEVEL_FILES.map((file) => `${literal(file)}$`).join('|')}).*)`;

/** An https URL, or undefined for anything else (unset, empty, malformed or plain http). */
const httpsUrl = (value: string | undefined): URL | undefined => {
  if (value === undefined || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' ? url : undefined;
};

/**
 * Where a request on the public booking origin's host goes instead (a 308): the marketing site,
 * `PUBLIC_HOST_HOME_URL` (https://timefix.ai), for any path that doesn't belong there, `/` included. Undefined,
 * so nothing changes, for every other request, and whenever `PUBLIC_HOST_HOME_URL`, `BOOKING_PUBLIC_ORIGIN` or
 * `APP_URL` is unset or not https, or the public origin is the app's own or the marketing site's: the app's paths
 * then always stay where they are.
 */
export function publicHostRedirect(
  url: URL,
  env: {
    readonly PUBLIC_HOST_HOME_URL?: string | undefined;
    readonly BOOKING_PUBLIC_ORIGIN?: string | undefined;
    readonly APP_URL?: string | undefined;
  },
): string | undefined {
  const home = httpsUrl(env.PUBLIC_HOST_HOME_URL);
  const publicOrigin = httpsUrl(env.BOOKING_PUBLIC_ORIGIN);
  const app = httpsUrl(env.APP_URL);
  if (home === undefined || publicOrigin === undefined || app === undefined) return undefined;
  if (url.host !== publicOrigin.host || app.host === publicOrigin.host || home.host === publicOrigin.host) {
    return undefined;
  }
  return servedOnPublicHost(url.pathname) ? undefined : home.href;
}
