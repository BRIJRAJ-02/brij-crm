// The tab's icon follows the workspace's logo and goes back exactly as it was (spec 0060).
import { describe, expect, it } from 'vitest';
import { wearFavicon } from './favicon.ts';

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
    const restore = wearFavicon(document, src);
    expect(ico.held.get('href')).toBe(src);
    expect(svg.held.get('href')).toBe(src);
    expect(svg.held.has('type')).toBe(false);
    restore();
    expect(Object.fromEntries(ico.held)).toEqual({ rel: 'icon', href: '/favicon.ico', sizes: '32x32' });
    expect(Object.fromEntries(svg.held)).toEqual({
      rel: 'icon',
      href: '/brand/timefix-mark.svg',
      type: 'image/svg+xml',
    });
  });
});
