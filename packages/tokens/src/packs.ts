// The link page's font packs (spec 0060, AC-12): which file each pack draws its heading with, for the shells'
// `<link rel="preload" as="font">` (AC-21), and its body face where the pack has one of its own. Keyed by the
// `font` names of `PageTheme` in `@crm/contracts`; `packs.test.ts` holds this map to `packs.css` and to that list.
// Plain data with no imports, so an edge shell reads it without loading anything else.

/** One pack's files, by their names in `packages/tokens/fonts/`. */
export interface FontPack {
  /** The file the page's name and row titles draw with: the one a shell preloads. */
  readonly heading: string;
  /** The file sentences draw with, when it isn't Inter (the design system's own, which every page loads). */
  readonly body?: string;
}

/**
 * Every pack, by the `font` key a look stores. Modern and Mono are spec 0054's (Inter, JetBrains Mono); the other
 * six are spec 0060's, each one face beside Inter, or one face for both.
 */
export const FONT_PACKS = {
  sans: { heading: 'Inter-Variable-latin.woff2' },
  mono: { heading: 'JetBrainsMono-Variable-latin.woff2' },
  grotesk: { heading: 'HostGrotesk-Variable-latin.woff2' },
  editorial: { heading: 'Fraunces-Variable-latin.woff2' },
  classic: { heading: 'Newsreader-Variable-latin.woff2', body: 'Newsreader-Variable-latin.woff2' },
  friendly: { heading: 'BricolageGrotesque-Variable-latin.woff2' },
  geometric: { heading: 'Outfit-Variable-latin.woff2', body: 'Outfit-Variable-latin.woff2' },
  display: { heading: 'InstrumentSerif-Regular-latin.woff2' },
} as const satisfies Record<string, FontPack>;

/** A pack's name, as a look stores it. */
export type FontPackName = keyof typeof FONT_PACKS;
