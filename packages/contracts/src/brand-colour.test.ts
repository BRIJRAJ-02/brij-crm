// The contrast guard (spec 0060, AC-5 to AC-7): over thousands of random hexes and the hard cases, every colour it
// answers meets AA on every surface, in light and in dark, keeps its hue, and says it moved one only when it did.
import { describe, expect, it } from 'vitest';
import {
  BRAND_HEX_PATTERN,
  brandProperties,
  brandVariables,
  colourDelta,
  CONTROL_CONTRAST,
  contrastRatio,
  DARK_SURFACES,
  LIGHT_SURFACES,
  NOTICEABLE_DELTA,
  TEXT_CONTRAST,
  type BrandSwatch,
} from './brand-colour.ts';

/** A seeded generator, so a failure names a hex that fails again. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const random = seeded(60);
const randomHex = (): string =>
  `#${Math.floor(random() * 0x1000000)
    .toString(16)
    .padStart(6, '0')}`;

/** The library's nine hues, as the tag text tokens draw them, and the colours that are hardest to read. */
const HARD = [
  '#000000',
  '#ffffff',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#ff00ff',
  '#808080',
  '#777777',
  '#1f5fd6',
  '#d92d20',
  '#f79009',
  '#eaaa08',
  '#84cc16',
  '#16a34a',
  '#0ea5e9',
  '#2563eb',
  '#7c3aed',
  '#6b7280',
];

const HEXES = [...HARD, ...Array.from({ length: 5000 }, randomHex)];

/**
 * Every way `swatch` falls short on `surfaces`, as a line naming the colours: none when it meets AA everywhere.
 * Counted in plain code and asserted once per run, so thousands of hexes check in a second rather than through
 * tens of thousands of `expect` calls (which timed out on CI's busy runners, 31 Oct 2026).
 */
function shortfalls(swatch: BrandSwatch, surfaces: readonly string[]): string[] {
  const found: string[] = [];
  for (const surface of surfaces) {
    if (!(contrastRatio(swatch.accent, surface) >= CONTROL_CONTRAST))
      found.push(`accent ${swatch.accent} on ${surface}`);
    if (!(contrastRatio(swatch.link, surface) >= TEXT_CONTRAST)) found.push(`link ${swatch.link} on ${surface}`);
  }
  if (!(contrastRatio(swatch.onAccent, swatch.accent) >= TEXT_CONTRAST)) {
    found.push(`on accent ${swatch.onAccent} on ${swatch.accent}`);
  }
  for (const colour of [swatch.accent, swatch.onAccent, swatch.link]) {
    if (!BRAND_HEX_PATTERN.test(colour)) found.push(`not a hex: ${colour}`);
  }
  return found;
}

// Thousands of colours each: a second or two here, many times that on CI's shared runners while every package's
// suite runs beside it, so the walks get a minute rather than the default five seconds.
describe('brandVariables', { timeout: 60_000 }, () => {
  it('meets AA on every surface in light and dark for every accent (AC-5)', () => {
    const found: string[] = [];
    for (const accent of HEXES) {
      const colours = brandVariables({ accent });
      found.push(...shortfalls(colours.light, LIGHT_SURFACES), ...shortfalls(colours.dark, DARK_SURFACES));
    }
    expect(found).toEqual([]);
  });

  it('holds a separate dark accent to the dark surfaces too (AC-6)', () => {
    const found: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const colours = brandVariables({ accent: randomHex(), accentDark: randomHex() });
      found.push(...shortfalls(colours.light, LIGHT_SURFACES), ...shortfalls(colours.dark, DARK_SURFACES));
    }
    expect(found).toEqual([]);
  });

  it('leaves an accent that already reads alone, and moves only one that does not', () => {
    // The product's own accent passes on every light surface as it is.
    const kept = brandVariables({ accent: '#1f5fd6' }).light;
    expect(kept.accent).toBe('#1f5fd6');
    expect(kept.delta).toBeLessThanOrEqual(NOTICEABLE_DELTA);
    expect(kept.adjusted).toBe(false);
    // Pure yellow is unreadable as a link on white: it is moved, noticeably, and said so.
    const moved = brandVariables({ accent: '#ffff00' });
    expect(moved.light.adjusted).toBe(true);
    expect(moved.adjusted).toBe(true);
  });

  it('sets the adjusted flag exactly when the colour moved by more than the noticeable difference', () => {
    for (const accent of HEXES.slice(0, 2000)) {
      const { light } = brandVariables({ accent });
      const delta = Math.max(colourDelta(accent, light.accent), colourDelta(accent, light.link));
      expect(light.adjusted).toBe(Math.round(delta * 10) / 10 > NOTICEABLE_DELTA);
    }
  });

  it('never counts a dark colour it derived as the owner’s colour moved', () => {
    const colours = brandVariables({ accent: '#1f5fd6' });
    expect(colours.dark.accent).not.toBe('#1f5fd6');
    expect(colours.adjusted).toBe(false);
  });

  it('keeps the hue while it moves the lightness', () => {
    const hueOf = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return Number.NaN;
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    // A saturated blue darkened for light and lifted for dark is still blue.
    for (const swatch of Object.values(brandVariables({ accent: '#4d8dff' })).filter(
      (value): value is BrandSwatch => typeof value === 'object',
    )) {
      expect(Math.abs(hueOf(swatch.link) - hueOf('#4d8dff'))).toBeLessThan(12);
    }
  });

  it('refuses anything but a checked hex, so nothing typed reaches CSS (AC-22)', () => {
    for (const bad of ['#12345g', 'red', '#123456;}', '#1234567', '#FFF', 'url(x)']) {
      expect(() => brandVariables({ accent: bad })).toThrow(TypeError);
    }
  });

  it('answers the same properties for the editor and the page, in a fixed order (AC-7)', () => {
    const colours = brandVariables({ accent: '#e11d48' });
    expect(brandProperties(colours).map(([name]) => name)).toEqual([
      '--brand-accent',
      '--brand-on-accent',
      '--brand-link',
      '--brand-accent-dark',
      '--brand-on-accent-dark',
      '--brand-link-dark',
    ]);
    expect(brandProperties(brandVariables({ accent: '#e11d48' }))).toEqual(brandProperties(colours));
  });
});
