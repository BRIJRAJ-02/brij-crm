// Vercel Routing Middleware. It runs at the edge, before files and rewrites,
// for /api only. With API_ORIGIN_INTERNAL set it proxies the request to that
// API (Railway or Render); unset, the request goes on to the api's own Vercel
// Function in this project (spec 0045, apps/web/api/index.mjs). Either way the
// app and the API share one origin (host only cookies, no CORS), and either way
// the request carries the edge secret and the caller's address from here: the
// function, like a proxied API, admits only requests this middleware vouched for.
import { ipAddress, next, rewrite } from '@vercel/functions';

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

  const url = new URL(request.url);
  // Replace these, never append to them: a client can send its own values.
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const clientIp = ipAddress(request);
  if (clientIp === undefined) headers.delete('x-forwarded-for');
  else headers.set('x-forwarded-for', clientIp);
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
