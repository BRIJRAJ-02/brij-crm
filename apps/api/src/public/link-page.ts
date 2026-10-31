// A link page's public reads beyond the page itself (spec 0061), outside the RPC router, with no session:
//
//   GET /api/public/profiles/:handle/images/:imageId        a picture a live block of that page uses (AC-6101, AC-6129)
//   GET /api/public/profiles/:handle/items/:itemId/times    ?tz: a next times block's next open times (AC-6110)
//   GET /api/public/sitemap-handles.xml                     ?after: the handles search engines may list (AC-6123)
//   GET /api/public/robots.txt                              the public origin's robots file, naming the sitemap
//
// Under `/profiles/:handle/…`, never `/handles/:handle/…`, which already means a booking page by its slug. Every read
// goes through the door (`enterLinkImage`, `enterTimesBlock`, `listSitemapHandles`): a picture only while a live
// block of that very page names it, times only for a live times block whose page a visitor may book now. A miss is
// one 404 whatever the reason, never cached. What the edge keeps is filed under the page's tag (spec 0058, AC-23),
// so its Private switch deletes it. Nothing here sets a cookie or keeps an address.
import {
  HANDLE_PATTERN,
  linkPageCacheTags,
  PROFILE_TIMES_DAYS,
  PROFILE_TIMES_SHOWN,
  TimeZoneName,
  type ErrorCode,
  type PublicProfileTimes,
} from '@crm/contracts';
import {
  enterLinkImage,
  enterTimesBlock,
  isUuid,
  listSitemapHandles,
  readPublicSlots,
  readTimesPage,
  type PublicBookingDeps,
} from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Env, Hono } from 'hono';
import { loadStoredImage } from '../brand-logo.ts';
import type { EdgeCache } from '../edge-cache.ts';
import type { FileStore } from '../storage/blob.ts';
import type { LimitRule } from './limits.ts';

/** A picture's cache: a day, at the edge too, since an id never changes what it names (AC-6101). */
export const LINK_IMAGE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';
/** A private page's picture is its owner's alone: kept by their browser, never the edge. */
const PRIVATE_IMAGE_CACHE_CONTROL = 'private, max-age=300';
/** A times read: a minute, so a burst of visitors costs one slots read (AC-6110). */
export const TIMES_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
/** The sitemap and robots: an hour (AC-6123). */
export const CRAWL_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';
/** How many handles one sitemap file lists before an index splits them (AC-6123). */
export const SITEMAP_SPLIT = 50_000;

/** What these routes need, handed in by `mountPublicBooking`. */
export interface LinkPageRouteDeps<E extends Env> {
  readonly db: Database;
  /** What the slots engine reads with: the same as the booking page's own slots read. */
  readonly slots: PublicBookingDeps;
  readonly files: FileStore | undefined;
  readonly edgeCache: EdgeCache | undefined;
  /** The public origin a link page lives on: the sitemap's addresses and robots' sitemap line. */
  readonly publicOrigin: string;
  readonly now: () => Date;
  /** The signed in person, so an owner sees their own private page's pictures. */
  readonly signedInAs: (c: Context<E>) => Promise<string | undefined>;
  /** Answers 429 when a limit is spent, else undefined. */
  readonly limited: (checks: readonly (readonly [string, LimitRule])[]) => Response | undefined;
  /** The client address as a short hash: limits key on it, and no raw address is kept. */
  readonly addressOf: (c: Context<E>) => string;
  readonly answer: (code: ErrorCode, message: string) => Response;
  /** How many handles one sitemap file lists; tests pass a small one. */
  readonly sitemapSplit?: number;
}

/** The limits on these reads. */
export const LINK_PAGE_LIMITS = {
  imagesPerAddress: { max: 240, windowMs: 60_000 },
  imagesPerHandle: { max: 2_400, windowMs: 60_000 },
  timesPerAddress: { max: 60, windowMs: 60_000 },
  timesPerHandle: { max: 600, windowMs: 60_000 },
  crawlPerAddress: { max: 30, windowMs: 60_000 },
} as const satisfies Readonly<Record<string, LimitRule>>;

/** Text escaped for XML: the five characters that could end a value or start markup. */
export function xmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** A sitemap of handles (AC-6123): each page's address and its last change, a day. */
export function sitemapXml(origin: string, rows: readonly { readonly handle: string; readonly changedAt: string }[]) {
  const urls = rows
    .map(
      (row) =>
        `<url><loc>${xmlText(`${origin}/${encodeURIComponent(row.handle)}`)}</loc><lastmod>${row.changedAt.slice(0, 10)}</lastmod></url>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

/** A sitemap index (AC-6123): one file per split, each named by the handle it starts after. */
export function sitemapIndexXml(origin: string, afters: readonly (string | undefined)[]) {
  const files = afters
    .map((after) => {
      const address = `${origin}/sitemap-handles.xml${after === undefined ? '?part=first' : `?after=${encodeURIComponent(after)}`}`;
      return `<sitemap><loc>${xmlText(address)}</loc></sitemap>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files}</sitemapindex>\n`;
}

/**
 * The public origin's robots file (AC-6123): every link page may be read, the app and the api may not, and the
 * handles' sitemap is named. A page set not to index says so on itself (`noindex`), which robots can't.
 */
export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /w/',
    'Disallow: /sign-in',
    'Disallow: /sign-up',
    'Disallow: /settings',
    'Disallow: /b/*/manage',
    'Disallow: /email-preferences',
    '',
    `Sitemap: ${origin}/sitemap-handles.xml`,
    '',
  ].join('\n');
}

/** Mounts the routes (the app's base path is `/api`). */
export function mountLinkPageRoutes<E extends Env>(app: Hono<E>, deps: LinkPageRouteDeps<E>): void {
  const missing = (message: string) => deps.answer('NOT_FOUND', message);
  const tagged = (current: string, asked: string) => deps.edgeCache?.tag(linkPageCacheTags(current, asked));

  // A picture of a link page (AC-6101, AC-6129). The id never changes what it names, so the path is its version and
  // a day of cache holds; a block that stops using it stops it answering, and the page's tag deletes the edge's copy.
  app.get('/public/profiles/:handle/images/:imageId', async (c) => {
    const handle = c.req.param('handle');
    const imageId = c.req.param('imageId');
    if (!HANDLE_PATTERN.test(handle) || !isUuid(imageId)) return missing('There’s no picture here.');
    // The whole query, exactly none: anything added would miss the edge's copy and cost a read each time.
    if (new URL(c.req.url).search !== '') return missing('There’s no picture here.');
    const refused = deps.limited([
      [`link-page:image:${deps.addressOf(c)}`, LINK_PAGE_LIMITS.imagesPerAddress],
      [`link-page:image-handle:${handle}`, LINK_PAGE_LIMITS.imagesPerHandle],
    ]);
    if (refused !== undefined) return refused;
    try {
      const viewer = await deps.signedInAs(c);
      const found = await enterLinkImage({ db: deps.db }, handle, imageId, viewer === undefined ? {} : { viewer });
      const stored = await loadStoredImage(deps.files, found.path, found.type);
      if (stored === undefined) return missing('There’s no picture here.');
      if (found.owner.isShown) tagged(found.owner.handle, handle);
      return new Response(new Uint8Array(stored.bytes), {
        headers: {
          'content-type': stored.type,
          'cache-control': found.owner.isShown ? LINK_IMAGE_CACHE_CONTROL : PRIVATE_IMAGE_CACHE_CONTROL,
          'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin',
          'content-security-policy': "default-src 'none'",
        },
      });
    } catch {
      return missing('There’s no picture here.');
    }
  });

  // A next times block's next open times (AC-6110): up to 6 starts over the next 14 days, for the page's first length,
  // in the visitor's zone (the chips are drawn there; the starts are UTC). The page's own rules decide, through the
  // same slots engine its booking page reads.
  app.get('/public/profiles/:handle/items/:itemId/times', async (c) => {
    const handle = c.req.param('handle');
    const itemId = c.req.param('itemId');
    if (!HANDLE_PATTERN.test(handle) || !isUuid(itemId)) return missing('There are no times here.');
    const zone = TimeZoneName.safeParse(c.req.query('tz'));
    if (!zone.success) return deps.answer('INPUT_INVALID', 'Send the time zone to show the times in.');
    const refused = deps.limited([
      [`link-page:times:${deps.addressOf(c)}`, LINK_PAGE_LIMITS.timesPerAddress],
      [`link-page:times-handle:${handle}`, LINK_PAGE_LIMITS.timesPerHandle],
    ]);
    if (refused !== undefined) return refused;
    try {
      const { owner, entry } = await enterTimesBlock({ db: deps.db }, handle, itemId);
      const from = deps.now();
      const to = new Date(from.getTime() + PROFILE_TIMES_DAYS * 86_400_000);
      const page = await readTimesPage(entry);
      const duration = page.durations[0];
      if (duration === undefined) return missing('There are no times here.');
      const slots = await readPublicSlots(entry, deps.slots, {
        from: from.toISOString(),
        to: to.toISOString(),
        duration,
        tz: zone.data,
      });
      tagged(owner.handle, handle);
      const body: PublicProfileTimes = {
        slug: page.slug,
        duration,
        starts: slots.slots.slice(0, PROFILE_TIMES_SHOWN).map((slot) => slot.start),
      };
      return Response.json(body, {
        headers: { 'cache-control': TIMES_CACHE_CONTROL, 'x-robots-tag': 'noindex' },
      });
    } catch {
      return missing('There are no times here.');
    }
  });

  // The handles search engines may list (AC-6123), split at 50,000 with an index file.
  app.get('/public/sitemap-handles.xml', async (c) => {
    const refused = deps.limited([[`link-page:crawl:${deps.addressOf(c)}`, LINK_PAGE_LIMITS.crawlPerAddress]]);
    if (refused !== undefined) return refused;
    const split = deps.sitemapSplit ?? SITEMAP_SPLIT;
    const after = c.req.query('after');
    const xml = (body: string) =>
      new Response(body, {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': CRAWL_CACHE_CONTROL },
      });
    if (after !== undefined || c.req.query('part') === 'first') {
      if (after !== undefined && !HANDLE_PATTERN.test(after)) return missing('There is no such sitemap.');
      const rows = await listSitemapHandles({ db: deps.db }, { ...(after === undefined ? {} : { after }), max: split });
      return xml(sitemapXml(deps.publicOrigin, rows));
    }
    // The whole list in one file while it fits; past it, an index naming each file by where it starts.
    const first = await listSitemapHandles({ db: deps.db }, { max: split + 1 });
    if (first.length <= split) return xml(sitemapXml(deps.publicOrigin, first));
    const afters: (string | undefined)[] = [undefined];
    let last = first[split - 1]?.handle;
    while (last !== undefined) {
      afters.push(last);
      const next = await listSitemapHandles({ db: deps.db }, { after: last, max: split + 1 });
      last = next.length > split ? next[split - 1]?.handle : undefined;
    }
    return xml(sitemapIndexXml(deps.publicOrigin, afters));
  });

  app.get('/public/robots.txt', (c) => {
    const refused = deps.limited([[`link-page:crawl:${deps.addressOf(c)}`, LINK_PAGE_LIMITS.crawlPerAddress]]);
    if (refused !== undefined) return refused;
    return new Response(robotsTxt(deps.publicOrigin), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': CRAWL_CACHE_CONTROL },
    });
  });
}
