// A link page's crawl files and its pinned outside reads (spec 0061, AC-6123, AC-6128): pure, no database.
import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { robotsTxt, sitemapIndexXml, sitemapXml, xmlText } from './link-page.ts';
import { pinnedLookup } from './outside.ts';

describe('the crawl files (AC-6123)', () => {
  it('lists each page with its last change, escaped', () => {
    const xml = sitemapXml('https://timefix.com', [
      { handle: 'ada', changedAt: '2026-10-31T08:00:00.000Z' },
      { handle: 'bob-2', changedAt: '2026-10-01T00:00:00.000Z' },
    ]);
    expect(xml).toContain('<url><loc>https://timefix.com/ada</loc><lastmod>2026-10-31</lastmod></url>');
    expect(xml).toContain('<loc>https://timefix.com/bob-2</loc>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xmlText(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });

  it('splits into an index that names each file by where it starts', () => {
    const index = sitemapIndexXml('https://timefix.com', [undefined, 'mia']);
    expect(index).toContain('<sitemap><loc>https://timefix.com/sitemap-handles.xml?part=first</loc></sitemap>');
    expect(index).toContain('<sitemap><loc>https://timefix.com/sitemap-handles.xml?after=mia</loc></sitemap>');
  });

  it('names the sitemap and keeps crawlers out of the app and the api', () => {
    const robots = robotsTxt('https://timefix.com');
    expect(robots).toContain('Sitemap: https://timefix.com/sitemap-handles.xml');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /w/');
  });
});

describe('the pinned lookup (AC-6128)', () => {
  /** A resolver that answers these addresses for any name. */
  const resolver =
    (addresses: readonly string[]) =>
    (_host: string, _options: unknown, callback: (error: Error | null, found: LookupAddress[]) => void) => {
      callback(
        null,
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );
    };

  const look = (addresses: readonly string[], all = false) =>
    new Promise<{ error: unknown; address: unknown }>((resolve) => {
      const lookup = pinnedLookup(resolver(addresses) as never);
      lookup('example.com', { all }, (error, address) => {
        resolve({ error, address });
      });
    });

  it('connects to an address it checked', async () => {
    expect(await look(['93.184.216.34'])).toEqual({ error: null, address: '93.184.216.34' });
  });

  it.each([['127.0.0.1'], ['10.0.0.5'], ['169.254.169.254'], ['::1'], ['fd00::1'], ['192.168.1.1']])(
    'refuses to connect when the name answers %s, the check and the connection being one lookup',
    async (inward) => {
      const found = await look(['93.184.216.34', inward]);
      expect(found.error).toMatchObject({ code: 'EREFUSEDADDRESS' });
    },
  );

  it('refuses a name with no address at all', async () => {
    expect((await look([])).error).toMatchObject({ code: 'EREFUSEDADDRESS' });
  });
});
