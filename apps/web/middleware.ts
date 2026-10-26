// Vercel Routing Middleware. It runs at the edge, before files and rewrites,
// for /api only. With API_ORIGIN_INTERNAL set it proxies the request to that
// API (Railway or Render); unset, the request goes on to the api's own Vercel
// Function in this project (spec 0045, apps/web/api/index.mjs). Either way the
// app and the API share one origin (host only cookies, no CORS), and either way
// the request carries the edge secret and the caller's address from here: the
// function, like a proxied API, admits only requests this middleware vouched for.
//
// It also keeps the public booking origin's host (BOOKING_PUBLIC_ORIGIN, timefix.com, served by this same
// deployment) to what belongs there: with PUBLIC_HOST_HOME_URL set, any other path on that host, `/` included,
// moves (308) to the marketing site. The other way round too (24 Oct 2026): a handle address asked for on the
// app's own host (APP_URL) moves (308) to the same path on the booking origin, so a profile and a booking page
// read one address, not two. So it runs for every path but the built files; any other request passes on
// untouched. A move may be cached for an hour, so a path that later joins the public host is reachable soon.
import { geolocation, ipAddress, next, rewrite } from '@vercel/functions';

// What the public booking origin's host serves, written out from public-paths.ts. Vercel compiles this file on its
// own and can't follow an import of the repo's TypeScript or of a workspace package (a deploy failed on one,
// 22 Oct 2026), so it imports nothing but @vercel/functions. middleware.test.ts fails until these say exactly what
// public-paths.ts builds, and until this file imports nothing else.

/** The handle words the app keeps for itself (RESERVED_HANDLES of 3 characters and more), longest first. */
export const RESERVED_WORDS =
  'email-preferences|availability|integrations|developers|reschedule|theme-boot|two-factor|dashboard|undefined|accounts|bookings|calendar|callback|captures|download|manifest|schedule|security|settings|sign-out|webhooks|account|billing|booking|contact|favicon|objects|pricing|privacy|profile|sign-in|sign-up|sitemap|support|timefix|welcome|assets|cancel|health|invite|logout|manage|public|robots|search|signin|signup|static|status|verify|about|admin|brand|email|embed|forms|inbox|index|legal|links|login|oauth|terms|users|apps|auth|blog|book|demo|docs|edit|form|help|home|join|mail|null|root|team|user|api|app|new|www';

/** A handle's path segment, never a reserved word, and a booking page's slug segment (public-paths.ts). */
const HANDLE = `(?!(?:${RESERVED_WORDS})(?:/|$))[a-z0-9][a-z0-9-]{1,38}[a-z0-9]`;
const SLUG = '[a-z0-9][a-z0-9-]{0,59}';

/** public-paths.ts's HANDLE_PATH: a handle address, `/<handle>` or `/<handle>/<slug>`, as Vercel anchors it. */
export const HANDLE_PATH = new RegExp(`^/${HANDLE}(?:/${SLUG})?/?$`);

/** public-paths.ts's CARD_PATH and STRIP_PATH: pictures under the public API's prefix, drawn by this project. */
export const CARD_PATH = /^\/api\/public\/handles\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/card\.png$/;
/**
 * The band across an Apple Wallet pass, `/api/public/handles/<handle>/pass-strip.png` (the owner, 26 October
 * 2026). Drawn by the same function as the card, for the same reason, and left alone by the middleware the same
 * way: the API has no font and no renderer, and this project already has both.
 */
export const STRIP_PATH = /^\/api\/public\/handles\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/pass-strip\.png$/;

/** public-paths.ts's PUBLIC_HOST_PATH: the handle addresses, /b/, /f/, /embed/, the built files and /api/public/. */
export const PUBLIC_HOST_PATH = new RegExp(
  `^(?:/(?:b|f|embed|assets|brand)/.*|/api/public(?:/.*)?|/(?:embed\\.js|favicon\\.ico|layers\\.css|theme-boot\\.js)|/${HANDLE}(?:/${SLUG})?/?)$`,
);

/** An https URL, or undefined for anything else (unset, empty, malformed or plain http). */
const httpsUrl = (value: string | undefined): URL | undefined => {
  if (value === undefined || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'https:' ? url : undefined;
};

/** parent-hint.ts's SESSION_HINT_COOKIE and SESSION_HINT_PRESENT: the parent domain hint, presence and nothing else. */
export const SESSION_HINT_COOKIE = 'tf_signed_in';
export const SESSION_HINT_PRESENT = '1';

/** public-paths.ts's STAY_PARAM: the query that keeps the apex's home on the marketing site. */
export const STAY_PARAM = 'stay';

/** public-paths.ts's PublicHostMove: where to go, and whether a cookie decided it (so it may never be cached). */
export type PublicHostMove = {
  readonly location: string;
  readonly onCookie: boolean;
};

/** public-paths.ts's hasSessionHint: whether this request carries the parent domain session hint. */
export function hasSessionHint(cookie: string | undefined): boolean {
  if (cookie === undefined || cookie === '') return false;
  return cookie.split(';').some((pair) => {
    const at = pair.indexOf('=');
    if (at < 0) return false;
    return pair.slice(0, at).trim() === SESSION_HINT_COOKIE && pair.slice(at + 1).trim() === SESSION_HINT_PRESENT;
  });
}

/**
 * public-paths.ts's publicHostRedirect: where a request on the public booking origin's host goes instead,
 * `PUBLIC_HOST_HOME_URL`, for any path that doesn't belong there, `/` included; undefined, so nothing changes, for
 * every other request, and whenever a setting is missing or not https, or the public origin is the app's own or
 * the home's. The apex's home alone reads the session hint cookie: with it the browser goes to `APP_URL` instead,
 * and `?stay=1` skips the cookie and keeps the marketing site.
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
  if (PUBLIC_HOST_PATH.test(url.pathname)) return undefined;
  if (url.pathname === '/' && !url.searchParams.has(STAY_PARAM)) {
    return { location: hasSessionHint(cookie) ? new URL('/', app).href : home.href, onCookie: true };
  }
  return { location: home.href, onCookie: false };
}

/**
 * public-paths.ts's handleHostRedirect: where a handle address asked for on the app's own host goes instead
 * (a 308), the same path on the public booking origin, so a profile and a booking page read one address, not
 * two; undefined for every other path and host, and whenever a setting is missing, not https, or the app's host
 * is the public origin's.
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

/** Every path but the built files, which belong on every host: public-paths.ts's MIDDLEWARE_MATCHER, written out. */
export const config = {
  matcher: ['/((?!assets/|brand/|embed\\.js$|favicon\\.ico$|layers\\.css$|theme-boot\\.js$).*)'],
};

/**
 * Whether a path is the API's: only these get the edge's headers, the proxy or the function. The share card is the
 * one exception under `/api/`: it is this project's own function, so it passes on to vercel.json's rewrite rather
 * than to an API that has no such route (spec 0055, AC-5510).
 */
const isApiPath = (pathname: string) =>
  (pathname === '/api' || pathname.startsWith('/api/')) && !CARD_PATH.test(pathname) && !STRIP_PATH.test(pathname);

/**
 * The header carrying the edge secret, which proves to the API that a request
 * came through here (spec 0005, the edge guard). The API checks it as
 * `EDGE_HEADER` in apps/api/src/edge.ts; the two must stay equal.
 */
export const EDGE_HEADER = 'x-crm-edge';

/**
 * The header carrying the browser's own Origin to the API. Vercel's rewrite
 * doesn't pass `origin` through intact, so the API reads the app's origin from
 * here, and believes it only on a request carrying the edge secret. Equal to
 * `ORIGIN_HEADER` in apps/api/src/edge.ts.
 */
export const ORIGIN_HEADER = 'x-crm-origin';

/**
 * Headers that would continue a caller's own trace in the API's monitoring
 * (spec 0010): its sampling decision and trace id. The browser sends none, so
 * any that arrive are dropped, never passed on.
 */
export const TRACE_HEADERS: readonly string[] = ['sentry-trace', 'baggage', 'traceparent'];

/**
 * The edge's own geo headers, which the API keeps on a new session (spec
 * 0033: "Chrome on macOS, Berlin, Germany"). Set here from what the edge
 * resolved for this request, never passed on from the client. Equal to
 * `GEO_COUNTRY_HEADER` and `GEO_CITY_HEADER` in apps/api/src/edge.ts.
 */
export const GEO_HEADERS = { country: 'x-vercel-ip-country', city: 'x-vercel-ip-city' } as const;

/** What an edge secret must look like: 32 or more printable ASCII characters, no spaces. */
const EDGE_SECRET_FORMAT = /^[\x21-\x7e]{32,}$/;

/** Vercel's environments outside development, where the API requires the edge secret. */
const DEPLOYED: ReadonlySet<string> = new Set(['preview', 'production']);

/** Where /api goes: the API at API_ORIGIN_INTERNAL when it is set, else this project's own function (spec 0045). */
export function apiTarget(env: { readonly API_ORIGIN_INTERNAL?: string | undefined }): 'proxy' | 'function' {
  const origin = env.API_ORIGIN_INTERNAL;
  return origin === undefined || origin === '' ? 'function' : 'proxy';
}

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  // One deployment answers on both hosts with opposite moves, so a cache that keeps one must keep it per host.
  // A move read off this browser's own cookie is nobody else's answer: it is never stored, it names `cookie` in
  // `vary` as well, and it is a 302, since a permanent move is exactly what a browser does remember.
  const moved = (move: PublicHostMove) =>
    new Response(null, {
      status: move.onCookie ? 302 : 308,
      headers: move.onCookie
        ? { location: move.location, 'cache-control': 'private, no-store', vary: 'cookie, host' }
        : { location: move.location, 'cache-control': 'public, max-age=3600', vary: 'host' },
    });
  const home = publicHostRedirect(url, process.env, request.headers.get('cookie') ?? undefined);
  if (home !== undefined) return moved(home);
  if (!isApiPath(url.pathname)) {
    // The API is never a handle address, and is answered below whatever happens, so it is never moved from here.
    const booking = handleHostRedirect(url, process.env);
    if (booking !== undefined) return moved({ location: booking, onCookie: false });
    return next();
  }

  const origin = process.env.API_ORIGIN_INTERNAL ?? '';
  const proxied = apiTarget(process.env) === 'proxy';

  // The secret travels to the API in a header, so only over https, and only a
  // value a header keeps intact (the API's EDGE_SECRET has the same rule).
  const edgeSecret = process.env.EDGE_SECRET;
  const vouching = edgeSecret !== undefined && edgeSecret !== '';
  // Outside development the API refuses a request without the secret, so a
  // deployment missing it answers here, plainly, instead of forwarding a
  // request bound to fail.
  if (!vouching && DEPLOYED.has(process.env.VERCEL_ENV ?? '')) {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'This deployment has no edge secret set.' },
      { status: 503 },
    );
  }
  // A proxied API must be https; the function is this deployment itself, so the secret never leaves Vercel.
  const insecureProxy = proxied && (!URL.canParse(origin) || new URL(origin).protocol !== 'https:');
  if (vouching && (!EDGE_SECRET_FORMAT.test(edgeSecret) || insecureProxy)) {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'This deployment’s API settings are invalid.' },
      { status: 503 },
    );
  }

  // Replace these, never append to them: a client can send its own values.
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const clientIp = ipAddress(request);
  if (clientIp === undefined) headers.delete('x-forwarded-for');
  else headers.set('x-forwarded-for', clientIp);
  // Roughly where the request came from, as the edge resolved it; the city travels percent encoded, as Vercel sends it.
  const { country, city } = geolocation(request);
  headers.delete(GEO_HEADERS.country);
  headers.delete(GEO_HEADERS.city);
  if (country !== undefined && country !== '') headers.set(GEO_HEADERS.country, country);
  if (city !== undefined && city !== '') headers.set(GEO_HEADERS.city, encodeURIComponent(city));
  // Only this middleware may vouch for a request: a client's own copy never
  // passes through, and none is sent while EDGE_SECRET is unset.
  if (vouching) headers.set(EDGE_HEADER, edgeSecret);
  else headers.delete(EDGE_HEADER);
  // The browser's Origin, copied where the rewrite keeps it; a client's own copy never passes through.
  const appOrigin = request.headers.get('origin');
  if (vouching && appOrigin !== null) headers.set(ORIGIN_HEADER, appOrigin);
  else headers.delete(ORIGIN_HEADER);
  for (const header of TRACE_HEADERS) headers.delete(header);

  if (!proxied) return next({ request: { headers } });
  return rewrite(new URL(url.pathname + url.search, origin), { request: { headers } });
}
