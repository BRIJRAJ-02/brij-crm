// What a link page wears beyond its look's names (spec 0060, AC-10, AC-13, AC-14, AC-20, AC-22), from our own
// origin:
//   GET /api/public/handles/:handle/look.css?v=   its accent (its own, else its workspace's) and photo `url()`s
//   GET /api/public/profiles/:handle/cover?v=     its cover photo
//   GET /api/public/profiles/:handle/ground?v=    its photo ground
//   GET /api/public/profiles/:handle/logo?v=      its workspace's logo, while the page has a site for it to link to
// The photos sit under `profiles`, as the picture does, since `cover` is a valid page slug. Each enters through the
// handle's own door (`findHandleOwner`), so a private page answers exactly as a handle nobody holds, to everyone but
// its owner, whose own copy is kept by their browser alone. Only the current version answers; the rest is 404
// `no-store`. Guests only ever get the published look (spec 0068, AC-6810); the signed in owner (the same check
// `?draft=1` makes) also gets their draft's, when the `?v=` asked for is the draft's, kept by their browser alone, so
// the editor's picker and phone show a cover that waits for Publish. An hour in the browser and at the edge, filed under the page's cache tag so its Private switch deletes
// it at once. Mounted before the booking routes, so `look.css` is never read as a page's slug.
import { brandCacheTags, HANDLE_PATTERN, linkPageCacheTags } from '@crm/contracts';
import {
  findHandleOwner,
  findLockupLogo,
  lookStylesheet,
  readHandleLook,
  type HandleOwner,
  type PageLook,
} from '@crm/core/public';
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

/**
 * The look a handle's public answer carries, or undefined; never fails the page. `draft` only for the owner's own
 * Preview (`?draft=1`, which the door honours for the signed in owner alone), so it names the draft's photos.
 */
export async function handleLookAnswer(
  deps: { readonly db: Database },
  owner: HandleOwner,
  which: 'draft' | 'published' = 'published',
): Promise<PageLook['answer']> {
  try {
    return (await readHandleLook(deps, owner, which)).answer;
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
      const look = await readHandleLook({ db: deps.db }, owner);
      // The signed in owner, as `?draft=1` checks it (spec 0068): their draft's look too, never anyone else's.
      const isOwner = viewer !== undefined && viewer === owner.userId;
      return { owner, look, ...(isOwner ? { draft: await readHandleLook({ db: deps.db }, owner, 'draft') } : {}) };
    } catch (error) {
      if (toApiError(error).expected) return nothingHere();
      throw error;
    }
  };

  app.get('/public/handles/:handle/look.css', async (c) => {
    const found = await lookOf(c, 'css');
    if (found instanceof Response) return found;
    const isPublished = asksFor(c, found.look.answer?.version);
    const look = isPublished ? found.look : asksFor(c, found.draft?.answer?.version) ? found.draft : undefined;
    if (look === undefined) return nothingHere();
    const answer = stylesheetResponse(lookStylesheet(look, found.owner.handle));
    // An hour, as its photos and a booking page's brand stylesheet, filed under the page's cache tag, so its Private
    // switch purges it at once. A private page's look, and an owner's draft, is its owner's alone: their browser
    // keeps it, never the edge.
    answer.headers.set(
      'cache-control',
      isPublished && found.owner.isShown ? LOOK_CACHE_CONTROL : PRIVATE_PICTURE_CACHE_CONTROL,
    );
    return answer;
  });

  for (const slot of ['cover', 'ground'] as const) {
    app.get(`/public/profiles/:handle/${slot}`, async (c) => {
      const found = await lookOf(c, slot);
      if (found instanceof Response) return found;
      const published = found.look[slot];
      const isPublished = asksFor(c, published?.version);
      // The owner's drafted photo (spec 0068): only for them, and only at the draft's own version.
      const drafted = found.draft?.[slot];
      const image = isPublished ? published : asksFor(c, drafted?.version) ? drafted : undefined;
      if (image === undefined) return nothingHere();
      const loaded = await loadStoredImage(deps.files, image.path, image.type);
      if (loaded === undefined) {
        log.warn('look.image.missed', { requestId: c.get('requestId'), slot });
        return nothingHere();
      }
      return pictureResponse(
        loaded,
        isPublished && found.owner.isShown ? LOOK_CACHE_CONTROL : PRIVATE_PICTURE_CACHE_CONTROL,
      );
    });
  }

  // The lockup's logo (3 Nov 2026): the workspace's brand kit logo, through the page's own door, and only while the
  // page has a site address, so it serves nothing the page doesn't draw. Filed under the page's tag and the
  // workspace's brand tag, so a Private switch or a new logo deletes the edge's copy at once.
  app.get('/public/profiles/:handle/logo', async (c) => {
    const handle = c.req.param('handle');
    if (!HANDLE_PATTERN.test(handle)) return nothingHere();
    for (const [name, rule] of [
      [`look:${addressKey(c.get('clientIp'))}`, BOOKING_LIMITS.picturesPerAddress],
      [`look-handle:logo:${handle}`, BOOKING_LIMITS.picturesPerTarget],
    ] as const) {
      const decision = deps.limiter(name, rule);
      if (!decision.allowed) return uncached('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    let found: Awaited<ReturnType<typeof findLockupLogo>>;
    try {
      const viewer = await viewerOf(c);
      found = await findLockupLogo({ db: deps.db }, handle, viewer === undefined ? {} : { viewer });
    } catch (error) {
      if (toApiError(error).expected) return nothingHere();
      throw error;
    }
    const { owner, logo } = found;
    if (logo === undefined || !asksFor(c, logo.version)) return nothingHere();
    if (owner.isShown)
      deps.edgeCache?.tag([...linkPageCacheTags(owner.handle, handle), ...brandCacheTags(owner.workspaceId)]);
    const loaded = await loadStoredImage(deps.files, logo.path, logo.type);
    if (loaded === undefined) {
      log.warn('look.logo.missed', { requestId: c.get('requestId') });
      return nothingHere();
    }
    return pictureResponse(loaded, owner.isShown ? LOOK_CACHE_CONTROL : PRIVATE_PICTURE_CACHE_CONTROL);
  });
}
