import { describe, expect, it } from 'vitest';
import { declaredIcon, faviconSources, faviconVersion, isFaviconSite } from './favicon.ts';

describe('isFaviconSite', () => {
  it('takes an https host name', () => {
    expect(isFaviconSite(new URL('https://example.com/a/b'))).toBe(true);
    expect(isFaviconSite(new URL('https://sub.example.co.uk/'))).toBe(true);
  });

  it('refuses anything that is not a plain https site', () => {
    expect(isFaviconSite(new URL('http://example.com'))).toBe(false);
    expect(isFaviconSite(new URL('https://example.com:8443'))).toBe(false);
    expect(isFaviconSite(new URL('https://user:pass@example.com'))).toBe(false);
    expect(isFaviconSite(new URL('https://localhost'))).toBe(false);
    expect(isFaviconSite(new URL('ftp://example.com'))).toBe(false);
  });

  // The outside door refuses where these resolve to; they are turned away here so they never cost a lookup.
  it('refuses a bare address', () => {
    expect(isFaviconSite(new URL('https://93.184.216.34/'))).toBe(false);
    expect(isFaviconSite(new URL('https://[2606:2800:220:1:248:1893:25c8:1946]/'))).toBe(false);
  });
});

describe('faviconSources', () => {
  it('gives the site’s own favicon address and the page itself', () => {
    const found = faviconSources('https://example.com/shop/item?a=1#top');
    expect(found?.guess.href).toBe('https://example.com/favicon.ico');
    expect(found?.page.href).toBe('https://example.com/shop/item?a=1');
  });

  it('gives nothing for an address no site could be at', () => {
    expect(faviconSources('http://example.com')).toBeUndefined();
    expect(faviconSources('not a url')).toBeUndefined();
    expect(faviconSources(`https://example.com/${'a'.repeat(2048)}`)).toBeUndefined();
  });
});

describe('declaredIcon', () => {
  const page = new URL('https://example.com/shop/');

  it('reads a relative href against the page', () => {
    expect(declaredIcon('<link rel="icon" href="/icon.png">', page)?.href).toBe('https://example.com/icon.png');
    expect(declaredIcon('<link rel="icon" href="icon.png">', page)?.href).toBe('https://example.com/shop/icon.png');
  });

  it('prefers a plain icon over a touch icon, whatever order they come in', () => {
    const html = '<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/plain.png">';
    expect(declaredIcon(html, page)?.href).toBe('https://example.com/plain.png');
  });

  it('keeps the first of equal rank, as a browser with no sizes to go on does', () => {
    const html = '<link rel="icon" href="/one.png"><link rel="icon" href="/two.png">';
    expect(declaredIcon(html, page)?.href).toBe('https://example.com/one.png');
  });

  it('reads an unquoted href and an entity in one', () => {
    expect(declaredIcon('<link rel=icon href=/a.png?x=1&amp;y=2>', page)?.href).toBe(
      'https://example.com/a.png?x=1&y=2',
    );
  });

  it('refuses an icon that is not on a plain https site', () => {
    expect(declaredIcon('<link rel="icon" href="http://example.com/i.png">', page)).toBeUndefined();
    expect(declaredIcon('<link rel="icon" href="https://u:p@other.com/i.png">', page)).toBeUndefined();
    expect(declaredIcon('<link rel="icon" href="javascript:alert(1)">', page)).toBeUndefined();
    expect(declaredIcon('<link rel="icon" href="data:image/png;base64,AAAA">', page)).toBeUndefined();
  });

  it('ignores a link that is not an icon', () => {
    expect(declaredIcon('<link rel="stylesheet" href="/a.css">', page)).toBeUndefined();
    expect(declaredIcon('<link rel="canonical" href="https://example.com/">', page)).toBeUndefined();
  });

  // A quoted attribute may hold a closing bracket; the tag must not end at it.
  it('reads a tag whose attribute holds a bracket', () => {
    expect(declaredIcon('<link title="a > b" rel="icon" href="/i.png">', page)?.href).toBe('https://example.com/i.png');
  });

  it('gives nothing when the head declares none before it stops reading', () => {
    const late = `${'<!-- padding -->'.repeat(8000)}<link rel="icon" href="/late.png">`;
    expect(declaredIcon(late, page)).toBeUndefined();
  });
});

describe('faviconVersion', () => {
  it('changes when the block or its address does', () => {
    const one = faviconVersion('block-1', 'https://example.com');
    expect(one).toHaveLength(12);
    expect(faviconVersion('block-1', 'https://example.com')).toBe(one);
    expect(faviconVersion('block-2', 'https://example.com')).not.toBe(one);
    expect(faviconVersion('block-1', 'https://example.org')).not.toBe(one);
  });
});
