// The public booking addresses' routing (22 Oct 2026): `/<handle>` (a person's profile) and `/<handle>/<slug>` (one
// of their booking pages) load the public booking bundle (book.html), beside `/b/<key>`. A handle is never one of
// the app's own top level words (`RESERVED_HANDLES`), so the app's routes, the API and the built files keep their
// paths. vercel.json can't import, so it holds these patterns as text: `public-paths.test.ts` fails until its
// rewrites and headers say exactly what this file builds, and until every top level route is a reserved word.
import { RESERVED_HANDLES } from '@crm/contracts/handles';
import { SESSION_HINT_COOKIE, SESSION_HINT_PRESENT } from './src/features/auth/parent-hint.ts';

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

/**
 * The share card's own path, `/api/public/handles/<handle>/card.png` (spec 0055, AC-5510). It sits under the public
 * API's prefix, so one origin serves it and the public host already allows it, but this project's own function
 * draws it (`api/card.mjs`), never the API: the middleware leaves it alone and vercel.json's rewrite takes it.
 */
export const CARD_PATH = /^\/api\/public\/handles\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/card\.png$/;
/**
 * The band across an Apple Wallet pass, `/api/public/handles/<handle>/pass-strip.png` (the owner, 26 October
 * 2026). Drawn by the same function as the card, for the same reason, and left alone by the middleware the same
 * way: the API has no font and no renderer, and this project already has both.
 */
export const STRIP_PATH = /^\/api\/public\/handles\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/pass-strip\.png$/;

/** A path vercel.json sends to book.html as a handle address, matched as Vercel anchors it. */
export const HANDLE_PATH = new RegExp(`^/${HANDLE_SEGMENT}(?:/${SLUG_SEGMENT})?/?$`);

/**
 * The built files at the top level, served on every host: those in `apps/web/public` (its folders are `/brand/…`)
 * and the layer order stylesheet the build writes beside the pages (`LAYER_ORDER_FILE`, `@crm/ui/vite`), which every
 * page links. `public-paths.test.ts` and `build.test.ts` fail until this lists exactly those.
 */
export const TOP_LEVEL_FILES: readonly string[] = ['embed.js', 'favicon.ico', 'layers.css', 'theme-boot.js'];

/** A string matched as itself inside a regular expression. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What the public booking origin serves (BOOKING_PUBLIC_ORIGIN, timefix.com; 22 Oct 2026): the handle addresses,
 * `/b/…`, `/f/…`, `/embed/…`, the built files (`/assets/…`, `/brand/…` and `TOP_LEVEL_FILES`, `/layers.css` among them) and the public API,
 * `/api/public/…`. Nothing else belongs on that host. middleware.ts holds the same pattern written out (it can't
 * import this file), and middleware.test.ts keeps the two equal.
 */
export const PUBLIC_HOST_PATH = new RegExp(
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
 * The query the apex's home honours to stay on the marketing site, `https://timefix.com/?stay=1` (25 Oct 2026).
 * Without it a browser holding the session hint is always sent to the app, so this is the way back for someone
 * signed in who wants to read the marketing pages; `https://www.timefix.com/` is the other, since the marketing
 * host is its own deployment and never passes through here.
 */
export const STAY_PARAM = 'stay';

/**
 * Where a request on the public booking origin's host goes, and whether that answer was read off the request's
 * cookies, which decides how it may be cached: an answer that depends on a cookie is never cached for everyone.
 */
export type PublicHostMove = {
  /** The address to move to. */
  readonly location: string;
  /** Whether the session hint cookie was read to decide it, so the answer is this browser's alone. */
  readonly onCookie: boolean;
};

/** Whether a request's `cookie` header carries the parent domain session hint (`parent-hint.ts`). */
export function hasSessionHint(cookie: string | undefined): boolean {
  if (cookie === undefined || cookie === '') return false;
  return cookie.split(';').some((pair) => {
    const at = pair.indexOf('=');
    if (at < 0) return false;
    return pair.slice(0, at).trim() === SESSION_HINT_COOKIE && pair.slice(at + 1).trim() === SESSION_HINT_PRESENT;
  });
}

/**
 * Where a request on the public booking origin's host goes instead: the marketing site, `PUBLIC_HOST_HOME_URL`
 * (https://www.timefix.com), for any path that doesn't belong there, `/` included. Undefined, so nothing changes,
 * for every other request, and whenever `PUBLIC_HOST_HOME_URL`, `BOOKING_PUBLIC_ORIGIN` or `APP_URL` is unset or
 * not https, or the public origin is the app's own or the marketing site's: the app's paths then always stay
 * where they are.
 *
 * The apex's home alone is read against the session hint cookie (25 Oct 2026, the owner: "if I am already logged
 * in and I go to timefix.com, it should just detect and take me to the dashboard"): with the hint the browser
 * goes to the app, `APP_URL`, and without it to the marketing site as before. `?stay=1` (`STAY_PARAM`) skips the
 * cookie and keeps the marketing site, so being signed in is never a one way door. Every other path is untouched:
 * a handle address, `/b/`, `/f/`, `/embed/`, a built file and `/api/public/` all stay exactly where they are, so
 * someone opening a booking page is never thrown into the app, signed in or not.
 */
export function publicHostRedirect(
  url: URL,
  env: {
    readonly PUBLIC_HOST_HOME_URL?: string | undefined;
    readonly BOOKING_PUBLIC_ORIGIN?: string | undefined;
    readonly APP_URL?: string | undefined;
  },
  cookie?: string,
): PublicHostMove | undefined {
  const home = httpsUrl(env.PUBLIC_HOST_HOME_URL);
  const publicOrigin = httpsUrl(env.BOOKING_PUBLIC_ORIGIN);
  const app = httpsUrl(env.APP_URL);
  if (home === undefined || publicOrigin === undefined || app === undefined) return undefined;
  if (url.host !== publicOrigin.host || app.host === publicOrigin.host || home.host === publicOrigin.host) {
    return undefined;
  }
  if (servedOnPublicHost(url.pathname)) return undefined;
  if (url.pathname === '/' && !url.searchParams.has(STAY_PARAM)) {
    return { location: hasSessionHint(cookie) ? new URL('/', app).href : home.href, onCookie: true };
  }
  return { location: home.href, onCookie: false };
}

/**
 * Where a handle address asked for on the app's own host goes instead (a 308): the same path on the public
 * booking origin (24 Oct 2026), so a person's profile and booking pages read one address, not two. Only a handle
 * address moves, so the API, the built files and the app's own routes (a handle is never a reserved word) stay
 * where they are. Undefined, so nothing changes, on any other host, and whenever `APP_URL` or
 * `BOOKING_PUBLIC_ORIGIN` is unset, not https, or the two name the same host: a preview and local development,
 * which have no booking origin of their own, go on serving the handle addresses themselves.
 */
export function handleHostRedirect(
  url: URL,
  env: {
    readonly BOOKING_PUBLIC_ORIGIN?: string | undefined;
    readonly APP_URL?: string | undefined;
  },
): string | undefined {
  const app = httpsUrl(env.APP_URL);
  const publicOrigin = httpsUrl(env.BOOKING_PUBLIC_ORIGIN);
  if (app === undefined || publicOrigin === undefined) return undefined;
  if (url.host !== app.host || app.host === publicOrigin.host) return undefined;
  return HANDLE_PATH.test(url.pathname) ? `${publicOrigin.origin}${url.pathname}${url.search}` : undefined;
}
