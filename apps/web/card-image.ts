// The share card a link page is pasted as (spec 0055, AC-5510): 1200 × 630, drawn on the server so a message
// shows the person rather than nothing. Everything it decides lives here, in plain TypeScript with no Vercel and
// no file reading, so a Node test can draw one and look at it; `api/card.mjs` is the entry that reads the fonts
// and answers the request.
//
// The look is the marketing site's, not the app's: its pitch black ground (`--site-ink`), its display face
// (Host Grotesk) and the field of accent dashes its fold stands on, reproduced from apps/marketing's Backdrop
// with the same steps, the same noise and the same falloff.
import { linkPageCacheTags } from '@crm/contracts/handles';

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
interface Field {
  /**
   * Where the dashes are densest. The card fades upward into its own ink; the pass's band fades downward into
   * the pass it sits on, so neither ends on an edge.
   */
  readonly fade?: 'up' | 'down';
  /**
   * Whether the field also fades toward the far side. The card does: it leaves the right clear for the words
   * over it. A band 375 points wide and 144 tall has no far side to speak of, and the same falloff leaves the
   * blue bunched in one corner, so the band runs the dashes the whole way across instead.
   */
  readonly sideways?: boolean;
  /** How strongly the dashes read, against `STRENGTH`'s 0.85. */
  readonly strength?: number;
  /**
   * A bloom the dashes gather into, in the picture's own pixels, instead of a straight fade. The band uses one,
   * thrown behind the face: a field that only fades downward is at full strength along the band's top edge,
   * which on a pass with no ground of its own is a hard blue line across it. Gathered into a bloom it has no
   * edge anywhere, and the blue reads as something behind the person rather than a texture over the pass.
   */
  readonly bloom?: { readonly x: number; readonly y: number; readonly radius: number };
}

function fieldImage(width: number, height: number, field: Field = {}): string {
  const { fade = 'up', sideways = true, strength = STRENGTH, bloom } = field;
  const columns = Math.ceil(width / STEP_X);
  const rows = Math.ceil(height / STEP_Y);
  const dashes: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const down = fade === 'up' ? row / rows : 1 - row / rows;
    for (let column = 0; column < columns; column += 1) {
      const grain = noise(row, column);
      if (grain < 0.3) continue;
      const toward = sideways ? (1 - column / columns) ** 1.25 : 1;
      const near =
        bloom === undefined
          ? down ** 1.35
          : (() => {
              const dx = (column * STEP_X + STEP_X / 2 - bloom.x) / bloom.radius;
              const dy = (row * STEP_Y + STEP_Y / 2 - bloom.y) / bloom.radius;
              return Math.max(0, 1 - Math.hypot(dx, dy)) ** 0.8;
            })();
      const place = near * toward * (0.6 + grain * 0.4);
      const alpha = Math.min(1, place) * strength;
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
 * The handle `/api/public/handles/<handle>/card.png` or `.../pass-strip.png` names, or undefined when the path
 * names none. The shape is a handle's own, so nothing else is ever sent on to the api: a path is read here,
 * never trusted.
 */
export function handleOf(pathname: string): string | undefined {
  const match = /^\/api\/public\/handles\/([^/]+)\/(?:card|pass-strip)\.png$/.exec(pathname);
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

/**
 * A sentence cut to fit, at the last word that still does, with an ellipsis where something was dropped. satori
 * has no line clamp, so a bio nobody kept short would otherwise push the rest of the band off the picture.
 */
export function clampWords(text: string, limit: number): string {
  const tidy = text.trim().replace(/\s+/gu, ' ');
  if (Array.from(tidy).length <= limit) return tidy;
  const cut = Array.from(tidy).slice(0, limit).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/u, '')}…`;
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

/**
 * The band across an Apple Wallet pass (the owner, 26 October 2026): 375 × 144 points at three pixels to the
 * point, which is the one size Apple draws a store card's strip at. It carries the same face and lockup as the
 * share card, so the pass reads as ours rather than as Apple's default furniture. It is short and wide, so it is
 * read across: the person on the left, their own sentence on the right.
 */
export const STRIP_WIDTH = 1125;
export const STRIP_HEIGHT = 432;

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

/**
 * The pass's band. The pass already draws the person's name (`logoText`, in its own header) and their address
 * (the code's alt text, under the code), so a band that drew either again would be spending the one picture the
 * pass has on words already on it. It draws what the pass cannot: the person, large, and their own sentence.
 *
 * The face is the hero — three quarters of the band's height — with the dash field gathered behind it, and the
 * lockup and the bio stand in the half the old band left empty.
 */
export function stripTree(source: CardSource, assets: CardAssets): Element {
  /** Nearly the whole height of the band: the picture is what somebody holds the pass up to show (the owner). */
  const FACE = 324;
  const EDGE = 64;
  const TOP = (STRIP_HEIGHT - FACE) / 2;
  /** A ring, so a dark photograph still ends somewhere against a dark pass. */
  const RING = 'rgba(235, 237, 239, 0.14)';
  /** Where the words start, and how much room they have between the face and the far edge. */
  const COLUMN = EDGE + FACE + 56;
  const COLUMN_WIDTH = STRIP_WIDTH - COLUMN - EDGE;
  /** As many letters of the bio as three lines of this column hold, measured on the drawn band. */
  const BIO_LIMIT = 94;

  const face =
    source.picture === undefined
      ? el(
          'div',
          {
            style: {
              display: 'flex',
              width: `${String(FACE)}px`,
              height: `${String(FACE)}px`,
              borderRadius: `${String(FACE / 2)}px`,
              background: ACCENT,
              color: '#ffffff',
              fontSize: '132px',
              fontWeight: 600,
              fontFamily: 'Host Grotesk',
              letterSpacing: '-0.02em',
              alignItems: 'center',
              justifyContent: 'center',
              border: `3px solid ${RING}`,
            },
          },
          initialsOf(source.name),
        )
      : el('img', {
          src: source.picture,
          width: FACE,
          height: FACE,
          style: { borderRadius: `${String(FACE / 2)}px`, objectFit: 'cover', border: `3px solid ${RING}` },
        });

  return el(
    'div',
    {
      style: {
        display: 'flex',
        width: `${String(STRIP_WIDTH)}px`,
        height: `${String(STRIP_HEIGHT)}px`,
        // No ground of its own: the pass's own background shows through, so the band has no edge where it ends
        // (the owner, 26 October 2026). A seam across a pass reads as a mistake, not a design.
        background: 'transparent',
        position: 'relative',
        fontFamily: 'Inter',
      },
    },
    el('img', {
      src: fieldImage(STRIP_WIDTH, STRIP_HEIGHT, {
        sideways: false,
        strength: 1,
        // Off the face and a little low: most of a bloom centred on the face would be behind it, and the band
        // would keep only its fringe. Thrown down and to the right, the blue breaks out past the picture and
        // runs under the words, which is where there is room for it.
        bloom: { x: EDGE + FACE * 0.78, y: STRIP_HEIGHT * 0.62, radius: FACE * 2.4 },
      }),
      width: STRIP_WIDTH,
      height: STRIP_HEIGHT,
      style: { position: 'absolute', left: '0px', top: '0px' },
    }),
    el(
      'div',
      { style: { display: 'flex', position: 'absolute', left: `${String(EDGE)}px`, top: `${String(TOP)}px` } },
      face,
    ),
    el(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: `${String(COLUMN)}px`,
          top: `${String(TOP)}px`,
          height: `${String(FACE)}px`,
          width: `${String(COLUMN_WIDTH)}px`,
          justifyContent: 'center',
        },
      },
      el('img', { src: assets.wordmark, width: 116, height: 28, style: { opacity: 0.75, marginBottom: '26px' } }),
      // The one line of the band its owner writes: the profile's bio, from the link page editor. A page with
      // none carries the same sentence its share card does, so the band is never a face beside a gap.
      el(
        'div',
        {
          style: {
            display: 'flex',
            fontSize: '42px',
            fontWeight: 600,
            color: TEXT,
            fontFamily: 'Host Grotesk',
            letterSpacing: '-0.02em',
            lineHeight: 1.18,
          },
        },
        clampWords(source.description, BIO_LIMIT),
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

/**
 * The edge cache tags a card is filed under (spec 0058, AC-23): the handle in its address and the page's current one,
 * as the profile read answered it, so the page's Live or Private switch deletes the card from the edge at once.
 */
export function cardCacheTags(handle: string, profile: unknown): readonly string[] {
  const current =
    typeof profile === 'object' && profile !== null && 'handle' in profile && typeof profile.handle === 'string'
      ? profile.handle
      : undefined;
  return linkPageCacheTags(handle, current);
}

/**
 * A versioned card is the same until the page changes, but the page can be made Private (spec 0058, AC-23), and a
 * year's `immutable` copy would outlive that in every cache that took it. So it is kept five minutes, filed under the
 * page's cache tag (`link-page:<handle>`), which the switch deletes from the edge at once.
 */
export const CARD_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
/** Without a version (somebody typed the address, or the page sent none), the same five minutes. */
export const CARD_CACHE_CONTROL_UNVERSIONED = 'public, max-age=300, s-maxage=300';
/** A card drawn from the address alone, because the read missed: kept a minute, so the real one follows soon. */
export const CARD_CACHE_CONTROL_MISSED = 'public, max-age=60, s-maxage=60';
