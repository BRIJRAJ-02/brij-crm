// The share card drawn for real (spec 0055, AC-5510): satori and resvg run in this test exactly as they run in
// `api/card.mjs`, so a card that would come out clipped, blank or the wrong size fails here rather than in a
// message somebody pasted. The entry's own path reading is checked beside it.
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { describe, expect, it } from 'vitest';
import {
  CARD_CACHE_CONTROL,
  CARD_CACHE_CONTROL_MISSED,
  CARD_CACHE_CONTROL_UNVERSIONED,
  CARD_HEIGHT,
  CARD_WIDTH,
  STRIP_HEIGHT,
  STRIP_WIDTH,
  cardCacheTags,
  cardFonts,
  cardTree,
  clampWords,
  handleOf,
  initialsOf,
  stripTree,
} from './card-image.ts';

const assetsAt = (file: string) => new URL(`./api/card-assets/${file}`, import.meta.url);

const assets = {
  inter: await readFile(assetsAt('Inter-Variable-latin.ttf')),
  display: await readFile(assetsAt('HostGrotesk-Variable-latin.ttf')),
  wordmark: `data:image/png;base64,${(await readFile(assetsAt('timefix-wordmark.png'))).toString('base64')}`,
};

/** One card, all the way to the bytes a crawler would fetch. */
async function draw(source: Parameters<typeof cardTree>[0]): Promise<Buffer> {
  const svg = await satori(cardTree(source, assets) as never, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: cardFonts(assets),
  });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng());
}

/** One pass band, drawn the same way: `api/card.mjs` draws it at the strip's size with the same fonts. */
async function drawStrip(source: Parameters<typeof stripTree>[0]): Promise<Buffer> {
  const svg = await satori(stripTree(source, assets) as never, {
    width: STRIP_WIDTH,
    height: STRIP_HEIGHT,
    fonts: cardFonts(assets),
  });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: STRIP_WIDTH } }).render().asPng());
}

/** A PNG's own declared size, out of its IHDR chunk: proof the bytes are a picture of the size we claim. */
function sizeOf(png: Buffer): { readonly width: number; readonly height: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('the share card', () => {
  it('draws the size every crawler is told', async () => {
    const png = await draw({ name: 'Ada Lovelace', handle: 'timefix.com/ada', description: 'Notes on the engine.' });
    expect(sizeOf(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
  });

  it('draws a name long enough to wrap, and one short enough not to', async () => {
    const long = await draw({
      name: 'Bartholomew Cunningham-Fairweather',
      handle: 'timefix.com/bartholomew',
      description: 'Engineer and designer, building scheduling that gets out of the way.',
    });
    const short = await draw({ name: 'Jo', handle: 'timefix.com/jo', description: 'Say hello.' });
    expect(sizeOf(long)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect(sizeOf(short)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    // Two different people are two different pictures: a card that drew nothing would make these equal.
    expect(long.equals(short)).toBe(false);
  });

  it('takes a picture where it has one', async () => {
    const face = `data:image/png;base64,${(await readFile(assetsAt('timefix-wordmark.png'))).toString('base64')}`;
    const withFace = await draw({ name: 'Ada', handle: 'timefix.com/ada', description: 'Hello.', picture: face });
    const without = await draw({ name: 'Ada', handle: 'timefix.com/ada', description: 'Hello.' });
    expect(sizeOf(withFace)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect(withFace.equals(without)).toBe(false);
  });
});

describe('the pass band', () => {
  it('draws the one size Apple takes a strip at', async () => {
    const png = await drawStrip({
      name: 'Ada Lovelace',
      handle: 'timefix.com/ada',
      description: 'Notes on the engine.',
    });
    expect(sizeOf(png)).toEqual({ width: STRIP_WIDTH, height: STRIP_HEIGHT });
  });

  it('draws the bio, which is the line its owner edits', async () => {
    const one = await drawStrip({ name: 'Ada', handle: 'timefix.com/ada', description: 'Notes on the engine.' });
    const other = await drawStrip({ name: 'Ada', handle: 'timefix.com/ada', description: 'Out of office.' });
    expect(sizeOf(one)).toEqual({ width: STRIP_WIDTH, height: STRIP_HEIGHT });
    // The same person with two sentences is two bands: a band that dropped the bio would make these equal.
    expect(one.equals(other)).toBe(false);
  });

  it('stays the same size with a bio nobody kept short', async () => {
    const png = await drawStrip({
      name: 'Bartholomew Cunningham-Fairweather',
      handle: 'timefix.com/bartholomew',
      description:
        'Engineer and designer, building scheduling software that gets out of the way of the people using it, '.repeat(
          4,
        ),
    });
    expect(sizeOf(png)).toEqual({ width: STRIP_WIDTH, height: STRIP_HEIGHT });
  });

  it('takes a picture where it has one', async () => {
    const face = `data:image/png;base64,${(await readFile(assetsAt('timefix-wordmark.png'))).toString('base64')}`;
    const withFace = await drawStrip({ name: 'Ada', handle: 'timefix.com/ada', description: 'Hello.', picture: face });
    const without = await drawStrip({ name: 'Ada', handle: 'timefix.com/ada', description: 'Hello.' });
    expect(sizeOf(withFace)).toEqual({ width: STRIP_WIDTH, height: STRIP_HEIGHT });
    expect(withFace.equals(without)).toBe(false);
  });
});

describe('a clamped sentence', () => {
  it('leaves one that already fits alone, tidying its spaces', () => {
    expect(clampWords('  Notes on   the engine. ', 40)).toBe('Notes on the engine.');
  });

  it('cuts at a word, never mid word, and says it was cut', () => {
    const cut = clampWords('Engineer and designer, building scheduling software that gets out of the way', 40);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(41);
    expect('Engineer and designer, building scheduling software that gets out of the way').toContain(cut.slice(0, -1));
  });

  it('cuts a single long word rather than answering nothing', () => {
    expect(clampWords('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Bartholomew Cunningham Fairweather')).toBe('BC');
    expect(initialsOf('jo')).toBe('J');
  });

  it('never comes out empty', () => {
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('')).toBe('?');
  });
});

describe('the card address', () => {
  it('reads the handle out of its own path and nothing else', () => {
    expect(handleOf('/api/public/handles/ada/card.png')).toBe('ada');
    expect(handleOf('/api/public/handles/ada-lovelace/card.png')).toBe('ada-lovelace');
    expect(handleOf('/api/public/handles/ada')).toBeUndefined();
    expect(handleOf('/api/public/handles/ada/card.png/extra')).toBeUndefined();
    expect(handleOf('/api/public/handles/..%2F..%2Fetc/card.png')).toBeUndefined();
    expect(handleOf('/api/public/handles/Ada/card.png')).toBeUndefined();
    expect(handleOf('/api/public/handles/a/card.png')).toBeUndefined();
  });
});

describe('the card’s cache (spec 0058, AC-23)', () => {
  it('is never immutable, and the edge keeps it five minutes at most, so a page made Private stops showing it', () => {
    for (const header of [CARD_CACHE_CONTROL, CARD_CACHE_CONTROL_UNVERSIONED, CARD_CACHE_CONTROL_MISSED]) {
      expect(header).not.toContain('immutable');
      expect(header).not.toContain('stale-while-revalidate');
      const edge = Number(/s-maxage=(\d+)/.exec(header)?.[1] ?? 'NaN');
      const browser = Number(/max-age=(\d+)/.exec(header)?.[1] ?? 'NaN');
      expect(edge).toBeLessThanOrEqual(300);
      expect(browser).toBeLessThanOrEqual(300);
    }
  });

  it('files the card under the address’s handle and the one the page holds now, so the switch deletes it', () => {
    expect(cardCacheTags('anish-old', { handle: 'anish' })).toEqual(['link-page:anish-old', 'link-page:anish']);
    expect(cardCacheTags('anish', undefined)).toEqual(['link-page:anish']);
    expect(cardCacheTags('anish', { handle: 42 })).toEqual(['link-page:anish']);
  });
});
