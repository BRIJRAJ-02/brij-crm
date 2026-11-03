// The guest menu's public routes (spec 0065, H1, AC-6528, AC-6531), no session, under /api:
//   GET /public/menu/:key                        the place's live snapshot, Sold out over it, and the header
//   GET /public/menu/:key/look.css?v=            the brand's accent as custom properties (the Warm preset's own
//                                                colours live in the page's stylesheet)
//   GET /public/menu/:key/logo?v=                the business's logo (the brand kit's)
//   GET /public/menu/:key/photos/:id/:size?v=    a photo the live snapshot shows, at 1200 or 400 pixels
// Each enters through the menu door (`crm_menu_by_key`: ids only, and only while the workspace is live, has early
// access and has Menu installed), so a key that names nothing, a malformed one and a removed app all answer the same
// 404 `no-store`. Answers are kept at the edge under the place's tag (`menu:<placeId>`) and the workspace's brand tag,
// so Publish, Sold out, a profile change, a brand change and removing the app purge them at once (Rules settled:
// Routes); the browser always asks again (max-age 0), so a guest on the page sees Sold out on the next read. 60 reads a
// minute per address, as the booking pages' reads.
import { brandCacheTags, menuCacheTags, MENU_KEY_PATTERN, type MenuPhotoSize } from '@crm/contracts';
import { brandStylesheet, enterMenuPage, readMenuPhoto, readPublicMenu, type MenuEntry } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { loadStoredImage } from '../brand-logo.ts';
import type { EdgeCache } from '../edge-cache.ts';
import { log } from '../log.ts';
import type { FileStore } from '../storage/blob.ts';
import { addressKey, asksFor, nothingHere, stylesheetResponse, uncached } from './brand-css.ts';
import { BOOKING_LIMITS, type PublicLimiter } from './limits.ts';
import { pictureResponse } from './picture.ts';

/**
 * The menu's read at the edge: the browser asks again every time (a dish just sold out shows on the next read), the
 * edge keeps it a day, purged by tag on every change that alters it.
 */
export const MENU_CACHE_CONTROL = 'public, max-age=0, s-maxage=86400';

/** A versioned photo or logo: a new one is a new path, so the browser keeps it a day and the edge a week. */
export const MENU_IMAGE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800';

/** What the routes need: the database, the private store, a limiter and the edge cache. */
export interface PublicMenuDeps {
  readonly db: Database;
  readonly files: FileStore | undefined;
  readonly limiter: PublicLimiter;
  readonly edgeCache?: EdgeCache;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

const SIZES: ReadonlySet<string> = new Set(['large', 'small']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Mounts the guest menu's routes. */
export function mountPublicMenu(app: Hono<{ Variables: Variables }>, deps: PublicMenuDeps): void {
  /** The place a key names, or the answer to send instead: a bad key, a spent limit, or nothing there. */
  const entryOf = async (
    c: Context<{ Variables: Variables }>,
    kind: 'read' | 'picture',
  ): Promise<MenuEntry | Response> => {
    const key = c.req.param('key') ?? '';
    // A key that can't be one never reaches the limiter's keys or the database.
    if (!MENU_KEY_PATTERN.test(key)) return nothingHere();
    const rules =
      kind === 'read'
        ? ([[`menu:read:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.readsPerAddress]] as const)
        : ([
            [`menu:picture:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
            [`menu:picture-key:${key}`, BOOKING_LIMITS.picturesPerTarget],
          ] as const);
    for (const [name, rule] of rules) {
      const decision = deps.limiter(name, rule);
      if (!decision.allowed) return uncached('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    const entry = await enterMenuPage({ db: deps.db }, key);
    if (entry === undefined) return nothingHere();
    return entry;
  };

  /** Files the answer under the place's and the brand's tags. */
  const tag = (entry: MenuEntry) =>
    deps.edgeCache?.tag([...menuCacheTags(entry.placeId), ...brandCacheTags(entry.workspaceId)]);

  app.get('/public/menu/:key', async (c) => {
    const entry = await entryOf(c, 'read');
    if (entry instanceof Response) return entry;
    const read = await readPublicMenu({ db: deps.db }, entry);
    // Before the first Publish there is no menu to show: the plain not found answer, never cached.
    if (read === undefined) return nothingHere();
    tag(entry);
    return Response.json(read.menu, {
      headers: { 'cache-control': MENU_CACHE_CONTROL, 'x-content-type-options': 'nosniff' },
    });
  });

  app.get('/public/menu/:key/look.css', async (c) => {
    const entry = await entryOf(c, 'picture');
    if (entry instanceof Response) return entry;
    const read = await readPublicMenu({ db: deps.db }, entry);
    if (read === undefined || !asksFor(c, read.menu.look)) return nothingHere();
    tag(entry);
    return stylesheetResponse(brandStylesheet(read.brand));
  });

  app.get('/public/menu/:key/logo', async (c) => {
    const entry = await entryOf(c, 'picture');
    if (entry instanceof Response) return entry;
    const read = await readPublicMenu({ db: deps.db }, entry);
    const logo = read?.brand.logo;
    if (logo === undefined || !asksFor(c, logo.version)) return nothingHere();
    const loaded = await loadStoredImage(deps.files, logo.path, logo.type);
    if (loaded === undefined) {
      log.warn('menu.logo.missed', { requestId: c.get('requestId') });
      return nothingHere();
    }
    tag(entry);
    return pictureResponse(loaded, MENU_IMAGE_CACHE_CONTROL);
  });

  app.get('/public/menu/:key/photos/:photoId/:size', async (c) => {
    const photoId = c.req.param('photoId');
    const size = c.req.param('size');
    const version = c.req.query('v') ?? '';
    if (!UUID.test(photoId) || !SIZES.has(size) || !/^[0-9a-f]{12}$/.test(version) || !asksFor(c, version)) {
      return nothingHere();
    }
    const entry = await entryOf(c, 'picture');
    if (entry instanceof Response) return entry;
    const photo = await readMenuPhoto({ db: deps.db }, entry, photoId, size as MenuPhotoSize, version);
    if (photo === undefined) return nothingHere();
    const loaded = await loadStoredImage(deps.files, photo.path, photo.type);
    if (loaded === undefined) {
      log.warn('menu.photo.missed', { requestId: c.get('requestId') });
      return nothingHere();
    }
    tag(entry);
    return pictureResponse(loaded, MENU_IMAGE_CACHE_CONTROL);
  });
}
