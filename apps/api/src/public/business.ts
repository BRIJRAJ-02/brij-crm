// The public business page (spec 0066, B4 lite), outside the RPC router: no session, the business handle is the only
// key, and only what was published is ever read.
//
//   GET /api/public/business/:handle                   the page at `/<handle>` (its first place)
//   GET /api/public/business/:handle/:place             the page at `/<handle>/<place-slug>`
//   GET /api/public/business/:handle/photos/:id         one picture of the published gallery
//   GET /api/public/business/:handle/look/brand.css?v=  the workspace's accent, light and dark
//   GET /api/public/business/:handle/look/logo?v=       the workspace's logo
//
// Every answer is filed at the edge under `business:<opaque id>` (never the workspace's id; and the page under
// `place:<id>` too), so Publish, a new address or slug, turning the apps off and a change to the business or a place delete every copy at once (AC-6816); the short
// `s-maxage` bounds a copy a purge missed. A miss of any kind is one 404, never cached, so nothing tells a private
// business from no business. Per client address and per handle limits stand in front of every read.
import { errorStatus, HANDLE_PATTERN, PLACE_SLUG_PATTERN, type ErrorCode } from '@crm/contracts';
import {
  businessCacheTags,
  enterBusinessPage,
  publicBusinessBrand,
  publicBusinessPhoto,
  type MenuSource,
} from '@crm/core';
import { brandStylesheet } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { loadStoredImage } from '../brand-logo.ts';
import type { EdgeCache } from '../edge-cache.ts';
import { toApiError } from '../errors.ts';
import { log } from '../log.ts';
import type { FileStore } from '../storage/blob.ts';
import { addressKey, asksFor, BRAND_CACHE_CONTROL, stylesheetResponse } from './brand-css.ts';
import { BOOKING_LIMITS, type PublicLimiter } from './limits.ts';
import { pictureResponse } from './picture.ts';

/**
 * How long the page's answer is kept: a minute fresh at the edge (Publish and every relevant change purge it before
 * that), five minutes stale while a new copy is fetched, and never in the browser, so a visitor's reload is current.
 */
export const BUSINESS_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

/** A published picture never changes under its id: a day in the browser and at the edge, purged with the page. */
export const BUSINESS_PHOTO_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

/** What the routes need. */
export interface PublicBusinessDeps {
  readonly db: Database;
  readonly files: FileStore | undefined;
  readonly limiter: PublicLimiter;
  readonly edgeCache?: EdgeCache;
  /** A place's published menu (0065 H1); none until the Menu app's menus land. */
  readonly menus?: MenuSource;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** A `{ code, message }` answer, never cached. */
function refused(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code), headers: { 'cache-control': 'no-store' } });
}

const nothing = () => refused('NOT_FOUND', 'There’s no page at this address.');

/** Mounts the business page's public routes. */
export function mountPublicBusiness(app: Hono<{ Variables: Variables }>, deps: PublicBusinessDeps): void {
  /** The limits every read passes, by client address and by handle; a spent one answers the refusal. */
  const limited = (c: Context<{ Variables: Variables }>, handle: string): Response | undefined => {
    for (const [name, rule] of [
      [`business:read:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress],
      [`business:handle:${handle}`, BOOKING_LIMITS.readsPerPage],
    ] as const) {
      if (!deps.limiter(name, rule).allowed)
        return refused('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    return undefined;
  };

  // The brand and the pictures first, so `look` and `photos` are never read as a place's slug.
  app.get('/public/business/:handle/look/brand.css', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return nothing();
    const spent = limited(c, handle);
    if (spent !== undefined) return spent;
    const found = await publicBusinessBrand({ db: deps.db }, handle);
    if (found === undefined || !asksFor(c, found.brand.answer?.version)) return nothing();
    deps.edgeCache?.tag(businessCacheTags(found.workspaceId));
    return stylesheetResponse(brandStylesheet(found.brand));
  });

  app.get('/public/business/:handle/look/logo', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return nothing();
    const spent = limited(c, handle);
    if (spent !== undefined) return spent;
    const found = await publicBusinessBrand({ db: deps.db }, handle);
    const logo = found?.brand.logo;
    if (found === undefined || logo === undefined || !asksFor(c, logo.version)) return nothing();
    const loaded = await loadStoredImage(deps.files, logo.path, logo.type);
    if (loaded === undefined) return nothing();
    deps.edgeCache?.tag(businessCacheTags(found.workspaceId));
    return pictureResponse(loaded, BRAND_CACHE_CONTROL);
  });

  app.get('/public/business/:handle/photos/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return nothing();
    const spent = limited(c, handle);
    if (spent !== undefined) return spent;
    const found = await publicBusinessPhoto({ db: deps.db }, handle, c.req.param('id'));
    if (found === undefined) return nothing();
    const loaded = await loadStoredImage(deps.files, found.path, found.type);
    if (loaded === undefined) {
      log.warn('business_page.photo.missed', { requestId: c.get('requestId') });
      return nothing();
    }
    deps.edgeCache?.tag(businessCacheTags(found.workspaceId));
    return pictureResponse(loaded, BUSINESS_PHOTO_CACHE_CONTROL);
  });

  /** The page, for `/<handle>` or `/<handle>/<slug>`. */
  const page = async (c: Context<{ Variables: Variables }>, handle: string, slug?: string) => {
    if (!HANDLE_PATTERN.test(handle) || (slug !== undefined && !PLACE_SLUG_PATTERN.test(slug))) return nothing();
    const spent = limited(c, handle);
    if (spent !== undefined) return spent;
    try {
      const entry = await enterBusinessPage(
        { db: deps.db, ...(deps.menus === undefined ? {} : { menus: deps.menus }) },
        handle,
        slug,
      );
      deps.edgeCache?.tag(entry.page.tags);
      return Response.json(entry.page, {
        headers: {
          'cache-control': BUSINESS_CACHE_CONTROL,
          'x-content-type-options': 'nosniff',
          ...(entry.page.indexable ? {} : { 'x-robots-tag': 'noindex' }),
        },
      });
    } catch (error) {
      if (toApiError(error).expected) return nothing();
      throw error;
    }
  };

  app.get('/public/business/:handle', (c) => page(c, c.req.param('handle')));
  app.get('/public/business/:handle/:place', (c) => page(c, c.req.param('handle'), c.req.param('place')));
}
