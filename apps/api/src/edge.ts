// The edge guard (spec 0005, thin #57). The API's Railway address is public,
// so Vercel's middleware sends a shared secret on every request it proxies, and
// the API refuses anything without it. Only then are the forwarded headers the
// middleware set (the client IP above all) worth believing.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppEnvironment } from '@crm/contracts';

/** The header Vercel's middleware puts the shared secret in. */
export const EDGE_HEADER = 'x-crm-edge';

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
    clientIp(request) {
      if (!trusted.has(request)) return undefined;
      const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      return first === undefined || first === '' ? undefined : first;
    },
  };
}
