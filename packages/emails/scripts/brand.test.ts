// The footer's wordmarks: the committed files are what the tokens make, so a
// token change can't leave the logo in an old colour, and the PNG writer reads
// back what it wrote.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorToken } from '../src/tokens.ts';
import { makeWordmarks } from './brand.ts';
import { decodePng, encodePng, recolour } from './png.ts';
import { forceDark } from './preview.ts';

describe('the footer wordmarks', () => {
  it('are committed as the tokens make them (pnpm --filter @crm/emails brand)', () => {
    for (const { file, bytes } of makeWordmarks()) expect(readFileSync(file).equals(bytes), file).toBe(true);
  });

  it('are the muted ink of each theme, the shape kept by the alpha channel', () => {
    const [light, dark] = makeWordmarks().map(({ bytes }) => decodePng(bytes));
    const inked = (image: ReturnType<typeof decodePng> | undefined) => {
      if (image === undefined) throw new Error('No image.');
      for (let at = 0; at < image.pixels.length; at += 4) {
        if (image.pixels[at + 3] === 255) return [...image.pixels.subarray(at, at + 3)];
      }
      throw new Error('No solid pixel.');
    };
    const hex = (rgb: number[]) => `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
    expect(hex(inked(light))).toBe(colorToken('text-tertiary', 'light'));
    expect(hex(inked(dark))).toBe(colorToken('text-tertiary', 'dark'));
  });
});

describe('the PNG writer', () => {
  it('reads back what it writes', () => {
    const image = {
      width: 2,
      height: 2,
      pixels: new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255, 1, 2, 3, 4, 255, 255, 255, 128]),
    };
    expect(decodePng(encodePng(image))).toEqual(image);
    const red = recolour(image, '#ff0000');
    expect([...red.pixels]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 4, 255, 0, 0, 128]);
  });
});

describe('the preview', () => {
  it('shows the dark theme by applying the email’s own dark rules', () => {
    expect(forceDark('@media (prefers-color-scheme: dark) { .x { color: red; } }')).toBe(
      '@media all { .x { color: red; } }',
    );
  });
});
