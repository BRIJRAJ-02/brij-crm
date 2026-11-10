// The footer's wordmarks: the committed files are what the tokens make, so a
// token change can't leave the logo in an old colour, and the PNG writer reads
// back what it wrote.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorToken } from '../src/tokens.ts';
import { LOGO_SHAPE, makeLogos, makeWordmarks } from './brand.ts';
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

describe('the booking emails’ masthead (bookings redesign)', () => {
  it('is committed as the tokens make it (pnpm --filter @crm/emails brand)', () => {
    for (const { file, bytes } of makeLogos()) expect(readFileSync(file).equals(bytes), file).toBe(true);
  });

  it('is the mark beside the wordmark, in each theme’s own ink', () => {
    const [light, dark] = makeLogos().map(({ bytes }) => decodePng(bytes));
    if (light === undefined || dark === undefined) throw new Error('No logo.');
    expect([light.width, light.height]).toEqual([LOGO_SHAPE.width, LOGO_SHAPE.height]);
    const at = (image: ReturnType<typeof decodePng>, x: number, y: number) => {
      const index = (y * image.width + x) * 4;
      return [...image.pixels.subarray(index, index + 4)];
    };
    const hex = (rgb: number[]) => `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
    // The circle's ink, low in the mark (below the tick), and the tick cut out of it at its corner.
    const ink = at(light, Math.round(LOGO_SHAPE.height / 2), Math.round(LOGO_SHAPE.height * 0.85));
    expect(ink[3]).toBe(255);
    expect(hex(ink.slice(0, 3))).toBe(colorToken('text', 'light'));
    expect(hex(at(dark, Math.round(LOGO_SHAPE.height / 2), Math.round(LOGO_SHAPE.height * 0.85)).slice(0, 3))).toBe(
      colorToken('text', 'dark'),
    );
    expect(at(light, Math.round(LOGO_SHAPE.height * 0.5), Math.round(LOGO_SHAPE.height * 0.6))[3]).toBe(0);
    // The gap between the mark and the wordmark is clear.
    expect(at(light, LOGO_SHAPE.height + Math.round(LOGO_SHAPE.gap / 2), LOGO_SHAPE.height / 2)[3]).toBe(0);
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
