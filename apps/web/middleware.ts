// Vercel Routing Middleware. It runs at the edge, before files and rewrites,
// for /api only, and proxies the request to the Railway API. The app and the
// API share one origin that way (host only cookies, no CORS).
import { geolocation, ipAddress, rewrite } from '@vercel/functions';

export const config = { matcher: ['/api', '/api/:path*'] };

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

export default function middleware(request: Request): Response {
  const origin = process.env.API_ORIGIN_INTERNAL;
  if (origin === undefined || origin === '') {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'This deployment has no API address set.' },
      { status: 503 },
    );
  }

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
  if (vouching && (!EDGE_SECRET_FORMAT.test(edgeSecret) || new URL(origin).protocol !== 'https:')) {
    return Response.json(
      { code: 'API_UNAVAILABLE', message: 'This deployment’s API settings are invalid.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
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

  return rewrite(new URL(url.pathname + url.search, origin), { request: { headers } });
}
