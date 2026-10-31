// Media blocks (spec 0061, AC-6105, AC-6106): a share link from YouTube, Vimeo, Spotify, SoundCloud or Apple Music
// read into a provider and an id with strict patterns, and everything a visitor's page and our server ever load for
// it built back from those two alone. What was pasted is never stored and never reaches a frame: a look alike host,
// a path that climbs, extra query text or anything that isn't one of these shapes is refused whole.
//
// Pure: no network and no database. The api reads the provider's title and poster through its outside fetch, with
// `mediaInfoSource` and `mediaPosterHosts` naming where it may go.
import { MEDIA_REF, PROFILE_CONTROL, type MediaProvider } from '@crm/contracts';

/** Every control character and line separator, as the link page's own rule names them, all at once. */
const CONTROLS = new RegExp(`${PROFILE_CONTROL.source}+`, 'g');

/** A share link read into its provider and id, or refused. */
export type MediaLink =
  { readonly ok: true; readonly provider: MediaProvider; readonly ref: string } | { readonly ok: false };

const NO: MediaLink = { ok: false };

/** A YouTube video id: eleven of letters, digits, `_` and `-`. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** A Vimeo video id, and an unlisted video's hash. */
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;
/** A Spotify item's kind and id (22 base62 characters). */
const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
/** A SoundCloud user or track name. */
const SOUNDCLOUD_NAME = /^[a-z0-9][a-z0-9_-]{0,99}$/;
/** SoundCloud's own first path words, which are never a user. */
const SOUNDCLOUD_RESERVED = new Set(['discover', 'search', 'you', 'stream', 'upload', 'pages', 'charts', 'mobile']);
/** An Apple Music storefront, item kind, name and id. */
const APPLE_STOREFRONT = /^[a-z]{2}$/;
const APPLE_KINDS = new Set(['album', 'playlist', 'song', 'music-video', 'station']);
const APPLE_SLUG = /^[a-z0-9%-]{1,120}$/i;
const APPLE_ID = /^(?:pl\.|ra\.)?[A-Za-z0-9-]{1,64}$/;
const APPLE_TRACK = /^\d{1,15}$/;

/** The path's parts, without empty ones. */
function partsOf(url: URL): readonly string[] {
  return url.pathname.split('/').filter((part) => part !== '');
}

/** The hostname, lowercased, or undefined unless it is exactly one of `hosts`. */
function hostIn(url: URL, hosts: readonly string[]): boolean {
  return hosts.includes(url.hostname.toLowerCase());
}

function youtube(url: URL): MediaLink {
  const parts = partsOf(url);
  let id: string | undefined;
  if (hostIn(url, ['youtu.be'])) {
    if (parts.length === 1) id = parts[0];
  } else if (hostIn(url, ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])) {
    if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (parts.length === 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1];
  } else if (hostIn(url, ['youtube-nocookie.com', 'www.youtube-nocookie.com'])) {
    if (parts.length === 2 && parts[0] === 'embed') id = parts[1];
  }
  return id !== undefined && YOUTUBE_ID.test(id) ? { ok: true, provider: 'youtube', ref: id } : NO;
}

function vimeo(url: URL): MediaLink {
  const parts = partsOf(url);
  let id: string | undefined;
  let hash: string | undefined;
  if (hostIn(url, ['player.vimeo.com'])) {
    if (parts.length === 2 && parts[0] === 'video') {
      id = parts[1];
      hash = url.searchParams.get('h') ?? undefined;
    }
  } else if (hostIn(url, ['vimeo.com', 'www.vimeo.com'])) {
    if (parts.length === 1 || (parts.length === 2 && VIMEO_HASH.test(parts[1] ?? ''))) {
      [id, hash] = parts;
    } else if (parts.length === 3 && parts[0] === 'channels') {
      id = parts[2];
    }
  }
  if (id === undefined || !VIMEO_ID.test(id)) return NO;
  if (hash !== undefined && !VIMEO_HASH.test(hash)) return NO;
  return { ok: true, provider: 'vimeo', ref: hash === undefined ? id : `${id}:${hash}` };
}

function spotify(url: URL): MediaLink {
  if (!hostIn(url, ['open.spotify.com'])) return NO;
  let parts = partsOf(url);
  // A localised link (`/intl-de/track/…`) and an embed link (`/embed/track/…`) name the same item.
  if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] ?? '')) parts = parts.slice(1);
  if (parts[0] === 'embed') parts = parts.slice(1);
  const [kind, id] = parts;
  if (parts.length !== 2 || kind === undefined || id === undefined) return NO;
  return SPOTIFY_KINDS.has(kind) && SPOTIFY_ID.test(id) ? { ok: true, provider: 'spotify', ref: `${kind}/${id}` } : NO;
}

function soundcloud(url: URL): MediaLink {
  if (!hostIn(url, ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'])) return NO;
  const parts = partsOf(url).map((part) => part.toLowerCase());
  const [user, second, third] = parts;
  if (user === undefined || second === undefined || !SOUNDCLOUD_NAME.test(user) || SOUNDCLOUD_RESERVED.has(user)) {
    return NO;
  }
  if (parts.length === 2 && second !== 'sets' && SOUNDCLOUD_NAME.test(second)) {
    return { ok: true, provider: 'soundcloud', ref: `${user}/${second}` };
  }
  if (parts.length === 3 && second === 'sets' && third !== undefined && SOUNDCLOUD_NAME.test(third)) {
    return { ok: true, provider: 'soundcloud', ref: `${user}/sets/${third}` };
  }
  return NO;
}

function appleMusic(url: URL): MediaLink {
  if (!hostIn(url, ['music.apple.com', 'embed.music.apple.com'])) return NO;
  const [storefront, kind, slug, id, ...rest] = partsOf(url);
  if (rest.length > 0 || storefront === undefined || kind === undefined || slug === undefined || id === undefined) {
    return NO;
  }
  if (!APPLE_STOREFRONT.test(storefront) || !APPLE_KINDS.has(kind) || !APPLE_SLUG.test(slug) || !APPLE_ID.test(id)) {
    return NO;
  }
  const track = url.searchParams.get('i');
  if (track !== null && !APPLE_TRACK.test(track)) return NO;
  const ref = `${storefront}/${kind}/${slug.toLowerCase()}/${id}${track === null ? '' : `/i/${track}`}`;
  return { ok: true, provider: 'applemusic', ref };
}

/**
 * A pasted share link read into its provider and id (AC-6105), or `{ ok: false }`. https only (an `http:` link is
 * read as its https twin, since each provider redirects it there), no credentials, no port, and exactly one of the
 * shapes above; the query is read for the one parameter a shape takes and the rest ignored, never carried.
 */
export function parseMediaLink(pasted: string): MediaLink {
  const typed = pasted.trim();
  if (typed === '' || typed.length > 2000 || /\s/.test(typed)) return NO;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return NO;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return NO;
  if (url.username !== '' || url.password !== '' || url.port !== '') return NO;
  for (const read of [youtube, vimeo, spotify, soundcloud, appleMusic]) {
    const found = read(url);
    if (found.ok) return MEDIA_REF.test(found.ref) ? found : NO;
  }
  return NO;
}

/** Whether a stored ref is one `parseMediaLink` could have made for this provider: read again on the way out. */
export function isMediaRef(provider: MediaProvider, ref: string): boolean {
  if (!MEDIA_REF.test(ref)) return false;
  const found = parseMediaLink(mediaShareUrl(provider, ref));
  return found.ok && found.provider === provider && found.ref === ref;
}

/** The provider's own share link, built from the provider and the id: what the editor shows as the block's link. */
export function mediaShareUrl(provider: MediaProvider, ref: string): string {
  switch (provider) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${ref}`;
    case 'vimeo': {
      const [id, hash] = ref.split(':');
      return `https://vimeo.com/${id ?? ''}${hash === undefined ? '' : `/${hash}`}`;
    }
    case 'spotify':
      return `https://open.spotify.com/${ref}`;
    case 'soundcloud':
      return `https://soundcloud.com/${ref}`;
    case 'applemusic': {
      const [storefront, kind, slug, id, , track] = ref.split('/');
      return `https://music.apple.com/${storefront ?? ''}/${kind ?? ''}/${slug ?? ''}/${id ?? ''}${track === undefined ? '' : `?i=${track}`}`;
    }
  }
}

/**
 * The address of the provider's player, which replaces the facade once Play is pressed (AC-6106), from the provider
 * and the id alone. Each origin is one of the five the handle pages' `frame-src` names (AC-6107); YouTube plays from
 * `youtube-nocookie.com`, and Vimeo is asked not to track (`dnt=1`).
 */
export function mediaFrameSrc(provider: MediaProvider, ref: string): string {
  switch (provider) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${ref}?autoplay=1&rel=0`;
    case 'vimeo': {
      const [id, hash] = ref.split(':');
      return `https://player.vimeo.com/video/${id ?? ''}?autoplay=1&dnt=1${hash === undefined ? '' : `&h=${hash}`}`;
    }
    case 'spotify':
      return `https://open.spotify.com/embed/${ref}`;
    case 'soundcloud':
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${ref}`)}&auto_play=true&visual=true`;
    case 'applemusic': {
      const [storefront, kind, slug, id, , track] = ref.split('/');
      return `https://embed.music.apple.com/${storefront ?? ''}/${kind ?? ''}/${slug ?? ''}/${id ?? ''}${track === undefined ? '' : `?i=${track}`}`;
    }
  }
}

/** The origins a media frame loads from: exactly what the handle pages' `frame-src` lists (AC-6107). */
export const MEDIA_FRAME_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://open.spotify.com',
  'https://w.soundcloud.com',
  'https://embed.music.apple.com',
] as const;

/**
 * Where the server reads a media block's title and poster once, on save: the provider's oEmbed answer (JSON with
 * `title` and `thumbnail_url`), or for Apple Music, which has none, the share page itself for its `og:` tags.
 */
export function mediaInfoSource(
  provider: MediaProvider,
  ref: string,
): { readonly kind: 'oembed' | 'page'; readonly url: URL } {
  const share = encodeURIComponent(mediaShareUrl(provider, ref));
  switch (provider) {
    case 'youtube':
      return { kind: 'oembed', url: new URL(`https://www.youtube.com/oembed?format=json&url=${share}`) };
    case 'vimeo':
      return { kind: 'oembed', url: new URL(`https://vimeo.com/api/oembed.json?url=${share}`) };
    case 'spotify':
      return { kind: 'oembed', url: new URL(`https://open.spotify.com/oembed?url=${share}`) };
    case 'soundcloud':
      return { kind: 'oembed', url: new URL(`https://soundcloud.com/oembed?format=json&url=${share}`) };
    case 'applemusic':
      return { kind: 'page', url: new URL(mediaShareUrl(provider, ref)) };
  }
}

/** The hosts each provider's oEmbed or share page is read from, and redirected within. */
const INFO_HOSTS: Readonly<Record<MediaProvider, readonly string[]>> = {
  youtube: ['www.youtube.com', 'youtube.com'],
  vimeo: ['vimeo.com', 'www.vimeo.com'],
  spotify: ['open.spotify.com'],
  soundcloud: ['soundcloud.com', 'www.soundcloud.com'],
  applemusic: ['music.apple.com'],
};

/** The hosts each provider serves its posters from: a poster address naming any other is never read. */
const POSTER_HOSTS: Readonly<Record<MediaProvider, readonly (string | RegExp)[]>> = {
  youtube: ['i.ytimg.com', 'img.youtube.com'],
  vimeo: ['i.vimeocdn.com'],
  spotify: ['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com'],
  soundcloud: [/^i\d?\.sndcdn\.com$/],
  applemusic: [/^is\d{1,2}-ssl\.mzstatic\.com$/],
};

/** Whether the outside fetch may read `url` for this provider's title. */
export function isMediaInfoHost(provider: MediaProvider, url: URL): boolean {
  return url.protocol === 'https:' && INFO_HOSTS[provider].includes(url.hostname.toLowerCase());
}

/** Whether the outside fetch may read `url` as this provider's poster. */
export function isMediaPosterHost(provider: MediaProvider, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    POSTER_HOSTS[provider].some((allowed) => (typeof allowed === 'string' ? allowed === host : allowed.test(host)))
  );
}

/** The title and poster address an oEmbed answer gives, each only when it is a plain string; never anything else. */
export function readOembed(body: unknown): { readonly title?: string; readonly poster?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const title = 'title' in body && typeof body.title === 'string' ? cleanTitle(body.title) : undefined;
  const poster = 'thumbnail_url' in body && typeof body.thumbnail_url === 'string' ? body.thumbnail_url : undefined;
  return { ...(title === undefined ? {} : { title }), ...(poster === undefined ? {} : { poster }) };
}

/**
 * A provider's title as a block's title: one line, no control characters, at most 100 characters (cut at a word
 * where it can be), or undefined when nothing is left.
 */
export function cleanTitle(raw: string): string | undefined {
  const line = raw.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  if (line === '') return undefined;
  if (line.length <= 100) return line;
  const cut = line.slice(0, 100);
  const space = cut.lastIndexOf(' ');
  return (space > 60 ? cut.slice(0, space) : cut).trim();
}
