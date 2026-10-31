// The tab's icon follows the workspace's logo and goes back exactly as it was (spec 0060).
import { describe, expect, it } from 'vitest';
import { containBox, wearFavicon } from './favicon.ts';

/** A link element as far as the icon needs it. */
function fakeLink(attributes: Record<string, string>) {
  const held = new Map(Object.entries(attributes));
  return {
    getAttribute: (name: string) => held.get(name) ?? null,
    setAttribute: (name: string, value: string) => void held.set(name, value),
    removeAttribute: (name: string) => void held.delete(name),
    held,
  };
}

describe('wearFavicon', () => {
  it('points every icon at the logo, then puts each back as it was', () => {
    const ico = fakeLink({ rel: 'icon', href: '/favicon.ico', sizes: '32x32' });
    const svg = fakeLink({ rel: 'icon', href: '/brand/timefix-mark.svg', type: 'image/svg+xml' });
    const document = { querySelectorAll: () => [ico, svg] } as unknown as Pick<Document, 'querySelectorAll'>;
    const src = '/api/brand/logo?workspace=acme&v=0123456789ab';
    const worn = wearFavicon(document, src);
    expect(ico.held.get('href')).toBe(src);
    expect(svg.held.get('href')).toBe(src);
    expect(svg.held.has('type')).toBe(false);
    // A wide wordmark drawn again inside a square moves every icon to the squared copy.
    worn.point('data:image/png;base64,AAAA');
    expect(ico.held.get('href')).toBe('data:image/png;base64,AAAA');
    worn.restore();
    expect(Object.fromEntries(ico.held)).toEqual({ rel: 'icon', href: '/favicon.ico', sizes: '32x32' });
    expect(Object.fromEntries(svg.held)).toEqual({
      rel: 'icon',
      href: '/brand/timefix-mark.svg',
      type: 'image/svg+xml',
    });
  });
});

describe('containBox', () => {
  it('keeps a wide wordmark whole, centred in the square, letters uncut', () => {
    expect(containBox(1200, 300, 64)).toEqual({ x: 0, y: 24, width: 64, height: 16 });
  });

  it('keeps a tall mark whole, centred across', () => {
    expect(containBox(300, 600, 64)).toEqual({ x: 16, y: 0, width: 32, height: 64 });
  });

  it('fills the square with a square mark', () => {
    expect(containBox(512, 512, 64)).toEqual({ x: 0, y: 0, width: 64, height: 64 });
  });
});
