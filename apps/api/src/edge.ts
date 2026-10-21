// The edge guard (spec 0005, thin #57). The API's Railway address is public,
// so Vercel's middleware sends a shared secret on every request it proxies, and
// the API refuses anything without it. Only then are the forwarded headers the
// middleware set (the client IP above all) worth believing.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppEnvironment } from '@crm/contracts';

/** The header Vercel's middleware puts the shared secret in. */
export const EDGE_HEADER = 'x-crm-edge';

/** The header Vercel's middleware copies the browser's Origin into (its rewrite doesn't keep `origin` intact). */
export const ORIGIN_HEADER = 'x-crm-origin';

/** The edge's geo headers (Vercel's), which the middleware forwards set by the edge itself (spec 0033). */
export const GEO_COUNTRY_HEADER = 'x-vercel-ip-country';
/** The city, percent encoded as Vercel sends it. */
export const GEO_CITY_HEADER = 'x-vercel-ip-city';

/** Roughly where a request came from, as the edge saw it: shown beside a session, never trusted for access. */
export interface Geo {
  /** A two letter country code. */
  readonly country?: string;
  readonly city?: string;
}

/** The longest city name kept. */
const MAX_CITY = 80;

/** A geo header pair as kept: a two letter country, and a decoded, printable city; anything else is dropped. */
export function readGeo(country: string | null, city: string | null): Geo | undefined {
  const code = country?.trim().toUpperCase();
  const place = decodeCity(city);
  const geo: Geo = {
    ...(code !== undefined && /^[A-Z]{2}$/.test(code) && code !== 'XX' ? { country: code } : {}),
    ...(place === undefined ? {} : { city: place }),
  };
  return geo.country === undefined && geo.city === undefined ? undefined : geo;
}

function decodeCity(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  // Letters, marks, spaces and the punctuation place names use; nothing that could draw on a page or in a log.
  const cleaned = text
    .replace(/[^\p{L}\p{M}\p{N} .,'’()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_CITY);
}

/** The health checks Railway calls straight, never through Vercel. Exact paths, so nothing else slips through. */
export const EDGE_OPEN_PATHS: ReadonlySet<string> = new Set(['/api/health', '/api/health/ready']);

/**
 * What the guard needs to decide: the secret and where the API runs. `ApiEnv`
 * requires the secret outside local; a guard built there without one refuses
 * everything but the health checks.
 */
export interface EdgeGuardOptions {
  readonly secret: string | undefined;
  readonly environment: AppEnvironment;
}

/** One guard per app: it admits or refuses each request, and knows which requests it trusted. */
export interface EdgeGuard {
  /** True when requests must carry the secret: everywhere but local. */
  readonly enforced: boolean;
  /** True when the request may go on. A request it admits by the secret (or locally) is trusted for `clientIp`. */
  readonly admit: (request: Request) => boolean;
  /**
   * The caller's IP from `x-forwarded-for`, which Vercel's middleware replaced
   * with the address it saw. Undefined for a request the guard hasn't trusted
   * (before the guard ran on it, or a health check it let through without the
   * secret). Pass the same `Request` the guard saw (a middleware that rebuilds
   * it loses the mark). It may not be an IP at all; callers that need one check.
   */
  readonly clientIp: (request: Request) => string | undefined;
  /**
   * The browser's Origin. Where the guard is enforced, only `x-crm-origin` on a
   * request it admitted by the secret (the middleware copied it there), and
   * never the request's own `origin`, so a request the middleware didn't vouch
   * for has none. Locally, the request's own `origin` (Vite's proxy keeps it).
   */
  readonly origin: (request: Request) => string | undefined;
  /**
   * Where the request came from (spec 0033), from the edge's geo headers,
   * only on a request the guard trusted (as `clientIp`); locally, whatever the
   * request carries, since nothing sets them there but a test.
   */
  readonly geo: (request: Request) => Geo | undefined;
}

/** Whether the guard refuses requests without the secret: everywhere but local. */
export function isEdgeGuardEnforced({ environment }: Pick<EdgeGuardOptions, 'environment'>): boolean {
  return environment !== 'local';
}

// Hashing both sides first gives equal lengths for timingSafeEqual, so the
// comparison takes the same time whatever was sent, including its length.
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Builds the guard for one app. */
export function createEdgeGuard(options: EdgeGuardOptions): EdgeGuard {
  const enforced = isEdgeGuardEnforced(options);
  const expected = options.secret === undefined ? undefined : digest(options.secret);
  const trusted = new WeakSet<Request>();

  const carriesSecret = (request: Request): boolean => {
    const presented = request.headers.get(EDGE_HEADER);
    // No secret outside local (ApiEnv refuses to boot so) admits nobody.
    if (expected === undefined || presented === null) return false;
    return timingSafeEqual(digest(presented), expected);
  };

  return {
    enforced,
    admit(request) {
      if (!enforced) {
        // Locally there is no edge: Vite's proxy stands in, and sets no forwarded header.
        trusted.add(request);
        return true;
      }
      if (EDGE_OPEN_PATHS.has(new URL(request.url).pathname)) return true;
      if (!carriesSecret(request)) return false;
      trusted.add(request);
      return true;
    },
    origin(request) {
      if (!enforced) return request.headers.get('origin') ?? undefined;
      if (!trusted.has(request)) return undefined;
      return request.headers.get(ORIGIN_HEADER) ?? undefined;
    },
    geo(request) {
      if (!trusted.has(request)) return undefined;
      return readGeo(request.headers.get(GEO_COUNTRY_HEADER), request.headers.get(GEO_CITY_HEADER));
    },
    clientIp(request) {
      if (!trusted.has(request)) return undefined;
      const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      return first === undefined || first === '' ? undefined : first;
    },
  };
}
