// The library never imports `@crm/contracts`, so `PageLook` repeats the six keys of `PageTheme` by hand. This test
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

describe('the page look the library draws', () => {
  it('knows the same six keys the contract does', () => {
    const keys = [...MODULE.matchAll(/'data-page-([a-z]+)': look\.([a-z]+),/g)].map((match) => match[1]);
    expect(new Set(keys)).toEqual(new Set(['ground', 'hue', 'mode', 'shape', 'fill', 'font']));
    // And each attribute carries the key of the same name: no crossed wires.
    for (const [, attribute, field] of MODULE.matchAll(/'data-page-([a-z]+)': look\.([a-z]+),/g)) {
      expect(attribute).toBe(field);
    }
  });

  it('has a stylesheet block for every value of every set that changes anything', () => {
    // `plain`, `light` and `sans` are the defaults the root already carries, so they need no block of their own.
    const defaults = new Set(['plain', 'light', 'sans', 'soft']);
    for (const [key, name] of [
      ['ground', 'PAGE_GROUNDS'],
      ['shape', 'PAGE_SHAPES'],
      ['fill', 'PAGE_FILLS'],
      ['font', 'PAGE_FONTS'],
    ] as const) {
      for (const value of setOf(name)) {
        if (key === 'ground' && value === 'plain') continue;
        if (key === 'shape' && value === 'soft') continue;
        if (key === 'fill' && value === 'plain') continue;
        if (key === 'font' && value === 'sans') continue;
        expect(STYLES, `${key}=${value} has a block`).toContain(`[data-page-${key}='${value}']`);
      }
      expect(defaults.size).toBeGreaterThan(0);
    }
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
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      for (const [, value] of block.matchAll(/:\s*([^;]+);/g)) {
        const kept = value.trim();
        expect(
          kept === 'none' || kept === 'transparent' || kept.startsWith('var(--'),
          `"${kept}" is a token, none or transparent`,
        ).toBe(true);
      }
    }
  });
});
