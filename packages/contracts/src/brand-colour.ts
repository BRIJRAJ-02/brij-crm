// The contrast guard (spec 0060, AC-5 to AC-7): one pure function turns a brand's accent into the colours a page
// draws, in light and in dark, each meeting WCAG AA on every surface the page can put it on. It keeps the accent's
// hue and moves only its lightness (in OKLCH), giving up chroma only where a colour would leave sRGB. The editor
// preview (through the CSSOM) and the live page (through the served stylesheet) both call this, so the preview is
// exactly what visitors see. Plain TypeScript with no Zod and no imports, so the editor's bundle stays small and
// the server and the browser run the same lines.

/** A colour as the guard takes and gives it: `#` and six lowercase hex digits, nothing else. */
export const BRAND_HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** The least contrast of text on the accent, and of the accent as link text on the page (WCAG 1.4.3). */
export const TEXT_CONTRAST = 4.5;
/** The least contrast of the accent as a control's fill, edge or focus ring on the page (WCAG 1.4.11). */
export const CONTROL_CONTRAST = 3;
/** How far (OKLab ΔE × 100) the guard may move a colour before the picker says so (AC-6). */
export const NOTICEABLE_DELTA = 10;

/**
 * Every surface a page in light mode puts the accent on: the page grounds (plain, paper, the nine tints), the raised
 * card a photo ground's blocks sit on, and the soft card fill. The accent must hold against the darkest of them. A
 * stylesheet that draws the accent on any other light surface must add it here, so the property test covers it.
 */
export const LIGHT_SURFACES: readonly string[] = [
  '#fdfdff',
  '#feffff',
  '#f6f7fa',
  '#e8f0ff',
  '#f1f2f4',
  '#fce6ec',
  '#fce9e2',
  '#fbeecb',
  '#f0f5ce',
  '#d9f4e4',
  '#d9eeff',
  '#dfe9ff',
  '#f0eafe',
];

/**
 * Every surface a page in dark mode puts the accent on, as `LIGHT_SURFACES` for light. A light mode page on the ink
 * ground is dark to look at, so it draws with the dark set.
 */
export const DARK_SURFACES: readonly string[] = [
  '#18191c',
  '#202225',
  '#141518',
  '#1e2b47',
  '#2e3238',
  '#3a1c23',
  '#3a2419',
  '#342c10',
  '#2c3112',
  '#11301f',
  '#0f2d3d',
  '#1a2233',
  '#29204a',
  '#18191d',
];

/** The two colours text on the accent may be: whichever reads better, which is always at least 4.58:1. */
const ON_LIGHT = '#000000';
const ON_DARK = '#ffffff';

/** One mode's colours. */
export interface BrandSwatch {
  /** The fill of buttons and the chosen day, and the edge and focus ring of controls: 3:1 on every surface. */
  readonly accent: string;
  /** Text and icons on `accent`: 4.5:1 on it. */
  readonly onAccent: string;
  /** The accent as link text on the page: 4.5:1 on every surface. */
  readonly link: string;
  /** How far the guard moved the colour it was given for this mode, the larger of `accent` and `link`. */
  readonly delta: number;
  /** Whether that is more than `NOTICEABLE_DELTA`. */
  readonly adjusted: boolean;
}

/** What a page draws for a brand: both modes, and whether the picker should say it moved the owner's colour. */
export interface BrandVariables {
  readonly light: BrandSwatch;
  readonly dark: BrandSwatch;
  /**
   * Whether the picker shows "Adjusted so text stays readable" (AC-6): the light colour moved noticeably, or a dark
   * colour the owner set did. A dark colour derived from the light one always moves, so it never counts.
   */
  readonly adjusted: boolean;
}

/** The accent the owner set, and the separate dark one under More (absent: derived from `accent`). */
export interface BrandAccent {
  readonly accent: string;
  readonly accentDark?: string | undefined;
}

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

/** A hex's three channels, 0 to 1. Only a hex that passed `BRAND_HEX_PATTERN` reaches here. */
function channels(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two hexes, 1 to 21. */
export function contrastRatio(one: string, other: string): number {
  const [a, b] = [luminance(one), luminance(other)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The least contrast `hex` has against any of `surfaces`. */
function leastContrast(hex: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(hex, surface)));
}

/** A hex in OKLab. */
function toOklab(hex: string): Lab {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB, unclamped: a channel outside 0 to 1 is out of gamut. */
function labToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPSILON = 1e-6;
const inGamut = (rgb: Rgb): boolean => rgb.every((c) => c >= -EPSILON && c <= 1 + EPSILON);

/** A linear sRGB colour as a lowercase hex, each channel clamped and rounded. */
function linearToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(fromLinear(Math.min(1, Math.max(0, c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The colour at lightness `L` with the hue `h` and as much of the chroma `C` as sRGB holds there: the chroma is
 * given up, never the hue, so a brand's blue stays blue however far the guard moves it.
 */
function atLightness(L: number, C: number, h: number): string {
  const at = (chroma: number): Rgb => labToLinear([L, chroma * Math.cos(h), chroma * Math.sin(h)]);
  const full = at(C);
  if (inGamut(full)) return linearToHex(full);
  let [low, high] = [0, C];
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (inGamut(at(middle))) low = middle;
    else high = middle;
  }
  return linearToHex(at(low));
}

/** How far apart two colours look: OKLab distance × 100, about the scale of CIE ΔE. */
export function colourDelta(one: string, other: string): number {
  const [a, b] = [toOklab(one), toOklab(other)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/**
 * `source`, or the colour nearest it in lightness with its hue, that has at least `ratio` against every one of
 * `surfaces`. Light surfaces push it darker, dark ones lighter. Black and white end each search and always pass, so
 * there is always an answer.
 */
function fit(source: string, surfaces: readonly string[], ratio: number, darker: boolean): string {
  if (leastContrast(source, surfaces) >= ratio) return source;
  const [L, a, b] = toOklab(source);
  const [C, h] = [Math.hypot(a, b), Math.atan2(b, a)];
  const passes = (lightness: number) => leastContrast(atLightness(lightness, C, h), surfaces) >= ratio;
  // Passing is the range from the far end (0 darker, 1 lighter) to some edge: find that edge, nearest the source.
  let [pass, fail] = darker ? [0, Math.min(1, L)] : [1, Math.max(0, L)];
  for (let step = 0; step < 32; step += 1) {
    const middle = (pass + fail) / 2;
    if (passes(middle)) pass = middle;
    else fail = middle;
  }
  // Rounding to a hex can land a hair short of the ratio: step on until it doesn't.
  let found = atLightness(pass, C, h);
  for (let lightness = pass; leastContrast(found, surfaces) < ratio;) {
    lightness = darker ? Math.max(0, lightness - 0.002) : Math.min(1, lightness + 0.002);
    found = atLightness(lightness, C, h);
    if (lightness === 0 || lightness === 1) found = darker ? '#000000' : '#ffffff';
  }
  return found;
}

/** Text on `accent`: black or white, whichever reads better. */
function onAccentOf(accent: string): string {
  return contrastRatio(accent, ON_LIGHT) >= contrastRatio(accent, ON_DARK) ? ON_LIGHT : ON_DARK;
}

/** One mode's swatch from the colour given for it. */
function swatch(source: string, surfaces: readonly string[], darker: boolean): BrandSwatch {
  const accent = fit(source, surfaces, CONTROL_CONTRAST, darker);
  const link = fit(source, surfaces, TEXT_CONTRAST, darker);
  const delta = Math.round(Math.max(colourDelta(source, accent), colourDelta(source, link)) * 10) / 10;
  return { accent, onAccent: onAccentOf(accent), link, delta, adjusted: delta > NOTICEABLE_DELTA };
}

/**
 * The colours a page draws for a brand's accent, in light and in dark (AC-5). Every colour it answers meets AA on
 * every surface in `LIGHT_SURFACES` or `DARK_SURFACES`: the accent at least 3:1 as a fill, edge or ring, text on it at
 * least 4.5:1, and the link colour at least 4.5:1. Without `accentDark`, the dark swatch is the light accent lifted.
 * Anything that isn't a checked hex throws: the contract and the database refuse it long before this.
 */
export function brandVariables(brand: BrandAccent): BrandVariables {
  const accent = brand.accent;
  const dark = brand.accentDark ?? accent;
  for (const hex of [accent, dark]) {
    if (!BRAND_HEX_PATTERN.test(hex)) throw new TypeError('A brand colour must be a checked six digit hex.');
  }
  const light = swatch(accent, LIGHT_SURFACES, true);
  const night = swatch(dark, DARK_SURFACES, false);
  return {
    light,
    dark: night,
    adjusted: light.adjusted || (brand.accentDark !== undefined && night.adjusted),
  };
}

/**
 * The custom properties a brand sets, for the served stylesheet and for the editor's CSSOM alike. The shared
 * stylesheet reads the plain names in light mode and the `-dark` names in dark (and for follow visitor, under
 * `prefers-color-scheme: dark`); nothing else in it changes.
 */
export const BRAND_PROPERTIES = {
  accent: '--brand-accent',
  onAccent: '--brand-on-accent',
  link: '--brand-link',
  accentDark: '--brand-accent-dark',
  onAccentDark: '--brand-on-accent-dark',
  linkDark: '--brand-link-dark',
} as const;

/** A brand's colours as custom property pairs, in a fixed order. */
export function brandProperties(colours: BrandVariables): readonly (readonly [string, string])[] {
  return [
    [BRAND_PROPERTIES.accent, colours.light.accent],
    [BRAND_PROPERTIES.onAccent, colours.light.onAccent],
    [BRAND_PROPERTIES.link, colours.light.link],
    [BRAND_PROPERTIES.accentDark, colours.dark.accent],
    [BRAND_PROPERTIES.onAccentDark, colours.dark.onAccent],
    [BRAND_PROPERTIES.linkDark, colours.dark.link],
  ];
}
