// An Insights share link's page (spec 0067, AC-6720): `GET /api/public/insights` with the token in the
// `x-crm-insight-share` header (the page keeps it in its address's fragment, so no log or Referer holds it), numbers only, with no
// session and no cookie. The token names the workspace and the share and carries the secret whose SHA-256 is
// stored; the core answers NOT_FOUND alike for a malformed, wrong, revoked or expired link and a deleted workspace.
// Never a session, a name, an email, a host under Other or a free text answer. 30 reads a minute per address, so a
// guessing script learns nothing fast; the answer is never cached anywhere but this browser.
import { isRefusal } from '@crm/core';
import { readInsightShare } from '@crm/core/public';
import { ERROR_MAP } from '@crm/contracts';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import type { LimitRule, PublicLimiter } from '../limits.ts';
import { errorFields, log } from '../log.ts';
import { limitAddress } from './site.ts';

/** 30 reads a minute per address: a client checking their numbers, never a script trying tokens. */
export const INSIGHT_SHARE_LIMIT: LimitRule = { max: 30, windowMs: 60_000 };

/** What the route needs. */
export interface InsightShareDeps {
  readonly db: Database;
  readonly limiter: PublicLimiter;
  readonly now?: () => Date;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** The header a share link's token comes in. */
export const INSIGHT_SHARE_HEADER = 'x-crm-insight-share';

/** Mounts `GET /public/insights` on the app (`/api` is its base path). */
export function mountInsightShares(app: Hono<{ Variables: Variables }>, deps: InsightShareDeps): void {
  app.get('/public/insights', async (c: Context<{ Variables: Variables }>) => {
    const noStore = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' };
    const spent = deps.limiter(`insights:share:${limitAddress(c.get('clientIp'))}`, INSIGHT_SHARE_LIMIT);
    if (!spent.allowed) {
      return Response.json(
        { code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' },
        {
          status: ERROR_MAP.RATE_LIMITED.status,
          headers: { ...noStore, 'retry-after': String(spent.retryAfterSeconds) },
        },
      );
    }
    try {
      const shared = await readInsightShare(
        { db: deps.db },
        c.req.header(INSIGHT_SHARE_HEADER) ?? '',
        deps.now?.() ?? new Date(),
      );
      return Response.json(shared, { headers: noStore });
    } catch (error) {
      if (isRefusal(error)) {
        return Response.json(
          { code: 'NOT_FOUND', message: error.refusals[0]?.message ?? 'This link doesn’t open anything.' },
          { status: ERROR_MAP.NOT_FOUND.status, headers: noStore },
        );
      }
      log.error('insights.share.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      throw error;
    }
  });
}
