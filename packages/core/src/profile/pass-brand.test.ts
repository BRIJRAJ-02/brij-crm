// A pass in a partner's own brand (13 November 2026): the ground drawn from one colour, the logo checked by its
// header before it is ever signed into a pass, and a `pass.json` written in the brand's colours.
import { describe, expect, it } from 'vitest';
import { brandBackground, brandLogoImages, brandLook, cleanPassLogo, pngSizeOf } from './pass-brand.ts';
import { TIMEFIX_WALLET_COLOUR } from '@crm/contracts';
import { brandImages, PASS_HUES, passJson } from './pass.ts';
import { writePng } from './png.ts';

const NAVY = '#13265b';
const png = (width: number, height: number) => writePng(width, height, () => [255, 255, 255]);
/** Whether two files are the same bytes, whichever kind of array holds them. */
const same = (one: Uint8Array | undefined, other: Uint8Array) =>
  one !== undefined && Buffer.from(one).equals(Buffer.from(other));

describe('the Timefix card’s colour', () => {
  it('is the orange hue the pass itself draws, so the console’s default never drifts from the card', () => {
    expect(TIMEFIX_WALLET_COLOUR).toBe(PASS_HUES.orange);
  });
});

describe('pngSizeOf', () => {
  it('reads a PNG’s size from its header', () => {
    expect(pngSizeOf(png(160, 37))).toEqual({ width: 160, height: 37 });
  });

  it('answers nothing for bytes that are no PNG, or a PNG cut short', () => {
    expect(pngSizeOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeUndefined();
    expect(pngSizeOf(png(10, 10).subarray(0, 20))).toBeUndefined();
    // A JPEG's first bytes.
    expect(pngSizeOf(Uint8Array.from([0xff, 0xd8, 0xff, ...new Array<number>(40).fill(0)]))).toBeUndefined();
  });
});

describe('cleanPassLogo', () => {
  it('takes a logo up to 160 by 50 points at its scale, and nothing larger', () => {
    expect(same(cleanPassLogo(png(160, 50), 1), png(160, 50))).toBe(true);
    expect(cleanPassLogo(png(480, 150), 3)).toBeDefined();
    expect(cleanPassLogo(png(161, 50), 1)).toBeUndefined();
    expect(cleanPassLogo(png(320, 101), 2)).toBeUndefined();
    expect(cleanPassLogo(Uint8Array.from([1, 2, 3]), 1)).toBeUndefined();
  });

  it('leaves behind whatever follows the picture’s end, and refuses a file cut short', () => {
    const whole = png(160, 37);
    const padded = Uint8Array.from([...whole, ...new TextEncoder().encode('<script>alert(1)</script>')]);
    expect(same(cleanPassLogo(padded, 1), whole)).toBe(true);
    expect(cleanPassLogo(whole.subarray(0, whole.byteLength - 6), 1)).toBeUndefined();
  });

  it('refuses an animated PNG', () => {
    const whole = png(160, 37);
    // An `acTL` chunk after the header (33 bytes in) is what makes a PNG an animated one.
    const acTL = Uint8Array.from([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const animated = Uint8Array.from([...whole.subarray(0, 33), ...acTL, ...whole.subarray(33)]);
    expect(cleanPassLogo(animated, 1)).toBeUndefined();
  });
});

describe('brandBackground', () => {
  it('draws the ground at Wallet’s three scales, and the same picture for the same colour', () => {
    const drawn = brandBackground(NAVY);
    expect(pngSizeOf(drawn['background.png'] ?? new Uint8Array())).toEqual({ width: 180, height: 220 });
    expect(pngSizeOf(drawn['background@2x.png'] ?? new Uint8Array())).toEqual({ width: 360, height: 440 });
    expect(pngSizeOf(drawn['background@3x.png'] ?? new Uint8Array())).toEqual({ width: 540, height: 660 });
    expect(brandBackground(NAVY)).toBe(drawn);
    expect(brandBackground('#5b1326')['background.png']).not.toEqual(drawn['background.png']);
  });
});

describe('a pass in a brand’s look', () => {
  const logo = { x1: png(160, 37), x2: png(320, 74), x3: png(480, 111) };
  const input = {
    card: { fullName: 'Ada Lovelace' },
    handle: 'ada',
    pageUrl: 'https://timefix.com/ada',
    theme: { hue: 'orange' as const },
    serialNumber: 'ada',
    identity: {
      passTypeIdentifier: 'pass.com.timefix.linkpage',
      teamIdentifier: 'ABCDE12345',
      organizationName: 'Rilian',
    },
    images: { ...brandImages(true), ...brandBackground(NAVY), ...brandLogoImages(logo) },
    look: brandLook(NAVY),
  };

  it('writes the brand’s colour and white text, in place of the hue’s', () => {
    const pass = JSON.parse(passJson(input)) as Record<string, string>;
    expect(pass.backgroundColor).toBe('rgb(19, 38, 91)');
    expect(pass.foregroundColor).toBe('rgb(255, 255, 255)');
    expect(pass.organizationName).toBe('Rilian');
    // Without a look the same pass is the hue's orange, as every Timefix pass is.
    const { look: _look, ...plain } = input;
    expect((JSON.parse(passJson(plain)) as Record<string, string>).backgroundColor).toBe('rgb(251, 143, 60)');
  });

  it('carries the brand’s logo under the three names a pass knows, and keeps the Timefix icon', () => {
    expect(input.images['logo.png']).toBe(logo.x1);
    expect(input.images['logo@2x.png']).toBe(logo.x2);
    expect(input.images['logo@3x.png']).toBe(logo.x3);
    expect(input.images['icon.png']).toEqual(brandImages(true)['icon.png']);
  });
});
