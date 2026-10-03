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

/** What the guard needs to decide: the secret (unset during the rollout) and where the API runs. */
export interface EdgeGuardOptions {
  readonly secret: string | undefined;
  readonly environment: AppEnvironment;
}

/** One guard per app: it admits or refuses each request, and knows which requests it trusted. */
export interface EdgeGuard {
  /** True when requests must carry the secret: it is set, and the API isn't running locally. */
  readonly enforced: boolean;
  /** True when the request may go on. A request it admits by the secret (or locally) is trusted for `clientIp`. */
  readonly admit: (request: Request) => boolean;
  /**
   * The caller's IP from `x-forwarded-for`, which Vercel's middleware replaced
   * with the address it saw. Undefined for a request the guard hasn't trusted:
   * before the guard ran on it, and always while the guard is off outside
   * local, since anyone could have sent the header then. Pass the same
   * `Request` the guard saw (a middleware that rebuilds it loses the mark).
   */
  readonly clientIp: (request: Request) => string | undefined;
}

/** Whether the guard refuses requests without the secret: set, and not local. */
export function isEdgeGuardEnforced({ secret, environment }: EdgeGuardOptions): boolean {
  return secret !== undefined && environment !== 'local';
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
    if (expected === undefined || presented === null) return false;
    return timingSafeEqual(digest(presented), expected);
  };

  return {
    enforced,
    admit(request) {
      if (!enforced) {
        // Locally there is no edge: Vite's proxy stands in, and sets no forwarded header.
        if (options.environment === 'local') trusted.add(request);
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
