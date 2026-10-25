// The share card one link page is pasted as (spec 0055, AC-5510): `/api/public/handles/<handle>/card.png` draws a
// 1200 × 630 picture of the person, so a link in a message shows them rather than nothing. Everything it decides
// lives in `card-image.ts`, which a Node test draws with; this file is the entry, the three outside calls (the
// fonts off the disk, the profile and the picture), and nothing else.
//
// It draws with satori and resvg rather than `@vercel/og`, which wraps those same two: that package is built for
// Next's bundler and throws `Dynamic require of "fs" is not supported` the moment a plain Node entry imports it.
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vercel's Node builder compiles each imported TypeScript file to a .js beside it but keeps the `.ts` in every
// import, as Node runs them on the other hosts. The same hook `api/index.mjs` and `api/handle.mjs` register.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const missing = error?.code === 'ERR_MODULE_NOT_FOUND' && typeof error.url === 'string' ? error.url : '';
      if (missing.startsWith('file:') && missing.endsWith('.ts')) {
        return nextResolve(missing.replace(/\.ts$/, '.js'), context);
      }
      throw error;
    }
  },
});

// @boundaries-ignore the Vercel Function entry runs on the server, not in the client bundle
const {
  CARD_CACHE_CONTROL,
  CARD_CACHE_CONTROL_MISSED,
  CARD_CACHE_CONTROL_UNVERSIONED,
  CARD_HEIGHT,
  CARD_WIDTH,
  cardFonts,
  cardTree,
  handleOf,
} = await import('../card-image.ts');
const { default: satori } = await import('satori');
const { Resvg } = await import('@resvg/resvg-js');

/** Where the fonts and the lockup sit, beside this file so the bundle carries them (`includeFiles` in vercel.json). */
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'card-assets');

/**
 * How long the profile read may take. Longer than the shell's 800 ms on purpose: nobody is waiting on this, a
 * crawler fetching a card will wait, and a cold function beside a cold database spent more than that on the first
 * card production ever drew (26 October 2026), which a reader would have seen as a broken picture.
 */
const READ_TIMEOUT_MS = 3_000;
/** How long the picture may take. Shorter: a card without a face is still a card, a slow one is a dead preview. */
const PICTURE_TIMEOUT_MS = 600;
/** The largest picture that is worth embedding; anything above it draws as initials. */
const PICTURE_MAX_BYTES = 2_000_000;

/** The sentence a page with no words of its own carries, the same one the meta block uses. */
const DEFAULT_DESCRIPTION = 'Links, contact details and a time to meet.';

/** The fonts and the lockup, read once per instance: every later card on it costs no disk at all. */
let assets;
async function loadAssets() {
  assets ??= (async () => {
    const [inter, display, wordmark] = await Promise.all([
      readFile(join(ASSETS, 'Inter-Variable-latin.ttf')),
      readFile(join(ASSETS, 'HostGrotesk-Variable-latin.ttf')),
      readFile(join(ASSETS, 'timefix-wordmark.png')),
    ]);
    return { inter, display, wordmark: `data:image/png;base64,${wordmark.toString('base64')}` };
  })();
  return await assets;
}

/** Their picture as a data URI, or undefined: a face that misses, in any way, is drawn as initials instead. */
async function pictureOf(origin, image) {
  // Only our own origin's picture route, and only as a path: a profile's `image` is data, never a destination.
  if (typeof image !== 'string' || !image.startsWith('/api/public/profiles/')) return undefined;
  try {
    const answer = await fetch(`${origin}${image}`, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
    if (!answer.ok) return undefined;
    const type = answer.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type.split(';')[0].trim())) return undefined;
    const bytes = Buffer.from(await answer.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > PICTURE_MAX_BYTES) return undefined;
    return `data:${type.split(';')[0].trim()};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const handle = handleOf(url.pathname);
  if (handle === undefined) return new Response('Not found', { status: 404 });

  let profile;
  try {
    const answer = await fetch(`${url.origin}/api/public/handles/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (answer.status === 404) return new Response('Not found', { status: 404 });
    if (!answer.ok) throw new Error(`profile read answered ${String(answer.status)}`);
    profile = await answer.json();
  } catch (error) {
    // One line, the handle and why, as the shell logs its own misses: a card nobody can draw is invisible otherwise.
    console.warn(JSON.stringify({ event: 'handle.card.missed', handle, reason: error?.name ?? 'unknown' }));
    // A card is still drawn, from the address alone. A reader who was sent this link sees the page it belongs to
    // rather than a broken picture, which is what a 503 looks like in a message; it is kept for a minute only, so
    // the real card takes its place as soon as the read works again.
    profile = undefined;
  }

  const name = typeof profile?.name === 'string' && profile.name !== '' ? profile.name : handle;
  const bio = typeof profile?.bio === 'string' && profile.bio.trim() !== '' ? profile.bio.trim() : undefined;
  // The address a visitor reads, which is the public origin's host and not whichever host this request arrived on.
  const shown = `${new URL(process.env.BOOKING_PUBLIC_ORIGIN ?? url.origin).host}/${handle}`;
  const picture = profile === undefined ? undefined : await pictureOf(url.origin, profile.image);
  const loaded = await loadAssets();

  const svg = await satori(
    cardTree(
      { name, handle: shown, description: bio ?? DEFAULT_DESCRIPTION, ...(picture === undefined ? {} : { picture }) },
      loaded,
    ),
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: cardFonts(loaded),
    },
  );
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();

  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      // A versioned address is one picture forever; a bare one is kept an hour, since the page behind it changes.
      'cache-control':
        profile === undefined
          ? CARD_CACHE_CONTROL_MISSED
          : url.searchParams.get('v')
            ? CARD_CACHE_CONTROL
            : CARD_CACHE_CONTROL_UNVERSIONED,
      'content-length': String(png.byteLength),
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function HEAD(request) {
  const answer = await GET(request);
  return new Response(null, { status: answer.status, headers: answer.headers });
}
