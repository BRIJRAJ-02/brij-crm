// The marketing site's beacon (spec 0047, AC-1627): one page shown, sent with
// `navigator.sendBeacon` as plain text from a site on `SITE_ORIGINS`. Kept as
// the path, the referring site's host, `utm_source`, the edge's country, a
// device class and a daily visitor id; the address and the user agent only go
// into that id. No cookie, no session, and nothing answered but 204.
import { SiteHit } from '@crm/contracts';
import type { Hono } from 'hono';
import type { SiteVisitInput } from '@crm/db';
import { deviceOf, isMachine, utcDay, visitorId } from '../analytics/visitor.ts';
import type { Geo } from '../edge.ts';
import type { PublicLimiter } from '../limits.ts';
import { errorFields, log } from '../log.ts';

/** Where the beacon posts. */
export const SITE_HIT_PATH = '/api/public/site/hit';

/** 60 hits a minute per address (AC-1627): a person reading fast, never a script. */
export const SITE_HIT_LIMIT = { max: 60, windowMs: 60_000 } as const;

/** The largest beacon body read: a path, a host and a source. */
const BODY_MAX = 2048;

/** What the route needs: the store's one write, the sites it takes, its limiter and key, and the clock. */
export interface SiteHitDeps {
  readonly record: (visit: SiteVisitInput) => Promise<void>;
  /** The marketing sites' origins (`SITE_ORIGINS`); empty, every hit is refused. */
  readonly origins: ReadonlySet<string>;
  readonly limiter: PublicLimiter;
  readonly visitorKey: Buffer;
  readonly keepAlive: (work: Promise<unknown>) => void;
  readonly now?: () => Date;
}

interface SiteVariables {
  requestId: string;
  clientIp: string | undefined;
  geo?: Geo;
  origin: string | undefined;
}

/** A path as kept: no query or fragment, printable, at most 200 characters, starting with `/`. */
export function cleanPath(raw: string): string | undefined {
  const path = raw.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/') || /[\s\p{C}]/u.test(path)) return undefined;
  return path.slice(0, 200);
}

/** A referring site's host as kept: lowercase, no `www.`, a plain host name, and never the site itself. */
export function cleanReferrer(raw: string | undefined, site: string): string | undefined {
  if (raw === undefined) return undefined;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 120) return undefined;
  return host === site.replace(/^www\./, '') ? undefined : host;
}

/** A `utm_source` as kept: lowercase letters, digits, dots, dashes and underscores, at most 60. */
export function cleanSource(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const source = raw.trim().toLowerCase();
  return /^[a-z0-9._-]{1,60}$/.test(source) ? source : undefined;
}

/** Mounts `POST /public/site/hit` on the api. The Origin check above it lets this path through to its own check. */
export function mountSiteHits(app: Hono<{ Variables: SiteVariables }>, deps: SiteHitDeps): void {
  app.post('/public/site/hit', async (c) => {
    const origin = c.get('origin');
    if (origin === undefined || !deps.origins.has(origin)) {
      return c.json(
        { code: 'FORBIDDEN_ORIGIN', message: 'This request came from an origin the API does not accept.' },
        403,
      );
    }
    const done = () => c.body(null, 204);
    const userAgent = c.req.header('user-agent');
    if (isMachine(userAgent) || userAgent === undefined) return done();
    const ip = c.get('clientIp');
    if (!deps.limiter(`site:${ip ?? 'unknown'}`, SITE_HIT_LIMIT).allowed) return done();
    const text = await c.req.text();
    if (text.length > BODY_MAX) return done();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return done();
    }
    const hit = SiteHit.safeParse(body);
    if (!hit.success) return done();
    const path = cleanPath(hit.data.path);
    if (path === undefined) return done();
    const site = new URL(origin).hostname;
    const referrer = cleanReferrer(hit.data.referrer, site);
    const source = cleanSource(hit.data.source);
    const country = c.get('geo')?.country;
    const visit: SiteVisitInput = {
      site,
      path,
      device: deviceOf(userAgent),
      visitor: visitorId(deps.visitorKey, {
        day: utcDay(deps.now?.() ?? new Date()),
        ip,
        userAgent,
        place: site,
      }),
      ...(referrer === undefined ? {} : { referrer }),
      ...(source === undefined ? {} : { source }),
      ...(country === undefined ? {} : { country }),
    };
    // Kept after the answer: the beacon never waits on the database.
    deps.keepAlive(
      deps.record(visit).catch((error: unknown) => {
        log.warn('site.hit.failed', { requestId: c.get('requestId'), ...errorFields(error) });
      }),
    );
    return done();
  });
}
