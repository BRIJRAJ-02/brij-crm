// A link block's own icon, served from our own origin (the owner, 26 Oct 2026): the site's favicon, fetched by the
// api so the public pages' policy (`img-src 'self'`) is unchanged, exactly as an account picture is (`./picture.ts`).
// Nothing is stored: spec 0051 named this as later work "stored in R2 (#32)", and a few kilobytes behind a day of
// edge cache is cheaper than a bucket. The owner took that call on 26 October 2026.
//
// The fetch is `createOutsideFetch` (`./outside.ts`), the one door every read of an outside address goes through
// (spec 0055, AC-5531). This file is what an icon narrows it to: a plain https site (`isFaviconSite`), the five
// image types, and 128 kB. Unlike a picture there is no host allowlist, because the address is one a page owner
// saved; what bounds it is the route, which fetches only for a link block on a live page, rate limited per address
// and per handle. The door's own rules do the rest: every resolved address checked against the private, loopback,
// link local, unique local, multicast and carrier grade NAT ranges before the connection and after each redirect.
import { declaredIcon, faviconSources, imageTypeOf, isFaviconSite, type ImageType } from '@crm/core/public';
import { createOutsideFetch, type Lookup, type OutsideMiss } from './outside.ts';
import { pictureResponse } from './picture.ts';

/** The longest an icon may take, the page read and both fetches' redirects included. */
export const FAVICON_TIMEOUT_MS = 3000;
/** The largest icon read: a favicon is a few kilobytes, and a touch icon rarely more than thirty. */
export const FAVICON_MAX_BYTES = 128 * 1024;
/** The most of a page read looking for a declared icon. */
export const FAVICON_PAGE_MAX_BYTES = 64 * 1024;
/**
 * How long an icon is kept: a day, in the browser and at the edge. Its path is versioned (a link pointed somewhere
 * else is a new path), so the day only bounds how long an icon outlives the site's own change of mind.
 */
export const FAVICON_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

/**
 * The image types answered: a picture's four, and the icon file every site has served since 1999. This is core's
 * whole set (`ImageType`), because an icon may be any of them; a share image narrows the same reader further.
 */
export type IconType = ImageType;

/**
 * What is asked for and allowed back. `image/vnd.microsoft.icon` is the registered name and `image/x-icon` the one
 * most servers still send; both come back as `image/x-icon`, which every browser has always read.
 */
const ICON_TYPES: readonly string[] = [
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/** What a page read asks for, looking for a declared icon. */
const PAGE_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];

/** Why there is no icon, for the log. Never the address, which came from a person. */
export type FaviconMiss = OutsideMiss;

/** A fetched icon, or why there is none. */
export type FetchedIcon =
  | { readonly ok: true; readonly type: IconType; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: FaviconMiss };

/** Fetches one link's icon. Never throws. */
export type FaviconFetch = (link: string) => Promise<FetchedIcon>;

/**
 * Builds the icon fetch on the one outside door. It tries the site's own `/favicon.ico` first, which most sites
 * still answer and which costs one request; only when that misses does it read the page's head for a declared
 * icon and fetch that. So a site with an icon where browsers look costs one fetch, and a modern one costs three,
 * all on a cache miss only. `fetch` and `lookup` are the platform's unless a test passes its own.
 */
export function createFaviconFetch(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly lookup?: Lookup;
    readonly timeoutMs?: number;
  } = {},
): FaviconFetch {
  const read = createOutsideFetch({
    ...options,
    timeoutMs: options.timeoutMs ?? FAVICON_TIMEOUT_MS,
    maxBytes: FAVICON_MAX_BYTES,
  });

  /** One image address, answered only when its bytes begin as an image we serve. */
  const image = async (url: URL): Promise<FetchedIcon> => {
    const fetched = await read(url, { accept: ICON_TYPES, allow: isFaviconSite });
    if (!fetched.ok) return fetched;
    // What the bytes say, never the header's word: a great many sites serve a PNG as `image/x-icon`.
    const type = imageTypeOf(fetched.bytes);
    return type === undefined ? { ok: false, reason: 'type' } : { ok: true, type, bytes: fetched.bytes };
  };

  return async (link) => {
    const sources = faviconSources(link);
    if (sources === undefined) return { ok: false, reason: 'url' };
    const guessed = await image(sources.guess);
    if (guessed.ok) return guessed;
    const page = await read(sources.page, {
      accept: PAGE_TYPES,
      maxBytes: FAVICON_PAGE_MAX_BYTES,
      allow: isFaviconSite,
    });
    if (!page.ok) return page;
    const declared = declaredIcon(new TextDecoder().decode(page.bytes), sources.page);
    // Nothing declared: the first miss is the honest reason, since that is where an icon should have been.
    return declared === undefined ? guessed : await image(declared);
  };
}

/**
 * A fetched icon as our answer, through the same headers an account picture gets (`pictureResponse`): its own type
 * and length, a day of cache, never sniffed as anything else, for our own pages only, and inert on its own.
 */
export function iconResponse(icon: { readonly type: IconType; readonly bytes: Uint8Array }): Response {
  return pictureResponse(icon, FAVICON_CACHE_CONTROL);
}
