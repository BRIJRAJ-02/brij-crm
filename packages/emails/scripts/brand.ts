// `pnpm --filter @crm/emails brand`: the emails' Timefix logos, written to
// apps/web/public/brand/email/, which the app serves. Two families:
// - the footer's wordmarks, the web app's own wordmark in the muted ink of
//   each theme (the `text-tertiary` token). A mid grey stays legible on a
//   client's own dark ground (Gmail darkens an email without asking it).
// - the booking emails' masthead (bookings redesign, 10 November 2026): the
//   mark beside the wordmark, in the ink of each theme (the `text` token),
//   black on the light card and light on the dark one.
// The mark is drawn here from the shapes of `timefix-mark.svg` (a circle with
// the tick cut out of it), so no image library or browser is needed. With
// `--check` it writes nothing and fails when the committed files aren't what
// the tokens make, so a token change can't leave a logo behind.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { colorToken } from '../src/tokens.ts';
import { decodePng, encodePng, recolour, type Rgba } from './png.ts';

const BRAND = path.resolve(import.meta.dirname, '../../../apps/web/public/brand');

/** The wordmark files to write, and the token colour each takes. */
export const WORDMARKS = [
  { file: 'email/timefix-wordmark-light.png', scheme: 'light' },
  { file: 'email/timefix-wordmark-dark.png', scheme: 'dark' },
] as const;

/** The source: the web app's wordmark, whose alpha channel is the shape. */
const SOURCE = path.join(BRAND, 'timefix-wordmark-light.png');

/** Each wordmark's bytes, from the source and the tokens. */
export function makeWordmarks(): { readonly file: string; readonly bytes: Buffer }[] {
  const source = decodePng(readFileSync(SOURCE));
  return WORDMARKS.map(({ file, scheme }) => ({
    file: path.join(BRAND, file),
    bytes: encodePng(recolour(source, colorToken('text-tertiary', scheme))),
  }));
}

/** The masthead files to write, and the token colour each takes. */
export const LOGOS = [
  { file: 'email/timefix-logo-light.png', scheme: 'light' },
  { file: 'email/timefix-logo-dark.png', scheme: 'dark' },
] as const;

/**
 * The masthead's shape: the mark, a gap, then the wordmark at its own size. The mark's circle is as tall as the
 * wordmark (210px), and the whole is 1181 by 210, so drawn 16px tall it is 90px wide, near enough exactly.
 */
export const LOGO_SHAPE = { width: 1181, height: 210, gap: 111 } as const;

/** A point's distance from the segment `a` to `b`. */
function toSegment(x: number, y: number, a: readonly [number, number], b: readonly [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const along = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + along * dx), y - (a[1] + along * dy));
}

/**
 * Whether a point of the mark's 32 unit box is ink: inside its circle and outside the tick. The tick is
 * `timefix-mark.svg`'s path as two round ended strokes meeting at its corner, 3.5 units wide.
 */
function markInk(x: number, y: number): boolean {
  const inCircle = Math.hypot(x - 15.9467, y - 16.5068) <= 13.0667;
  if (!inCircle) return false;
  const corner = [16.09, 18.2] as const;
  const inTick = toSegment(x, y, [11.14, 13.59], corner) <= 1.77 || toSegment(x, y, corner, [26.4, 6.96]) <= 1.76;
  return !inTick;
}

/** The mark's coverage in a `size` square (its circle filling it), four by four samples a pixel. */
function markCoverage(size: number): Uint8Array {
  const coverage = new Uint8Array(size * size);
  // The circle's diameter (2 × 13.0667 units) spans the square; its centre sits in the middle.
  const unit = size / (2 * 13.0667);
  const samples = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = 15.9467 + (px + (sx + 0.5) / samples - size / 2) / unit;
          const y = 16.5068 + (py + (sy + 0.5) / samples - size / 2) / unit;
          if (markInk(x, y)) hits += 1;
        }
      }
      coverage[py * size + px] = Math.round((hits * 255) / (samples * samples));
    }
  }
  return coverage;
}

/** The masthead's shape as alpha (white ink): the mark, the gap, the wordmark's own alpha. */
export function logoShape(): Rgba {
  const wordmark = decodePng(readFileSync(SOURCE));
  const { width, height, gap } = LOGO_SHAPE;
  const pixels = new Uint8Array(width * height * 4);
  const mark = markCoverage(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const wordX = x - height - gap;
      const alpha =
        x < height
          ? (mark[y * height + x] ?? 0)
          : wordX >= 0 && wordX < wordmark.width && y < wordmark.height
            ? (wordmark.pixels[(y * wordmark.width + wordX) * 4 + 3] ?? 0)
            : 0;
      pixels.set([255, 255, 255, alpha], at);
    }
  }
  return { width, height, pixels };
}

/** Each masthead's bytes, from the mark, the wordmark and the tokens. */
export function makeLogos(): { readonly file: string; readonly bytes: Buffer }[] {
  const shape = logoShape();
  return LOGOS.map(({ file, scheme }) => ({
    file: path.join(BRAND, file),
    bytes: encodePng(recolour(shape, colorToken('text', scheme))),
  }));
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const { file, bytes } of [...makeWordmarks(), ...makeLogos()]) {
    if (check) {
      let current: Buffer | undefined;
      try {
        current = readFileSync(file);
      } catch {
        current = undefined;
      }
      if (current === undefined || !current.equals(bytes)) stale.push(path.relative(process.cwd(), file));
    } else {
      writeFileSync(file, bytes);
      console.log(`Wrote ${path.relative(process.cwd(), file)}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      `EMAIL_BRAND_STALE: ${stale.join(', ')} isn't what the tokens make. Run pnpm --filter @crm/emails brand.`,
    );
    process.exit(1);
  }
}
