// A company's logo from our own origin (spec 0059, AC-5901 to AC-5907): `GET /api/logos/:domain`, the site's icon,
// fetched by us so the app's policy (`img-src 'self' data: blob:`) is unchanged and no request leaves the browser
// for the company's site (AC-5903). A company record's display names this path (`companyLogoPath` in core) only for
// a reader who may see its Domains (AC-5907).
//
// The answer is the same for everyone, a public site's public icon, so it is kept at the edge across workspaces and
// people: 7 days for an icon, a day for a miss, five minutes for a site that timed out (AC-5905). The session is
// asked for only so our server is nobody's free fetcher (AC-5906); no workspace is checked, since nothing in the
// answer is a workspace's. An answer about the person asking (no session, too many requests) is never kept at the
// edge, which would hand it to everyone. And no answer here sets a cookie, since a shared cache must never keep one:
// the session is read, never renewed.
//
// The order: the path (a public host name exactly as the display writes it, with no query, which would be another
// path at the edge and another fetch), then the session, then the person's limit, and only then the fetch, through
// the one outside door (`./public/favicon.ts` on `./public/outside.ts`, spec 0055 AC-5531). A miss logs its reason,
// never the domain.
import { errorStatus, type ErrorCode } from '@crm/contracts';
import { isLogoDomain, LOGO_PATH } from '@crm/core';
import type { Hono } from 'hono';
import type { Auth } from './auth/auth.ts';
import type { LimitRule, PublicLimiter } from './limits.ts';
import { log } from './log.ts';
import type { FaviconFetch } from './public/favicon.ts';
import { pictureResponse } from './public/picture.ts';

/** An icon: 7 days in the browser and at the edge, so a domain costs one fetch a region a week (AC-5905). */
export const LOGO_CACHE_CONTROL = 'public, max-age=604800, s-maxage=604800';

/** No icon, or an address that can't have one: a day, so a site that gains an icon shows it soon after. */
export const LOGO_MISS_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

/**
 * A site that didn't answer in time, or couldn't be reached: five minutes, so one slow moment doesn't hide a logo
 * for everyone for a day, while a site that is down still costs at most one fetch a region every five minutes.
 */
export const LOGO_RETRY_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

/** Misses that say nothing about the site's icon, only about this one try. */
const PASSING: ReadonlySet<string> = new Set(['timeout', 'network']);

/** An answer about the person asking: kept nowhere, above all not at the edge, which would give it to everyone. */
const PERSONAL = 'private, no-store';

/** At most 300 logo requests a minute for one signed in person (AC-5906): a full board of companies is a few dozen. */
export const LOGO_LIMIT: LimitRule = { max: 300, windowMs: 60_000 };

/** What the route needs: the session read, the icon fetch and the limiter. */
export interface LogoDeps {
  readonly auth: Pick<Auth, 'session'>;
  /** The site icon fetch preferring the head's icon sized for a logo (`createFaviconFetch({ prefer: 'logo' })`). */
  readonly logos: FaviconFetch;
  readonly limiter: PublicLimiter;
}

/** What the route reads off the request: as the app sets them. */
interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** A `{ code, message }` answer kept as `cacheControl` says, never sniffed. */
function refusal(
  code: ErrorCode,
  message: string,
  cacheControl: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { code, message },
    {
      status: errorStatus(code),
      headers: { 'cache-control': cacheControl, 'x-content-type-options': 'nosniff', ...headers },
    },
  );
}

/** No logo here: 404, kept as `cacheControl` says. The display draws the company's initial, as it does without one. */
const noLogo = (cacheControl: string): Response => refusal('NOT_FOUND', 'There’s no logo here.', cacheControl);

/** Mounts `GET /logos/:domain` on the api (under its `/api` base path, so `LOGO_PATH` plus the domain). */
export function mountLogos(app: Hono<{ Variables: Variables }>, deps: LogoDeps): void {
  app.get('/logos/:domain', async (c) => {
    const domain = c.req.param('domain');
    // One spelling per domain, as the display writes it: anything else (another case, an encoded dot, a query) is
    // another path at the edge, and would cost a fetch of its own.
    const url = new URL(c.req.url);
    if (!isLogoDomain(domain) || url.pathname !== `${LOGO_PATH}${domain}` || url.search !== '') {
      return noLogo(LOGO_MISS_CACHE_CONTROL);
    }
    // Read, never renewed: a renewed session's cookie can't ride on an answer the edge keeps for everyone.
    const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'), { renew: false });
    if (session === undefined) return noLogo(PERSONAL);
    const decision = deps.limiter(`logos:${session.user.id}`, LOGO_LIMIT);
    if (!decision.allowed) {
      // Kept in this person's browser until they may ask again, so a row scrolled back into view doesn't ask again.
      const wait = String(decision.retryAfterSeconds);
      return refusal('RATE_LIMITED', 'Too many requests. Wait a moment and try again.', `private, max-age=${wait}`, {
        'retry-after': wait,
      });
    }
    const fetched = await deps.logos(`https://${domain}/`);
    if (fetched.ok) return pictureResponse(fetched, LOGO_CACHE_CONTROL);
    // Why, never the domain: it is a workspace's data.
    log.warn('logos.missed', { requestId: c.get('requestId'), reason: fetched.reason });
    return noLogo(PASSING.has(fetched.reason) ? LOGO_RETRY_CACHE_CONTROL : LOGO_MISS_CACHE_CONTROL);
  });
}
