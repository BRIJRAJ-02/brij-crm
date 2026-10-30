// The font packs are listed three times: the contracts' `PAGE_FONTS`, `packs.ts` (what a shell preloads) and
// `packs.css` (the faces). This holds the three together, and every file named to the folder it lives in.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_PACKS } from './packs.ts';

const FONTS = new URL('../fonts/', import.meta.url);
const CSS = readFileSync(new URL('../packs.css', import.meta.url), 'utf8');
const CONTRACT = readFileSync(new URL('../../contracts/src/booking/page-theme.ts', import.meta.url), 'utf8');

describe('the link page font packs', () => {
  it('name exactly the packs a look can store', () => {
    const listed = /export const PAGE_FONTS = \[([^\]]*)\]/.exec(CONTRACT)?.[1] ?? '';
    const names = [...listed.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    expect(Object.keys(FONT_PACKS).sort()).toEqual([...names].sort());
  });

  it('point at files that exist, each declared once as a face with a swap', () => {
    for (const pack of Object.values(FONT_PACKS)) {
      for (const file of [pack.heading, 'body' in pack ? pack.body : pack.heading]) {
        expect(existsSync(new URL(file, FONTS)), file).toBe(true);
      }
    }
    const declared = [...CSS.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((match) => match[1]);
    expect(new Set(declared).size).toBe(declared.length);
    expect(CSS.match(/font-display: swap;/g)?.length).toBe(declared.length);
  });

  it('give every face a fallback with its metrics', () => {
    const faces = [...CSS.matchAll(/font-family: '([^']+)';\s*src: url/g)].map((match) => match[1]);
    expect(faces.length).toBe(6);
    for (const face of faces) {
      const fallback = new RegExp(
        `font-family: '${face} Fallback';\\s*src: local\\('[^']+'\\);\\s*size-adjust: [0-9.]+%;\\s*ascent-override: [0-9.]+%;\\s*descent-override: [0-9.]+%;`,
      );
      expect(CSS, `${face} has a fallback`).toMatch(fallback);
      expect(CSS, `${face} names its fallback`).toContain(`'${face}', '${face} Fallback'`);
    }
  });
});
