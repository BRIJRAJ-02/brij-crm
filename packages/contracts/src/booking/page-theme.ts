// The link page's look (spec 0054, widened by spec 0060 to ten keys): names, never values. Each key is a word from a closed set, so the database
// holds no colour, size, radius, font stack or duration, the stylesheet turns each word into token variables, and
// there is nothing to sanitise. A key outside its set, a missing key or an extra one is refused before anything is
// written. Plain Zod with no oRPC, so the editor, the api and the public page share one definition.
import * as z from 'zod';
import { HUES } from '../values/hue-list.ts';

/**
 * The page's background and what sits on it (AC-5408; spec 0060, AC-10). `gradient` and `pattern` draw the one
 * named by their own key; `image` draws the photo its owner uploaded, and draws as `plain` until there is one.
 */
export const PAGE_GROUNDS = ['plain', 'paper', 'tint', 'ink', 'gradient', 'pattern', 'image'] as const;
/** The eight curated gradients, built from tokens only, each with a light and a dark form (spec 0060, AC-10). */
export const PAGE_GRADIENTS = ['dawn', 'dusk', 'mint', 'ocean', 'peach', 'grape', 'sand', 'graphite'] as const;
/** The four patterns, from tokens only, each with a light and a dark form (spec 0060, AC-10). */
export const PAGE_PATTERNS = ['dots', 'grid', 'lines', 'waves'] as const;
/** The head of the page: centred (spec 0054's), a cover photo band, or the avatar to the left (spec 0060, AC-13). */
export const PAGE_HEADERS = ['centred', 'cover', 'left'] as const;
/** The avatar's shape, or none at all (spec 0060, AC-13). */
export const PAGE_AVATARS = ['circle', 'rounded', 'none'] as const;
/**
 * How the blocks lay out (spec 0061, AC-6103): one column of rows, or tiles on a grid. Optional on the look, absent
 * is `list`, so every look stored before it draws as it did; the database's check holds the same two words.
 */
export const PAGE_LAYOUTS = ['list', 'grid'] as const;
/** The corner every row and button takes (AC-5409). */
export const PAGE_SHAPES = ['soft', 'pill', 'square'] as const;
/** How a row is filled (AC-5409). */
export const PAGE_FILLS = ['plain', 'soft', 'outline', 'solid'] as const;
/**
 * The font pack the page draws with (AC-5410; spec 0060, AC-12): a heading and a body font, all self hosted.
 * `sans` is Modern (Inter) and `mono` is Mono (JetBrains Mono), the two spec 0054 shipped.
 */
export const PAGE_FONTS = [
  'sans',
  'mono',
  'grotesk',
  'editorial',
  'classic',
  'friendly',
  'geometric',
  'display',
] as const;
/** Light, dark, or `system`, which follows the visitor's own setting (AC-5406; spec 0060, AC-15). */
export const PAGE_MODES = ['light', 'dark', 'system'] as const;

/** The one sentence every refusal of a look uses (AC-5402). */
export const PAGE_THEME_REFUSAL = 'That isn’t one of the looks you can pick.';

/**
 * A page's whole look. Every key is required and the record is stored whole, so a read never merges a partial
 * theme with a default and what is stored is always exactly what the page draws.
 */
export const PageTheme = z
  .object({
    ground: z.enum(PAGE_GROUNDS, { error: PAGE_THEME_REFUSAL }),
    hue: z.enum(HUES, { error: PAGE_THEME_REFUSAL }),
    mode: z.enum(PAGE_MODES, { error: PAGE_THEME_REFUSAL }),
    shape: z.enum(PAGE_SHAPES, { error: PAGE_THEME_REFUSAL }),
    fill: z.enum(PAGE_FILLS, { error: PAGE_THEME_REFUSAL }),
    font: z.enum(PAGE_FONTS, { error: PAGE_THEME_REFUSAL }),
    gradient: z.enum(PAGE_GRADIENTS, { error: PAGE_THEME_REFUSAL }),
    pattern: z.enum(PAGE_PATTERNS, { error: PAGE_THEME_REFUSAL }),
    header: z.enum(PAGE_HEADERS, { error: PAGE_THEME_REFUSAL }),
    avatar: z.enum(PAGE_AVATARS, { error: PAGE_THEME_REFUSAL }),
    layout: z.enum(PAGE_LAYOUTS, { error: PAGE_THEME_REFUSAL }).optional(),
  })
  // No unknown key: a look is exactly these ten, so there is never a field the page doesn't draw.
  .strict();
/** A page's whole look. */
export type PageTheme = z.infer<typeof PageTheme>;

/**
 * The look a person who has never touched it reads (AC-5401): the page spec 0051 ships, exactly. The four keys
 * spec 0060 added default to what every page drew before them (AC-17), and the migration that added them wrote
 * these defaults into every stored look.
 */
export const DEFAULT_PAGE_THEME: PageTheme = Object.freeze({
  ground: 'plain',
  hue: 'blue',
  mode: 'light',
  shape: 'soft',
  fill: 'plain',
  font: 'sans',
  gradient: 'dawn',
  pattern: 'dots',
  header: 'centred',
  avatar: 'circle',
});

/**
 * The named starting points the editor offers (AC-5420). The name is never stored: picking one writes all its keys
 * and nothing more, so a look can never drift out of step with the name it was picked under.
 */
export const PAGE_THEME_PRESETS = [
  { id: 'plain', theme: DEFAULT_PAGE_THEME },
  { id: 'paper', theme: { ...DEFAULT_PAGE_THEME, ground: 'paper' } },
  { id: 'bold', theme: { ...DEFAULT_PAGE_THEME, ground: 'tint', shape: 'pill', fill: 'solid' } },
  { id: 'ink', theme: { ...DEFAULT_PAGE_THEME, ground: 'ink', mode: 'dark', fill: 'outline' } },
  { id: 'quiet', theme: { ...DEFAULT_PAGE_THEME, ground: 'paper', shape: 'square', font: 'mono' } },
  // Spec 0060's nine (AC-8). Gallery needs a photo: the editor offers it once one is uploaded, else the upload.
  {
    id: 'dawn',
    theme: {
      ...DEFAULT_PAGE_THEME,
      ground: 'gradient',
      gradient: 'dawn',
      shape: 'pill',
      fill: 'soft',
      font: 'friendly',
    },
  },
  {
    id: 'ocean',
    theme: { ...DEFAULT_PAGE_THEME, ground: 'gradient', gradient: 'ocean', fill: 'solid', font: 'geometric' },
  },
  {
    id: 'mint',
    theme: { ...DEFAULT_PAGE_THEME, ground: 'gradient', gradient: 'mint', fill: 'outline', font: 'grotesk' },
  },
  {
    id: 'studio',
    theme: {
      ...DEFAULT_PAGE_THEME,
      ground: 'pattern',
      pattern: 'grid',
      shape: 'square',
      fill: 'outline',
      font: 'grotesk',
    },
  },
  { id: 'editorial', theme: { ...DEFAULT_PAGE_THEME, ground: 'paper', header: 'left', font: 'editorial' } },
  {
    id: 'night',
    theme: { ...DEFAULT_PAGE_THEME, ground: 'ink', mode: 'dark', fill: 'outline', font: 'display' },
  },
  {
    id: 'peach',
    theme: {
      ...DEFAULT_PAGE_THEME,
      ground: 'gradient',
      gradient: 'peach',
      shape: 'pill',
      fill: 'solid',
      font: 'friendly',
    },
  },
  {
    id: 'graphite',
    theme: { ...DEFAULT_PAGE_THEME, ground: 'gradient', gradient: 'graphite', mode: 'dark', font: 'mono' },
  },
  {
    id: 'gallery',
    theme: { ...DEFAULT_PAGE_THEME, ground: 'image', header: 'cover', avatar: 'rounded', font: 'classic' },
  },
] as const satisfies readonly { readonly id: string; readonly theme: PageTheme }[];

/** One of the named starting points. */
export type PageThemePreset = (typeof PAGE_THEME_PRESETS)[number]['id'];

/** Whether two looks are the same, key for key: the editor marks the preset a person is standing on. */
export function sameTheme(one: PageTheme, other: PageTheme): boolean {
  return (
    one.ground === other.ground &&
    one.hue === other.hue &&
    one.mode === other.mode &&
    one.shape === other.shape &&
    one.fill === other.fill &&
    one.font === other.font &&
    one.gradient === other.gradient &&
    one.pattern === other.pattern &&
    one.header === other.header &&
    one.avatar === other.avatar
  );
}

/** A version as a look's paths carry it: the short hex the server made. */
const LOOK_VERSION = /^[0-9a-f]{12}$/;
/** A handle as a path takes it (the same rule `HANDLE_PATTERN` holds handles to). */
const LOOK_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What a link page is told of its look beyond the names (spec 0060): the version its own stylesheet is served at
 * (the accent pair and any photo, AC-14), and the versions of its cover and photo ground. Each is absent when there
 * is none: no stylesheet means the product's accent and no photos.
 */
export const PublicLook = z.object({
  version: z.string().regex(LOOK_VERSION).optional(),
  cover: z.string().regex(LOOK_VERSION).optional(),
  ground: z.string().regex(LOOK_VERSION).optional(),
});
/** What a link page is told of its look beyond the names. */
export type PublicLook = z.infer<typeof PublicLook>;

/** The two photos a link page may carry (spec 0060, AC-10, AC-13). */
export const PAGE_IMAGE_SLOTS = ['cover', 'ground'] as const;
/** One of the two photos. */
export type PageImageSlot = (typeof PAGE_IMAGE_SLOTS)[number];

/** A link page's own stylesheet: `/api/public/handles/<handle>/look.css?v=<version>`, or undefined for a bad part. */
export function lookStylesheetPath(handle: string, version: string): string | undefined {
  if (!LOOK_HANDLE.test(handle) || handle.length > 40 || !LOOK_VERSION.test(version)) return undefined;
  return `/api/public/handles/${handle}/look.css?v=${version}`;
}

/**
 * A link page's cover or photo ground: `/api/public/profiles/<handle>/<slot>?v=<version>`. Under `profiles`, as the
 * picture is, since `cover` is a valid page slug and `/handles/<handle>/<slug>` names a booking page.
 */
export function lookImagePath(handle: string, slot: PageImageSlot, version: string): string | undefined {
  if (!LOOK_HANDLE.test(handle) || handle.length > 40 || !LOOK_VERSION.test(version)) return undefined;
  return `/api/public/profiles/${handle}/${slot}?v=${version}`;
}
