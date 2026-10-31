// The library never imports `@crm/contracts`, so `PageLook` repeats the ten keys of `PageTheme` by hand. This test
// reads the contracts' source as text and fails when the two drift apart: a key added there and not here would
// draw nothing, and a value added there and not in the stylesheet would draw as the default with no warning.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONTRACT = readFileSync(new URL('../../../../contracts/src/booking/page-theme.ts', import.meta.url), 'utf8');
const MODULE = readFileSync(new URL('./LinkPage.tsx', import.meta.url), 'utf8');
const STYLES = readFileSync(new URL('./LinkPage.module.css', import.meta.url), 'utf8');

/** The words of one closed set, as `page-theme.ts` lists them. */
function setOf(name: string): readonly string[] {
  const found = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(CONTRACT);
  expect(found, `${name} is declared in the contracts`).not.toBeNull();
  return [...(found?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '');
}

/** The words `PageLook` allows for one key, as `LinkPage.tsx` writes them. */
function lookOf(key: string): readonly string[] {
  const body = /export interface PageLook \{([^}]*)\}/.exec(MODULE)?.[1] ?? '';
  const line = new RegExp(`readonly ${key}: ([^;]*);`).exec(body)?.[1] ?? '';
  return [...line.matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '');
}

/** Each key, the contracts' list of its words, and the default the root draws with no block of its own. */
const KEYS = [
  ['ground', 'PAGE_GROUNDS', 'plain'],
  ['mode', 'PAGE_MODES', 'light'],
  ['shape', 'PAGE_SHAPES', 'soft'],
  ['fill', 'PAGE_FILLS', 'plain'],
  ['font', 'PAGE_FONTS', 'sans'],
  ['gradient', 'PAGE_GRADIENTS', undefined],
  ['pattern', 'PAGE_PATTERNS', undefined],
  ['header', 'PAGE_HEADERS', 'centred'],
  ['avatar', 'PAGE_AVATARS', 'circle'],
] as const;

/**
 * A value a look block may hold: a token, `none` or `transparent`, or a gradient or a mix built from tokens and
 * keywords alone (spec 0060: gradients and patterns may use token only functions). No number, unit or colour.
 */
function isTokenOnly(value: string): boolean {
  if (['none', 'transparent', '0', 'border-box'].includes(value) || value.startsWith('var(--')) return true;
  if (!/^(?:(?:repeating-)?(?:linear|radial)-gradient|calc)\(/.test(value)) return false;
  // Strip every token, then every keyword the functions take; nothing may be left but punctuation.
  const rest = value
    .replaceAll(/var\(--[a-z0-9-]+\)/g, '')
    .replaceAll(
      /\b(?:repeating-)?(?:linear|radial)-gradient\b|\bcalc\b|\b(?:to|at|circle|bottom|right|top|left|transparent)\b/g,
      '',
    )
    .replaceAll(/[\s(),+]/g, '');
  return rest === '';
}

describe('the page look the library draws', () => {
  it('knows the same ten keys the contract does, with the same words', () => {
    const contractKeys = [...CONTRACT.matchAll(/^\s+([a-z]+): z\.enum\(/gm)].map((match) => match[1]);
    const attributes = [...MODULE.matchAll(/'data-page-([a-z]+)':/g)].map((match) => match[1]);
    expect(new Set(attributes)).toEqual(new Set(contractKeys));
    expect(contractKeys).toHaveLength(10);
    for (const [key, name] of KEYS) {
      expect(new Set(lookOf(key)), `${key} takes the contract's words`).toEqual(new Set(setOf(name)));
    }
  });

  it('carries each key on the attribute of the same name', () => {
    for (const [, attribute, field] of MODULE.matchAll(/'data-page-([a-z]+)': look\.([a-z]+),/g)) {
      expect(attribute).toBe(field);
    }
    // Ground and header are the two worked out first, from the photos the page has.
    expect(MODULE).toContain("'data-page-ground': ground,");
    expect(MODULE).toContain("'data-page-header': header,");
  });

  it('has a stylesheet block for every value of every set that changes anything', () => {
    for (const [key, name, fallback] of KEYS) {
      if (key === 'mode') continue;
      for (const value of setOf(name)) {
        // No face is drawn by leaving the face out, in the markup: there is nothing for a block to style.
        if (value === fallback || (key === 'avatar' && value === 'none')) continue;
        expect(STYLES, `${key}=${value} has a block`).toContain(`[data-page-${key}='${value}']`);
      }
    }
    // Light and dark pin the tokens through `data-theme`; follow the visitor sets none.
    expect(MODULE).toContain("look.mode === 'system' ? {} : { 'data-theme': look.mode }");
  });

  it('draws the tint ground in every one of the library’s own nine hues', () => {
    // The nine live in the contracts' own list, which a test already holds to the tag tokens.
    const hues = readFileSync(new URL('../../../../contracts/src/values/hue-list.ts', import.meta.url), 'utf8');
    const listed = [...(/HUES = \[([^\]]*)\]/.exec(hues)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1] ?? '');
    expect(listed).toHaveLength(9);
    for (const hue of listed) {
      expect(STYLES, `the tint ground has a ${hue} block`).toContain(`[data-page-hue='${hue}']`);
    }
  });

  it('stores no colour, size or duration: the stylesheet is the only place a value lives', () => {
    // Every theme block sets custom properties from token variables; a raw value here would be a value in the data.
    const blocks = [...STYLES.matchAll(/\[data-page-[a-z]+='[a-z]+'\][^{]*\{([^}]*)\}/g)].map(
      (match) => match[1] ?? '',
    );
    expect(blocks.length).toBeGreaterThan(30);
    for (const block of blocks) {
      for (const [, property, value] of block.matchAll(/([a-z-]+):\s*([^;]+);/g)) {
        const kept = (value ?? '').replaceAll(/\s+/g, ' ').trim();
        // Layout words a block may set (a header's direction, a thumbnail's hidden row) are not values in the data.
        if (
          /^(?:display|flex-direction|align-items|align-self|text-align|flex|background-size|background-position)$/.test(
            property ?? '',
          )
        )
          continue;
        expect(isTokenOnly(kept), `${property ?? ''}: "${kept}" is a token, none or transparent`).toBe(true);
      }
    }
  });

  it('never lets a brand reach the page without its token to fall back on', () => {
    // A page with no brand draws exactly as before (AC-17): every brand name has the token it stands in for.
    for (const [, name] of STYLES.matchAll(/var\(--(brand-[a-z-]+)\)/g)) {
      expect.fail(`--${name ?? ''} is read with no fallback`);
    }
    for (const name of ['accent', 'on-accent', 'link', 'accent-soft', 'accent-border', 'accent-hover']) {
      expect(STYLES, `--page-${name} falls back to --${name}`).toMatch(
        new RegExp(`--page-${name}: var\\(--page-brand-[a-z-]+, var\\(--${name}\\)\\);`),
      );
    }
  });
});
