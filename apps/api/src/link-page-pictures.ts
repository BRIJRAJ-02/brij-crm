// A link page's pictures and its Insights download (spec 0061), for the signed in person's own page in the workspace
// `x-crm-workspace` (or for a read, `workspace`) names, through the same member door the RPC opens:
// - `POST /profile/images`: one picture, the request body itself, its `content-type` its type. The browser has made
//   it at most 1,600 pixels on its long side already; this route trusts none of that. The order is the logo's
//   (`brand-logo.ts`): a session, the door, a store, the per person limit, the type against the allowlist (JPEG, PNG,
//   WebP; never SVG), the body to at most 4 MB, then `checkProfileImage` (the first bytes, the sides, the metadata
//   taken out, at most 1.5 MB kept), and only then the private store, under
//   `link-page/<user>/<workspace>/<id>.<ext>`, nothing in it typed by anyone. Answers the picture's id and size.
// - `GET /profile/images/:id?workspace=`: the owner's own copy, for the editor, kept by their browser alone.
// - `GET /profile/insights.csv?workspace=&from=&to=`: the Insights CSV, at most 365 days (AC-6120).
// - `POST /profile/audio`: one audio intro (spec 0068, AC-6808), the request body itself. The same order as a
//   picture's: a session, the door, a store, the per person limit, a declared type that is a sound, the body to at
//   most 4 MB, then `checkProfileAudio` (the type by its first bytes, an MP3's tags taken out, at most 1.5 MB kept),
//   and only then the private store under the server's own path. Answers the recording's id.
// - `GET /profile/audio/:id?workspace=`: the owner's own copy, for the editor.
// The RPC's thumbnail fetch and a media block's poster go through `storeLinkPicture` too, so every picture a link
// page keeps passed the same checks. Nothing here logs a picture, its path or an address it read.
import { randomUUID } from 'node:crypto';
import {
  PROFILE_AUDIO_SIZE_REFUSAL,
  PROFILE_AUDIO_TYPE_REFUSAL,
  PROFILE_AUDIO_TYPES,
  PROFILE_IMAGE_TYPES,
  PAGE_MEMBER_HEADER,
  UPLOAD_WORKSPACE_HEADER,
  type MediaProvider,
  type ProfileImageKind,
} from '@crm/contracts';
import {
  addProfileImage,
  checkProfileAudio,
  checkProfileImage,
  profileAudioStorePath,
  cleanTitle,
  enterTeamLinkPage,
  getMyProfile,
  isMediaInfoHost,
  isMediaPosterHost,
  mediaInfoSource,
  profileImageStorePath,
  profileInsightsCsv,
  readOembed,
  readOwnProfileImage,
  readPageMeta,
} from '@crm/core';
import type { Context, Hono } from 'hono';
import {
  imageBodyLimit,
  IMAGE_UPLOAD_LIMIT,
  loadStoredImage,
  memberScopeOf,
  refusalResponse,
  type ImageRouteDeps,
  type ImageVariables,
  type MemberScope,
} from './brand-logo.ts';
import { errorFields, log } from './log.ts';
import type { OutsideFetch } from './public/outside.ts';
import type { FileStore } from './storage/blob.ts';

/**
 * The link page an upload or a read is for (spec 0070, AC-7002): the caller's own, or with `member` that member's,
 * through the door's `enterTeamLinkPage` (`link_pages.manage_team`, else FORBIDDEN; someone not here is NOT_FOUND).
 * `owner` is the page's own identity, whose folder its files are kept in, whoever sends them.
 */
export async function pageScopeOf(
  c: Context<{ Variables: ImageVariables }>,
  deps: Pick<ImageRouteDeps, 'auth' | 'enter' | 'errorResponse'>,
  slug: string | undefined,
  member: string | undefined,
): Promise<
  | { readonly scope: MemberScope; readonly session: Parameters<ImageRouteDeps['enter']>[0]; readonly owner: string }
  | Response
> {
  // A link page's own routes: an embedded frame's session may reach them (spec 0070, AC-7033).
  const entered = await memberScopeOf(c, deps, slug, { embed: true });
  if (entered instanceof Response) return entered;
  try {
    const scope =
      member === undefined || member === '' ? entered.scope : await enterTeamLinkPage(entered.scope, member);
    const { principal } = scope.access;
    const owner = principal.kind === 'member' ? principal.userId : undefined;
    if (owner === undefined) return deps.errorResponse('FORBIDDEN', 'Only a signed in person has a link page.');
    return { scope, session: entered.session, owner };
  } catch (error) {
    return refusalResponse(error, deps.errorResponse);
  }
}

/** Pictures added: 60 an hour per person, in this process (the definer counts the same across every one). */
const PICTURE_UPLOAD_LIMIT = { max: 60, windowMs: IMAGE_UPLOAD_LIMIT.windowMs } as const;
/** The Insights download: 10 a minute per person. */
const CSV_LIMIT = { max: 10, windowMs: 60_000 } as const;
/** The most of a page read for its tags (AC-6128). */
export const PAGE_READ_MAX_BYTES = 64 * 1024;
/** The most of a picture read from a site (AC-6128). */
export const PICTURE_READ_MAX_BYTES = 1024 * 1024;

/** A picture stored for a link page: its id and size, or why it couldn't be. */
export type StoredPicture =
  | { readonly ok: true; readonly image: string; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: 'type' | 'size' | 'shape' | 'store' };

/**
 * Checks, cleans and keeps one picture of the caller's own link page (AC-6108, AC-6128): `checkProfileImage` decides
 * the type by the bytes, takes the metadata out and bounds its size, then the store keeps it under the server's own
 * path and the definer keeps its row. A store with no row is removed again, so nothing is left behind.
 */
export async function storeLinkPicture(
  files: FileStore | undefined,
  scope: MemberScope,
  userId: string,
  bytes: Uint8Array,
  kind: ProfileImageKind,
): Promise<StoredPicture> {
  if (files === undefined) return { ok: false, reason: 'store' };
  const checked = checkProfileImage(bytes);
  if (!checked.ok) return checked;
  const id = randomUUID();
  const path = profileImageStorePath(userId, scope.workspaceId, id, checked.type);
  await files.put(path, checked.bytes, checked.type);
  try {
    await addProfileImage(scope, {
      id,
      kind,
      path,
      type: checked.type,
      bytes: checked.bytes.byteLength,
      width: checked.width,
      height: checked.height,
    });
  } catch (error) {
    await files.remove([path]).catch(() => undefined);
    throw error;
  }
  return { ok: true, image: id, width: checked.width, height: checked.height };
}

/** A recording stored for a link page: its id, or why it couldn't be. */
export type StoredAudio =
  | { readonly ok: true; readonly audio: string }
  | { readonly ok: false; readonly reason: 'type' | 'size' | 'shape' | 'store' };

/**
 * Checks and keeps one audio intro of the caller's own link page (spec 0068, AC-6808): `checkProfileAudio` decides
 * the type by the bytes and bounds the size, then the store keeps it under the server's own path and the definer
 * keeps its row as a picture's, its sides 1 by 1. A store with no row is removed again.
 */
export async function storeLinkAudio(
  files: FileStore | undefined,
  scope: MemberScope,
  userId: string,
  bytes: Uint8Array,
): Promise<StoredAudio> {
  if (files === undefined) return { ok: false, reason: 'store' };
  const checked = checkProfileAudio(bytes);
  if (!checked.ok) return checked;
  const id = randomUUID();
  const path = profileAudioStorePath(userId, scope.workspaceId, id, checked.type);
  await files.put(path, checked.bytes, checked.type);
  try {
    await addProfileImage(scope, {
      id,
      kind: 'audio',
      path,
      type: checked.type,
      bytes: checked.bytes.byteLength,
      width: 1,
      height: 1,
    });
  } catch (error) {
    await files.remove([path]).catch(() => undefined);
    throw error;
  }
  return { ok: true, audio: id };
}

/** The largest stored recording read back: the database's own cap. */
const STORED_AUDIO_MAX_BYTES = 1_572_864;

/**
 * A stored recording's bytes, read back for a response: only one of the four sound types, at most 1.5 MB, and only
 * when its first bytes still are that type. Anything else is undefined, never a guess.
 */
export async function loadStoredAudio(
  files: FileStore | undefined,
  path: string,
  type: string,
): Promise<{ readonly type: string; readonly bytes: Uint8Array } | undefined> {
  const known = PROFILE_AUDIO_TYPES.find((each) => each === type);
  if (files === undefined || known === undefined) return undefined;
  try {
    const found = await files.get(path);
    if (found === undefined || found.size > STORED_AUDIO_MAX_BYTES) return undefined;
    const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer());
    const checked = checkProfileAudio(bytes);
    return checked.ok && checked.type === known ? { type: known, bytes } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A recording's response: never sniffed, never framed, our own origin only. It answers a byte range too, since
 * Safari's player asks for `bytes=0-1` first and plays nothing from a server that ignores it; a range it can't
 * serve is 416, and a header that isn't one `bytes=` range is ignored and the whole file goes.
 */
export function audioResponse(
  stored: { readonly type: string; readonly bytes: Uint8Array },
  cacheControl: string,
  range: string | undefined,
): Response {
  const headers = {
    'content-type': stored.type,
    'cache-control': cacheControl,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'",
  };
  const size = stored.bytes.byteLength;
  const asked = range === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (asked === null) return new Response(new Uint8Array(stored.bytes), { headers });
  const [, from = '', to = ''] = asked;
  // A part of the file is this visitor's answer alone: an edge never keeps it for the next one.
  const partial = { ...headers, 'cache-control': 'private, max-age=300' };
  // `bytes=-500` is the last 500; `bytes=100-` runs to the end.
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if ((from === '' && to === '') || !Number.isSafeInteger(start) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...partial, 'content-range': `bytes */${String(size)}` } });
  }
  return new Response(stored.bytes.slice(start, end + 1), {
    status: 206,
    headers: { ...partial, 'content-range': `bytes ${String(start)}-${String(end)}/${String(size)}` },
  });
}

/** Any https host with a name: what a link's own site may be. The pinned fetch and its address check bound it. */
const anyPublicHost = (url: URL) => url.protocol === 'https:';

/** Reads one picture from outside, under the picture caps, or undefined. */
async function readPicture(
  fetch: OutsideFetch,
  url: URL,
  allow: (url: URL) => boolean,
): Promise<Uint8Array | undefined> {
  const read = await fetch(url, { accept: [...PROFILE_IMAGE_TYPES], maxBytes: PICTURE_READ_MAX_BYTES, allow });
  return read.ok ? read.bytes : undefined;
}

/**
 * The picture a link's own site names for itself (AC-6101): its saved address read for its `og:` tags (at most 64
 * kB), then that picture (at most 1 MB, JPEG, PNG or WebP by its first bytes). Undefined when the site names none, or
 * none we can use; never throws for the site's sake.
 */
export async function readSitePicture(
  fetch: OutsideFetch,
  address: string,
  /** Whether the picture's own host may be read now: its own per site budget, beside the page's. */
  mayRead: (host: string) => Promise<boolean> = () => Promise.resolve(true),
): Promise<Uint8Array | undefined> {
  if (!URL.canParse(address)) return undefined;
  const page = new URL(address);
  const read = await fetch(page, {
    accept: ['text/html', 'application/xhtml+xml'],
    maxBytes: PAGE_READ_MAX_BYTES,
    allow: anyPublicHost,
  });
  if (!read.ok) return undefined;
  const meta = readPageMeta(new TextDecoder().decode(read.bytes), page);
  if (meta.image === undefined || !(await mayRead(meta.image.hostname))) return undefined;
  return readPicture(fetch, meta.image, anyPublicHost);
}

/**
 * A media block's title and poster, read once on save (AC-6105, AC-6106): the provider's oEmbed answer (or, for
 * Apple Music, its share page's `og:` tags), each read only from that provider's own hosts, and the poster kept as
 * one of the owner's pictures. Whatever fails is left out: the block then shows the provider's name and no poster.
 */
export function createMediaReader(deps: {
  readonly fetch: OutsideFetch;
  readonly files: FileStore | undefined;
  readonly scope: MemberScope;
  readonly userId: string;
}): (provider: MediaProvider, ref: string) => Promise<{ readonly title?: string; readonly poster?: string }> {
  return async (provider, ref) => {
    const source = mediaInfoSource(provider, ref);
    const allow = (url: URL) => isMediaInfoHost(provider, url);
    let title: string | undefined;
    let posterUrl: URL | undefined;
    if (source.kind === 'oembed') {
      const read = await deps.fetch(source.url, {
        accept: ['application/json', 'text/javascript'],
        maxBytes: PAGE_READ_MAX_BYTES,
        allow,
      });
      if (read.ok) {
        let body: unknown;
        try {
          body = JSON.parse(new TextDecoder().decode(read.bytes));
        } catch {
          body = undefined;
        }
        const found = readOembed(body);
        title = found.title;
        posterUrl = found.poster !== undefined && URL.canParse(found.poster) ? new URL(found.poster) : undefined;
      }
    } else {
      const read = await deps.fetch(source.url, { accept: ['text/html'], maxBytes: PAGE_READ_MAX_BYTES, allow });
      if (read.ok) {
        const meta = readPageMeta(new TextDecoder().decode(read.bytes), source.url);
        title = meta.title === undefined ? undefined : cleanTitle(meta.title);
        posterUrl = meta.image;
      }
    }
    let poster: string | undefined;
    if (posterUrl !== undefined && isMediaPosterHost(provider, posterUrl)) {
      const bytes = await readPicture(deps.fetch, posterUrl, (url) => isMediaPosterHost(provider, url));
      if (bytes !== undefined) {
        const stored = await storeLinkPicture(deps.files, deps.scope, deps.userId, bytes, 'poster').catch(
          (error: unknown) => {
            log.warn('link_page.poster.unkept', errorFields(error));
            return undefined;
          },
        );
        if (stored?.ok === true) poster = stored.image;
      }
    }
    return { ...(title === undefined ? {} : { title }), ...(poster === undefined ? {} : { poster }) };
  };
}

/** The sentence each refused picture is answered with. */
const PICTURE_REFUSALS = {
  type: 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP.',
  size: 'That picture is too big. Choose one under 1.5 MB.',
  shape: 'That picture can’t be read. Choose another, at most 4,096 pixels on a side.',
  store: 'Pictures can’t be uploaded here yet.',
} as const;

/** Mounts the routes (the app's base path is `/api`). */
export function mountLinkPagePictures(app: Hono<{ Variables: ImageVariables }>, deps: ImageRouteDeps): void {
  const { files, limiter, errorResponse } = deps;

  app.post('/profile/images', imageBodyLimit(errorResponse), async (c: Context<{ Variables: ImageVariables }>) => {
    const entered = await pageScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER), c.req.header(PAGE_MEMBER_HEADER));
    if (entered instanceof Response) return entered;
    const { scope, session, owner } = entered;
    if (files === undefined) return errorResponse('API_UNAVAILABLE', PICTURE_REFUSALS.store);
    if (!limiter(`link-page-picture:${session.user.id}`, PICTURE_UPLOAD_LIMIT).allowed) {
      return errorResponse('RATE_LIMITED', 'You’ve added a lot of pictures just now. Try again later.');
    }
    const declared = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!PROFILE_IMAGE_TYPES.some((type) => type === declared)) {
      return errorResponse('INPUT_INVALID', 'Choose a JPEG, PNG or WebP picture.');
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return errorResponse('INPUT_INVALID', 'Choose a picture.');
    try {
      const stored = await storeLinkPicture(files, scope, owner, bytes, 'upload');
      if (!stored.ok) {
        return errorResponse(
          stored.reason === 'size' ? 'PAYLOAD_TOO_LARGE' : 'INPUT_INVALID',
          PICTURE_REFUSALS[stored.reason],
        );
      }
      log.info('link_page.picture.added', {
        requestId: c.get('requestId'),
        width: stored.width,
        height: stored.height,
      });
      return c.json({ image: stored.image, width: stored.width, height: stored.height });
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
  });

  app.get('/profile/images/:id', async (c) => {
    const entered = await pageScopeOf(c, deps, c.req.query('workspace'), c.req.query('member'));
    if (entered instanceof Response) return entered;
    const found = await readOwnProfileImage(entered.scope, c.req.param('id'));
    const stored = found === undefined ? undefined : await loadStoredImage(files, found.path, found.type);
    if (stored === undefined) return errorResponse('NOT_FOUND', 'There’s no picture here.');
    return new Response(new Uint8Array(stored.bytes), {
      headers: {
        'content-type': stored.type,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'content-security-policy': "default-src 'none'",
      },
    });
  });

  app.post('/profile/audio', imageBodyLimit(errorResponse), async (c: Context<{ Variables: ImageVariables }>) => {
    const entered = await pageScopeOf(c, deps, c.req.header(UPLOAD_WORKSPACE_HEADER), c.req.header(PAGE_MEMBER_HEADER));
    if (entered instanceof Response) return entered;
    const { scope, session, owner } = entered;
    if (files === undefined) return errorResponse('API_UNAVAILABLE', 'Recordings can’t be uploaded here yet.');
    // The same budget as pictures: a recording is one more of the page's files.
    if (!limiter(`link-page-picture:${session.user.id}`, PICTURE_UPLOAD_LIMIT).allowed) {
      return errorResponse('RATE_LIMITED', 'You’ve added a lot of files just now. Try again later.');
    }
    // A sound by its declared type (browsers name an M4A `audio/x-m4a` and an MP3 `audio/mp3`), then by its bytes.
    const declared = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!declared.startsWith('audio/')) return errorResponse('INPUT_INVALID', PROFILE_AUDIO_TYPE_REFUSAL);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return errorResponse('INPUT_INVALID', 'Choose a recording.');
    try {
      const stored = await storeLinkAudio(files, scope, owner, bytes);
      if (!stored.ok) {
        return stored.reason === 'size'
          ? errorResponse('PAYLOAD_TOO_LARGE', PROFILE_AUDIO_SIZE_REFUSAL)
          : stored.reason === 'store'
            ? errorResponse('API_UNAVAILABLE', 'Recordings can’t be uploaded here yet.')
            : errorResponse('INPUT_INVALID', PROFILE_AUDIO_TYPE_REFUSAL);
      }
      log.info('link_page.audio.added', { requestId: c.get('requestId'), bytes: bytes.byteLength });
      return c.json({ audio: stored.audio });
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
  });

  app.get('/profile/audio/:id', async (c) => {
    const entered = await pageScopeOf(c, deps, c.req.query('workspace'), c.req.query('member'));
    if (entered instanceof Response) return entered;
    const found = await readOwnProfileImage(entered.scope, c.req.param('id'));
    const stored = found === undefined ? undefined : await loadStoredAudio(files, found.path, found.type);
    if (stored === undefined) return errorResponse('NOT_FOUND', 'There’s no recording here.');
    return audioResponse(stored, 'private, max-age=3600', c.req.header('range'));
  });

  app.get('/profile/insights.csv', async (c) => {
    const entered = await pageScopeOf(c, deps, c.req.query('workspace'), c.req.query('member'));
    if (entered instanceof Response) return entered;
    const { scope, session } = entered;
    if (!limiter(`link-page-csv:${session.user.id}`, CSV_LIMIT).allowed) {
      return errorResponse('RATE_LIMITED', 'You’ve downloaded a few just now. Try again in a minute.');
    }
    const from = c.req.query('from') ?? '';
    const to = c.req.query('to') ?? '';
    try {
      const body = await profileInsightsCsv(scope, { from, to });
      // The file is named by the page's own handle (AC-6120), never by anything in the request.
      const stem = (await getMyProfile(scope)).handle ?? 'link-page';
      return new Response(body, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${stem}-insights-${from}-${to}.csv"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      return refusalResponse(error, errorResponse);
    }
  });
}
