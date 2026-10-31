// A host's account picture, served from our own origin (the owner, 23 Oct 2026): the public pages' policy
// (img-src 'self') loads nothing from Google, so the api fetches the picture and answers it itself.
//
// The fetch itself is `createOutsideFetch` (`./outside.ts`), the one module every read of an address outside this
// product goes through (spec 0055, AC-5531). This file is what a picture narrows it to: Google's picture hosts
// and nothing else, before the first connection and after every redirect; a JPEG, PNG, WebP or GIF whose first
// bytes say so; and 1 MB rather than the smaller default. The answer carries neither the Google URL nor anything
// of the account.
import { isPictureHost, type PersonPicture } from '@crm/core/public';
import type { FileStore } from '../storage/blob.ts';
import { createOutsideFetch, type Lookup, type OutsideMiss } from './outside.ts';

/** The longest a picture fetch may take, redirects included. */
export const PICTURE_TIMEOUT_MS = 3000;
/** The largest picture read: Google's 256px squares are a few kilobytes. */
export const PICTURE_MAX_BYTES = 1024 * 1024;
/**
 * How long a public picture is kept: five minutes, in the browser and at the edge, with no stale copy served after.
 * Its path is versioned (a new picture is a new path), so the five minutes only bound how long a picture outlives its
 * page, its handle or its account. A link page switched Private deletes its copies at the edge at once (cache tags,
 * spec 0058 AC-23); the five minutes are the bound where that can't run, on a host with no tags or a failed purge.
 */
export const PICTURE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
/** The signed in person's own picture: their browser only, never the edge. */
export const PRIVATE_PICTURE_CACHE_CONTROL = 'private, max-age=3600';

/** The image types answered. */
export type PictureType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const PICTURE_TYPES: ReadonlySet<string> = new Set<PictureType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Why a picture wasn't fetched, for the log (never the URL): the outside fetch's reasons, which are its. */
export type PictureMiss = OutsideMiss;

/** A fetched picture, or why there is none. */
export type FetchedPicture =
  | { readonly ok: true; readonly type: PictureType; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: PictureMiss };

/**
 * Fetches one account picture URL (one `accountPicture` gave). Never throws. `types` narrows what is asked for (the
 * `accept` header): the vCard asks for JPEG or PNG, which every address book shows, never WebP.
 */
export type PictureFetch = (url: URL, options?: { readonly types?: readonly PictureType[] }) => Promise<FetchedPicture>;

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

/**
 * Builds the picture fetch on the one outside fetch: Google's picture hosts only (`isPictureHost`, checked there
 * before the first connection and again after every redirect, alongside its own address rules), the four image
 * types, and 1 MB. The bytes are then checked to begin as their type says, so nothing else is ever served as an
 * image. `fetch` and `lookup` are the platform's unless a test passes its own.
 */
export function createPictureFetch(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly lookup?: Lookup;
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
  } = {},
): PictureFetch {
  const read = createOutsideFetch({
    ...options,
    timeoutMs: options.timeoutMs ?? PICTURE_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? PICTURE_MAX_BYTES,
  });
  return async (start, wanted = {}) => {
    const types = wanted.types ?? ([...PICTURE_TYPES] as readonly PictureType[]);
    const fetched = await read(start, { accept: types, allow: isPictureHost });
    if (!fetched.ok) return fetched;
    const type = types.find((wantedType) => wantedType === fetched.type);
    if (type === undefined) return { ok: false, reason: 'type' };
    return startsAs(type, fetched.bytes) ? { ok: true, type, bytes: fetched.bytes } : { ok: false, reason: 'type' };
  };
}

/**
 * A fetched picture as our answer: its own type and length, cacheable (`PICTURE_CACHE_CONTROL` unless said), never
 * sniffed as anything else, for our own pages only, and inert if opened on its own.
 *
 * A link block's icon is answered through here too (`./favicon.ts`), which is why `image/x-icon` is among the
 * types: the headers that make an image we fetched safe to serve belong in one place. The type must always be one
 * the caller read from the bytes themselves, never one a server claimed.
 */
export function pictureResponse(
  picture: { readonly type: PictureType | 'image/x-icon'; readonly bytes: Uint8Array },
  cacheControl: string = PICTURE_CACHE_CONTROL,
): Response {
  return new Response(picture.bytes, {
    headers: {
      'content-type': picture.type,
      'content-length': String(picture.bytes.byteLength),
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-robots-tag': 'noindex',
    },
  });
}

/** The type a stored picture's extension names: the one its bytes were checked against when it was kept. */
const STORED_TYPES: Readonly<Record<string, PictureType>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The largest stored picture read back: the upload's own ceiling. */
const STORED_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Loads a person's picture of either kind (27 Oct 2026): Google's through `fetch`, narrowed to Google's hosts, or
 * their own upload from the private store. A stored one is checked again on the way out, its first bytes against the
 * type its path names, so nothing but a picture is ever answered as one. Never throws.
 */
export type PictureLoad = (
  picture: PersonPicture,
  options?: { readonly types?: readonly PictureType[] },
) => Promise<FetchedPicture>;

/** The loader every picture route answers through; `files` absent, a stored picture is simply missing. */
export function createPictureLoader(fetch: PictureFetch, files: FileStore | undefined): PictureLoad {
  return async (picture, options) => {
    if (picture.kind === 'google') return fetch(picture.url, options);
    const type = STORED_TYPES[picture.path.split('.').at(-1) ?? ''];
    if (type === undefined || files === undefined) return { ok: false, reason: 'url' };
    if (options?.types !== undefined && !options.types.includes(type)) return { ok: false, reason: 'type' };
    try {
      const found = await files.get(picture.path);
      if (found === undefined) return { ok: false, reason: 'status' };
      if (found.size > STORED_MAX_BYTES) return { ok: false, reason: 'size' };
      const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer());
      return startsAs(type, bytes) ? { ok: true, type, bytes } : { ok: false, reason: 'type' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  };
}
