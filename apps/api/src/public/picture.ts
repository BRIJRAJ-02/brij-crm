// A host's account picture, served from our own origin (the owner, 23 Oct 2026): the public pages' policy
// (img-src 'self') loads nothing from Google, so the api fetches the picture and answers it itself. The one outside
// call the picture routes make, behind one function (`createPictureFetch`), and the answer they give.
//
// Only a URL core's `accountPicture` gave is fetched: https on Google's picture hosts. A redirect is followed only
// to another such URL, at most twice; the whole fetch has 3 seconds and 1 MB, and only a JPEG, PNG, WebP or GIF
// whose first bytes say so is answered. The answer is cacheable and carries neither the Google URL nor anything of
// the account.
import { isPictureHost } from '@crm/core/public';

/** The longest a picture fetch may take, redirects included. */
export const PICTURE_TIMEOUT_MS = 3000;
/** The largest picture read: Google's 256px squares are a few kilobytes. */
export const PICTURE_MAX_BYTES = 1024 * 1024;
/** The most redirects followed, each to Google's picture hosts only. */
const PICTURE_REDIRECTS = 2;
/** How long a picture is kept: an hour in the browser, a day at the edge. */
export const PICTURE_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/** The image types answered. */
export type PictureType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const PICTURE_TYPES: ReadonlySet<string> = new Set<PictureType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Why a picture wasn't fetched, for the log (never the URL). */
export type PictureMiss = 'status' | 'redirect' | 'type' | 'size' | 'timeout' | 'network';

/** A fetched picture, or why there is none. */
export type FetchedPicture =
  | { readonly ok: true; readonly type: PictureType; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: PictureMiss };

/** Fetches one account picture URL (one `accountPicture` gave). Never throws. */
export type PictureFetch = (url: URL) => Promise<FetchedPicture>;

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const miss = (reason: PictureMiss): FetchedPicture => ({ ok: false, reason });

/** The media type of a `content-type` header when it is one of ours, else undefined. */
function pictureType(header: string | null): PictureType | undefined {
  const type = header?.split(';')[0]?.trim().toLowerCase() ?? '';
  return PICTURE_TYPES.has(type) ? (type as PictureType) : undefined;
}

/** Whether the bytes begin as `type` does (its file signature), so nothing else is ever served as an image. */
export function startsAs(type: PictureType, bytes: Uint8Array): boolean {
  const at = (offset: number, ...expected: readonly number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  switch (type) {
    case 'image/jpeg':
      return at(0, 0xff, 0xd8, 0xff);
    case 'image/png':
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/gif':
      return at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37, 0x61) || at(4, 0x39, 0x61));
    case 'image/webp':
      return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  }
}

/** The body, or undefined once it passes `max` bytes (the rest is never read). */
async function readCapped(response: Response, max: number): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read: { readonly done: boolean; readonly value?: unknown } = await reader.read();
    if (read.done) break;
    // A body is bytes; anything else, or more than the cap, ends the read.
    const value = read.value instanceof Uint8Array ? read.value : undefined;
    size += value?.byteLength ?? max + 1;
    if (value === undefined || size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

/** Builds the picture fetch: `fetch` is the platform's unless a test passes its own. */
export function createPictureFetch(
  options: { readonly fetch?: typeof globalThis.fetch; readonly timeoutMs?: number; readonly maxBytes?: number } = {},
): PictureFetch {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? PICTURE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PICTURE_MAX_BYTES;
  return async (start) => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      let url = start;
      for (let hop = 0; hop <= PICTURE_REDIRECTS; hop += 1) {
        if (!isPictureHost(url)) return miss('redirect');
        // No cookie, no credential, no Referer: a plain GET of a public picture.
        const response = await send(url, {
          redirect: 'manual',
          signal,
          headers: { accept: [...PICTURE_TYPES].join(',') },
        });
        if (REDIRECTS.has(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (location === null || !URL.canParse(location, url.href)) return miss('redirect');
          url = new URL(location, url);
          continue;
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          return miss('status');
        }
        const type = pictureType(response.headers.get('content-type'));
        const declared = Number(response.headers.get('content-length') ?? '0');
        if (type === undefined || declared > maxBytes) {
          await response.body?.cancel();
          return miss(type === undefined ? 'type' : 'size');
        }
        const bytes = await readCapped(response, maxBytes);
        if (bytes === undefined) return miss('size');
        return startsAs(type, bytes) ? { ok: true, type, bytes } : miss('type');
      }
      return miss('redirect');
    } catch {
      return miss(signal.aborted ? 'timeout' : 'network');
    }
  };
}

/**
 * A fetched picture as our answer: its own type and length, cacheable (an hour in the browser, a day at the edge),
 * never sniffed as anything else, for our own pages only, and inert if opened on its own.
 */
export function pictureResponse(picture: { readonly type: PictureType; readonly bytes: Uint8Array }): Response {
  return new Response(picture.bytes, {
    headers: {
      'content-type': picture.type,
      'content-length': String(picture.bytes.byteLength),
      'cache-control': PICTURE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-robots-tag': 'noindex',
    },
  });
}
