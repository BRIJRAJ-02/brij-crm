// WCAG 2 contrast over the token pairs the design system's components draw.
// The house rule: text 4.5:1, control outlines 3.5:1, accent marks 3:1, in
// both themes. A failing pair is raised, never fixed quietly in code.
import type { ColorFamily } from './grammar.ts';

/** A foreground drawn on each of its backgrounds, and the ratio it must reach. */
export interface ContrastRule {
  readonly foregrounds: readonly string[];
  readonly backgrounds: readonly string[];
  readonly minimum: number;
}

const SURFACES = [
  'surface',
  'surface-sidebar',
  'surface-raised',
  'surface-subtle',
  'surface-hover',
  'surface-selected',
  'surface-column',
];

/**
 * The tag hues, read from the `tag-<hue>-bg` tokens, so a hue the artifact
 * adds is checked with no code change.
 */
export function tagHues(color: ColorFamily): string[] {
  return color.tokens.flatMap((token) => /^tag-(.+)-bg$/.exec(token.name)?.[1] ?? []);
}

/** Every pair spec 0002 holds to its minimum (AC-4). */
export function contrastRules(color: ColorFamily): ContrastRule[] {
  return [
    { foregrounds: ['text', 'text-secondary', 'text-tertiary'], backgrounds: SURFACES, minimum: 4.5 },
    { foregrounds: ['link'], backgrounds: ['surface', 'surface-raised', 'accent-soft'], minimum: 4.5 },
    { foregrounds: ['on-accent'], backgrounds: ['accent', 'accent-hover'], minimum: 4.5 },
    { foregrounds: ['on-inverse'], backgrounds: ['surface-inverse'], minimum: 4.5 },
    {
      foregrounds: ['danger'],
      backgrounds: ['surface', 'surface-subtle', 'surface-raised', 'surface-hover', 'surface-selected'],
      minimum: 4.5,
    },
    { foregrounds: ['success'], backgrounds: ['surface', 'surface-raised', 'surface-hover'], minimum: 4.5 },
    ...tagHues(color).map((hue) => ({
      foregrounds: [`tag-${hue}-text`],
      backgrounds: [`tag-${hue}-bg`],
      minimum: 4.5,
    })),
    {
      foregrounds: ['control-border'],
      backgrounds: ['surface', 'surface-sidebar', 'surface-raised', 'surface-subtle', 'surface-hover'],
      minimum: 3.5,
    },
    { foregrounds: ['accent'], backgrounds: ['surface', 'surface-raised'], minimum: 3 },
  ];
}

/** One measured pair in one theme. `problem` is set when it couldn't be measured. */
export interface ContrastCheck {
  readonly theme: 'light' | 'dark';
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly ratio: number;
  readonly problem?: string;
}

const OPAQUE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const ALIAS = /^\{(.+)\}$/;

/**
 * A token's colour in one theme as opaque hex, following aliases. Colour
 * functions and alpha are refused, since their contrast depends on what they
 * sit on.
 */
export function resolveColor(color: ColorFamily, name: string, theme: 'light' | 'dark'): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`"${name}" (${theme}) aliases in a loop.`);
    seen.add(current);
    const token = color.tokens.find((candidate) => candidate.name === current);
    if (token === undefined) throw new Error(`"${current}" is not a colour token.`);
    const value = typeof token.value === 'string' ? token.value : token.value[theme];
    if (value === undefined) throw new Error(`"${current}" has no ${theme} value.`);
    const alias = ALIAS.exec(value);
    if (alias) {
      current = alias[1] ?? '';
      continue;
    }
    if (!OPAQUE_HEX.test(value)) {
      throw new Error(`"${current}" (${theme}) is "${value}", not opaque hex, so its contrast can't be measured.`);
    }
    return value;
  }
}

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of an opaque `#rgb` or `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const full = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (digit) => digit + digit) : hex;
  return 0.2126 * channel(full, 1) + 0.7152 * channel(full, 3) + 0.0722 * channel(full, 5);
}

/** WCAG 2 contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** Measures every rule's pairs in both themes. */
export function checkContrast(color: ColorFamily): ContrastCheck[] {
  return (['light', 'dark'] as const).flatMap((theme) =>
    contrastRules(color).flatMap((rule) =>
      rule.foregrounds.flatMap((foreground) =>
        rule.backgrounds.map((background): ContrastCheck => {
          const base = { theme, foreground, background, minimum: rule.minimum };
          try {
            const ratio = contrastRatio(resolveColor(color, foreground, theme), resolveColor(color, background, theme));
            return { ...base, ratio };
          } catch (error) {
            return { ...base, ratio: 0, problem: error instanceof Error ? error.message : String(error) };
          }
        }),
      ),
    ),
  );
}
