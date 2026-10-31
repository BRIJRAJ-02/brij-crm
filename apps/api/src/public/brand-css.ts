// What a booking page and a hosted form wear of their workspace's brand (spec 0060, AC-4, AC-20, AC-22), from our
// own origin, so the pages' policy (`style-src 'self'`, `img-src 'self'`) is unchanged and no page needs an inline
// style:
//   GET /api/public/booking/:publicKey/brand.css?v=   the accent's custom properties, light and dark
//   GET /api/public/booking/:publicKey/logo?v=        the workspace's logo
//   GET /api/public/forms/:publicKey/brand.css?v=     the same for a hosted form
//   GET /api/public/forms/:publicKey/logo?v=
// Each enters through the page's or form's own door, so only that one workspace's kit is ever read. Only the current
// version answers (anything else is 404 `no-store`), so a cached copy is never one the page no longer wears, and
// the answer is kept an hour in the browser and at the edge, filed under the workspace's brand cache tag so a save
// purges it (`brandCacheTags`). 60 a minute per address and 600 per page, as the
// pictures. The stylesheet holds only hexes `brandVariables()` computed from a checked hex.
import { createHash } from 'node:crypto';
import {
  brandCacheTags,
  errorStatus,
  isBrandedPageKey,
  type BrandedPage,
  type ErrorCode,
  type PublicBrand,
} from '@crm/contracts';
import { enterPublicForm } from '@crm/core';
import { brandStylesheet, enterBookingPage, readBookingBrand, readFormBrand, type PageBrand } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { loadStoredImage } from '../brand-logo.ts';
import type { EdgeCache } from '../edge-cache.ts';
import { toApiError } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import type { FileStore } from '../storage/blob.ts';
import { BOOKING_LIMITS, type PublicLimiter } from './limits.ts';
import { pictureResponse } from './picture.ts';

/**
 * How long a booking page's or form's brand stylesheet or logo is kept: an hour, in the browser and at the edge, as a
 * link page's `look.css` is. The path is versioned, so a new kit is a new path at once, and the edge's copies are
 * filed under the workspace's brand cache tag, which a save of the kit, its logo or an own accent purges.
 */
export const BRAND_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

/** What the routes need: the database, the private store, a limiter and the edge cache its answers are filed in. */
export interface BrandCssDeps {
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

/** A `{ code, message }` answer, never cached. */
export function uncached(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code), headers: { 'cache-control': 'no-store' } });
}

/** Nothing here: 404, never cached. */
export const nothingHere = (): Response => uncached('NOT_FOUND', 'There’s nothing at this address.');

/** A stylesheet as our answer: CSS, versioned, nosniff, same origin. */
export function stylesheetResponse(css: string): Response {
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': BRAND_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'x-robots-tag': 'noindex',
    },
  });
}

/** The client address as a short hash, as the booking routes key it. */
export function addressKey(clientIp: string | undefined): string {
  return createHash('sha256')
    .update(clientIp ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}

/** Whether the whole query is exactly `?v=<version>`: anything added would miss the edge's copy. */
export function asksFor(c: Context, version: string | undefined): boolean {
  return version !== undefined && new URL(c.req.url).search === `?v=${version}`;
}

/** What a booking page's facts carry of its brand, or undefined; never fails the facts. */
export async function bookingBrandAnswer(
  entry: Parameters<typeof readBookingBrand>[0],
): Promise<PublicBrand | undefined> {
  try {
    return (await readBookingBrand(entry)).answer;
  } catch (error) {
    log.warn('brand.booking.unread', errorFields(error));
    return undefined;
  }
}

/** What a form's read carries of its brand, or undefined; never fails the form. */
export async function formBrandAnswer(entry: Parameters<typeof readFormBrand>[0]): Promise<PublicBrand | undefined> {
  try {
    return (await readFormBrand(entry)).answer;
  } catch (error) {
    log.warn('brand.form.unread', errorFields(error));
    return undefined;
  }
}

/** Mounts the booking pages' and forms' brand routes. */
export function mountBrandCss(app: Hono<{ Variables: Variables }>, deps: BrandCssDeps): void {
  const kinds = [
    {
      kind: 'booking',
      read: async (key: string) => {
        const entry = await enterBookingPage({ db: deps.db }, key);
        return { brand: await readBookingBrand(entry), workspaceId: entry.scope.workspaceId };
      },
    },
    {
      kind: 'forms',
      read: async (key: string) => {
        const entry = await enterPublicForm({ db: deps.db }, key);
        return { brand: await readFormBrand(entry), workspaceId: entry.scope.workspaceId };
      },
    },
  ] as const;

  /** The page's brand, or the answer to send instead: a bad key, a spent limit, or no such page. */
  const brandOf = async (
    c: Context<{ Variables: Variables }>,
    kind: BrandedPage,
    read: (key: string) => Promise<{ readonly brand: PageBrand; readonly workspaceId: string }>,
  ): Promise<PageBrand | Response> => {
    const key = c.req.param('publicKey') ?? '';
    // A key that can't be one never reaches the limiter's keys: a booking page's 16 characters, a form's address.
    if (!isBrandedPageKey(kind, key)) return nothingHere();
    for (const [name, rule] of [
      [`brand:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
      [`brand-page:${kind}:${key}`, BOOKING_LIMITS.picturesPerTarget],
    ] as const) {
      const decision = deps.limiter(name, rule);
      if (!decision.allowed) return uncached('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    try {
      const { brand, workspaceId } = await read(key);
      // Filed under the workspace's tag, so a save purges this copy at once; an answer refused below is `no-store`.
      deps.edgeCache?.tag(brandCacheTags(workspaceId));
      return brand;
    } catch (error) {
      if (toApiError(error).expected) return nothingHere();
      throw error;
    }
  };

  for (const { kind, read } of kinds) {
    app.get(`/public/${kind}/:publicKey/brand.css`, async (c) => {
      const brand = await brandOf(c, kind, read);
      if (brand instanceof Response) return brand;
      if (!asksFor(c, brand.answer?.version)) return nothingHere();
      return stylesheetResponse(brandStylesheet(brand));
    });

    app.get(`/public/${kind}/:publicKey/logo`, async (c) => {
      const brand = await brandOf(c, kind, read);
      if (brand instanceof Response) return brand;
      const { logo } = brand;
      if (logo === undefined || !asksFor(c, logo.version)) return nothingHere();
      const loaded = await loadStoredImage(deps.files, logo.path, logo.type);
      if (loaded === undefined) {
        log.warn('brand.logo.missed', { requestId: c.get('requestId'), kind });
        return nothingHere();
      }
      return pictureResponse(loaded, BRAND_CACHE_CONTROL);
    });
  }
}
