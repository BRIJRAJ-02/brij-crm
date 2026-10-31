// What a link page wears beyond its look's names (spec 0060, AC-10, AC-13, AC-14, AC-20, AC-22), from our own
// origin:
//   GET /api/public/handles/:handle/look.css?v=   its accent (its own, else its workspace's) and photo `url()`s
//   GET /api/public/profiles/:handle/cover?v=     its cover photo
//   GET /api/public/profiles/:handle/ground?v=    its photo ground
// The photos sit under `profiles`, as the picture does, since `cover` is a valid page slug. Each enters through the
// handle's own door (`findHandleOwner`), so a private page answers exactly as a handle nobody holds, to everyone but
// its owner, whose own copy is kept by their browser alone. Only the current version answers; the rest is 404
// `no-store`. An hour in the browser and at the edge, filed under the page's cache tag so its Private switch deletes
// it at once. Mounted before the booking routes, so `look.css` is never read as a page's slug.
import { HANDLE_PATTERN, linkPageCacheTags } from '@crm/contracts';
import { findHandleOwner, lookStylesheet, readHandleLook, type HandleOwner, type PageLook } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import type { Auth } from '../auth/auth.ts';
import { loadStoredImage } from '../brand-logo.ts';
import type { EdgeCache } from '../edge-cache.ts';
import { toApiError } from '../errors.ts';
import { log } from '../log.ts';
import type { FileStore } from '../storage/blob.ts';
import { addressKey, asksFor, nothingHere, stylesheetResponse, uncached } from './brand-css.ts';
import { BOOKING_LIMITS, type PublicLimiter } from './limits.ts';
import { PRIVATE_PICTURE_CACHE_CONTROL, pictureResponse } from './picture.ts';

/** How long a shown page's look stylesheet and photos are kept: an hour, purged by the page's cache tag. */
export const LOOK_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

/** What the routes need: the database, the private store, a limiter, sign in (an owner's private page) and the edge. */
export interface LookDeps {
  readonly db: Database;
  readonly files: FileStore | undefined;
  readonly limiter: PublicLimiter;
  readonly auth?: Auth;
  readonly edgeCache?: EdgeCache;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** The look a handle's public answer carries, or undefined; never fails the page. */
export async function handleLookAnswer(
  deps: { readonly db: Database },
  owner: HandleOwner,
): Promise<PageLook['answer']> {
  try {
    return (await readHandleLook(deps, owner)).answer;
  } catch (error) {
    log.warn('look.unread', { reason: error instanceof Error ? error.name : 'unknown' });
    return undefined;
  }
}

/** Mounts the link page's look routes. */
export function mountLook(app: Hono<{ Variables: Variables }>, deps: LookDeps): void {
  /** The signed in person on this request, or undefined: most visitors carry no cookie and cost no session read. */
  const viewerOf = async (c: Context<{ Variables: Variables }>): Promise<string | undefined> => {
    if (deps.auth === undefined || (c.req.header('cookie') ?? '') === '') return undefined;
    try {
      return (await deps.auth.session(c.req.raw.headers, c.get('clientIp')))?.user.id;
    } catch {
      return undefined;
    }
  };

  /** The page's owner and look, or the answer to send instead. */
  const lookOf = async (c: Context<{ Variables: Variables }>, what: string) => {
    const handle = c.req.param('handle') ?? '';
    if (!HANDLE_PATTERN.test(handle)) return nothingHere();
    for (const [name, rule] of [
      [`look:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
      [`look-handle:${what}:${handle}`, BOOKING_LIMITS.picturesPerTarget],
    ] as const) {
      const decision = deps.limiter(name, rule);
      if (!decision.allowed) return uncached('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    try {
      const viewer = await viewerOf(c);
      const owner = await findHandleOwner({ db: deps.db }, handle, viewer === undefined ? {} : { viewer });
      if (owner.isShown) deps.edgeCache?.tag(linkPageCacheTags(owner.handle, handle));
      return { owner, look: await readHandleLook({ db: deps.db }, owner) };
    } catch (error) {
      if (toApiError(error).expected) return nothingHere();
      throw error;
    }
  };

  app.get('/public/handles/:handle/look.css', async (c) => {
    const found = await lookOf(c, 'css');
    if (found instanceof Response) return found;
    if (!asksFor(c, found.look.answer?.version)) return nothingHere();
    const answer = stylesheetResponse(lookStylesheet(found.look, found.owner.handle));
    // An hour, as its photos and a booking page's brand stylesheet, filed under the page's cache tag, so its Private
    // switch purges it at once. A private page's look is its owner's
    // alone: their browser keeps it, never the edge.
    answer.headers.set('cache-control', found.owner.isShown ? LOOK_CACHE_CONTROL : PRIVATE_PICTURE_CACHE_CONTROL);
    return answer;
  });

  for (const slot of ['cover', 'ground'] as const) {
    app.get(`/public/profiles/:handle/${slot}`, async (c) => {
      const found = await lookOf(c, slot);
      if (found instanceof Response) return found;
      const image = found.look[slot];
      if (image === undefined || !asksFor(c, image.version)) return nothingHere();
      const loaded = await loadStoredImage(deps.files, image.path, image.type);
      if (loaded === undefined) {
        log.warn('look.image.missed', { requestId: c.get('requestId'), slot });
        return nothingHere();
      }
      return pictureResponse(loaded, found.owner.isShown ? LOOK_CACHE_CONTROL : PRIVATE_PICTURE_CACHE_CONTROL);
    });
  }
}
