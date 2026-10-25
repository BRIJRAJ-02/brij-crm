// The link page's look (spec 0054): six names, never values. Each key is a word from a closed set, so the database
// holds no colour, size, radius, font stack or duration, the stylesheet turns each word into token variables, and
// there is nothing to sanitise. A key outside its set, a missing key or an extra one is refused before anything is
// written. Plain Zod with no oRPC, so the editor, the api and the public page share one definition.
import * as z from 'zod';
import { HUES } from '../values/hue-list.ts';

/** The page's background and what sits on it (AC-5408). */
export const PAGE_GROUNDS = ['plain', 'paper', 'tint', 'ink'] as const;
/** The corner every row and button takes (AC-5409). */
export const PAGE_SHAPES = ['soft', 'pill', 'square'] as const;
/** How a row is filled (AC-5409). */
export const PAGE_FILLS = ['plain', 'soft', 'outline', 'solid'] as const;
/** The family the page draws with, both of which the repo already self hosts (AC-5410). */
export const PAGE_FONTS = ['sans', 'mono'] as const;
/** Light or dark is the owner's call, not the visitor's system setting (AC-5406). */
export const PAGE_MODES = ['light', 'dark'] as const;

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
  })
  // No unknown key: a look is exactly these six, so there is never a field the page doesn't draw.
  .strict();
/** A page's whole look. */
export type PageTheme = z.infer<typeof PageTheme>;

/** The look a person who has never touched it reads (AC-5401): the page spec 0051 ships, exactly. */
export const DEFAULT_PAGE_THEME: PageTheme = Object.freeze({
  ground: 'plain',
  hue: 'blue',
  mode: 'light',
  shape: 'soft',
  fill: 'plain',
  font: 'sans',
});

/**
 * The named starting points the editor offers (AC-5420). The name is never stored: picking one writes its six keys
 * and nothing more, so a look can never drift out of step with the name it was picked under.
 */
export const PAGE_THEME_PRESETS = [
  { id: 'plain', theme: DEFAULT_PAGE_THEME },
  { id: 'paper', theme: { ...DEFAULT_PAGE_THEME, ground: 'paper' } },
  { id: 'bold', theme: { ...DEFAULT_PAGE_THEME, ground: 'tint', shape: 'pill', fill: 'solid' } },
  { id: 'ink', theme: { ...DEFAULT_PAGE_THEME, ground: 'ink', mode: 'dark', fill: 'outline' } },
  { id: 'quiet', theme: { ...DEFAULT_PAGE_THEME, ground: 'paper', shape: 'square', font: 'mono' } },
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
    one.font === other.font
  );
}
