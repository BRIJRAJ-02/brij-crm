// The share card a link page is pasted as (spec 0055, AC-5510): 1200 × 630, drawn on the server so a message
// shows the person rather than nothing. Everything it decides lives here, in plain TypeScript with no Vercel and
// no file reading, so a Node test can draw one and look at it; `api/card.mjs` is the entry that reads the fonts
// and answers the request.
//
// The look is the marketing site's, not the app's: its pitch black ground (`--site-ink`), its display face
// (Host Grotesk) and the field of accent dashes its fold stands on, reproduced from apps/marketing's Backdrop
// with the same steps, the same noise and the same falloff.

/** The one pair every crawler is told, and the size the card is drawn at. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The site's ground, `--site-ink`. */
const INK = '#000000';
/** Dark mode's text and its quieter companion, from the tokens. */
const TEXT = '#ebedef';
const SOFT = '#a7abb3';
/** The accent, and the accent lifted so a dash reads on pitch black. */
const ACCENT = '#1f5fd6';
const FIELD = '#5b8ae8';

/** The dash field's grid and weight, as `Backdrop.tsx` draws it. */
const STEP_X = 14;
const STEP_Y = 12;
const DASH_WIDTH = 6;
const DASH_HEIGHT = 2;
const STRENGTH = 0.85;
/** How much of the card the field stands on. */
const FIELD_HEIGHT = 560;

/** A fixed pseudo random number for a cell, 0 to 1, so the field is the same every time a card is drawn. */
function noise(row: number, column: number): number {
  const value = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The field as an SVG data URI: satori lays out boxes and text, so the dashes arrive as one picture rather than
 * several thousand elements. Each dash's alpha is its place, fading upward and toward the far side.
 */
function fieldImage(width: number, height: number): string {
  const columns = Math.ceil(width / STEP_X);
  const rows = Math.ceil(height / STEP_Y);
  const dashes: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const down = row / rows;
    for (let column = 0; column < columns; column += 1) {
      const grain = noise(row, column);
      if (grain < 0.3) continue;
      const toward = column / columns;
      const place = down ** 1.35 * (1 - toward) ** 1.25 * (0.6 + grain * 0.4);
      const alpha = Math.min(1, place) * STRENGTH;
      if (alpha < 0.012) continue;
      const length = DASH_WIDTH - 2 + Math.round(noise(column, row) * 6);
      const x = column * STEP_X + (STEP_X - length) / 2;
      const y = row * STEP_Y + (STEP_Y - DASH_HEIGHT) / 2;
      dashes.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${String(length)}" height="${String(DASH_HEIGHT)}" fill="${FIELD}" opacity="${alpha.toFixed(3)}"/>`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">${dashes.join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * The handle `/api/public/handles/<handle>/card.png` names, or undefined when the path names none. The shape is a
 * handle's own, so nothing else is ever sent on to the api: a path is read here, never trusted.
 */
export function handleOf(pathname: string): string | undefined {
  const match = /^\/api\/public\/handles\/([^/]+)\/card\.png$/.exec(pathname);
  const handle = match?.[1];
  if (handle === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(handle);
  } catch {
    return undefined;
  }
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(decoded) ? decoded : undefined;
}

/** Up to two initials for a name, for a person with no picture. */
export function initialsOf(name: string): string {
  const letters = Array.from(name.trim())
    .filter((character) => /\S/u.test(character))
    .join('');
  if (letters === '') return '?';
  const words = name.trim().split(/\s+/u).slice(0, 2);
  return words
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

/** What one card says. Every string may have come from the person, so none is trusted with markup. */
export interface CardSource {
  /** Whose page it is. */
  readonly name: string;
  /** The address a visitor reads, without a scheme: `timefix.com/ada`. */
  readonly handle: string;
  /** Their own words, or the page's default sentence. */
  readonly description: string;
  /** Their picture as a data URI, when they have one and it could be read. */
  readonly picture?: string;
}

/** What `api/card.mjs` reads off the disk once and hands in for every card. */
export interface CardAssets {
  readonly inter: ArrayBuffer | Buffer;
  readonly display: ArrayBuffer | Buffer;
  /** The Timefix lockup as a data URI (the white one, made for a dark ground). */
  readonly wordmark: string;
}

/** A satori element, written by hand: this file has no JSX, so the entry needs no build step. */
interface Element {
  readonly type: string;
  readonly props: Record<string, unknown>;
}
const el = (type: string, props: Record<string, unknown>, ...children: (Element | string)[]): Element => ({
  type,
  props: { ...props, ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) },
});

/**
 * The card's element tree. Top and foot are placed outright rather than spaced apart: satori's `space-between`
 * and `margin-block-start: auto` both push the foot off the card, which is a clipped wordmark, not a layout.
 */
export function cardTree(source: CardSource, assets: CardAssets): Element {
  const avatar =
    source.picture === undefined
      ? el(
          'div',
          {
            style: {
              display: 'flex',
              width: '164px',
              height: '164px',
              borderRadius: '82px',
              background: ACCENT,
              color: '#ffffff',
              fontSize: '64px',
              fontWeight: 600,
              fontFamily: 'Host Grotesk',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          initialsOf(source.name),
        )
      : el('img', {
          src: source.picture,
          width: 164,
          height: 164,
          style: { borderRadius: '82px', objectFit: 'cover' },
        });

  return el(
    'div',
    {
      style: {
        display: 'flex',
        width: `${String(CARD_WIDTH)}px`,
        height: `${String(CARD_HEIGHT)}px`,
        background: INK,
        position: 'relative',
        fontFamily: 'Inter',
      },
    },
    el('img', {
      src: fieldImage(CARD_WIDTH, FIELD_HEIGHT),
      width: CARD_WIDTH,
      height: FIELD_HEIGHT,
      style: { position: 'absolute', left: '0px', bottom: '0px' },
    }),
    el(
      'div',
      {
        style: {
          display: 'flex',
          position: 'absolute',
          top: '72px',
          left: '80px',
          right: '80px',
          alignItems: 'center',
        },
      },
      avatar,
      el('div', { style: { display: 'flex', fontSize: '30px', color: SOFT, marginLeft: 'auto' } }, source.handle),
    ),
    el(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: '80px',
          right: '80px',
          bottom: '68px',
        },
      },
      el('img', { src: assets.wordmark, width: 148, height: 36, style: { marginBottom: '26px' } }),
      el(
        'div',
        {
          style: {
            fontSize: '88px',
            fontWeight: 600,
            color: TEXT,
            fontFamily: 'Host Grotesk',
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
          },
        },
        source.name,
      ),
      el(
        'div',
        { style: { display: 'flex', fontSize: '32px', color: SOFT, marginTop: '20px', maxWidth: '820px' } },
        source.description,
      ),
    ),
  );
}

/** The fonts satori is given: Inter for everything but the name and the lockup, which are the display face. */
export function cardFonts(assets: CardAssets) {
  return [
    { name: 'Inter', data: assets.inter, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: assets.inter, weight: 500 as const, style: 'normal' as const },
    { name: 'Host Grotesk', data: assets.display, weight: 600 as const, style: 'normal' as const },
  ];
}

/** A card is the same until the page changes, and the address carries the version, so it is kept for a year. */
export const CARD_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Without a version (somebody typed the address), it is still cached, but only for an hour. */
export const CARD_CACHE_CONTROL_UNVERSIONED = 'public, max-age=3600, s-maxage=3600';
/** A card drawn from the address alone, because the read missed: kept a minute, so the real one follows soon. */
export const CARD_CACHE_CONTROL_MISSED = 'public, max-age=60, s-maxage=60';
