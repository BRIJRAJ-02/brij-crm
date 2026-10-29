import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startTags, type TagHost } from './tags.ts';

const hostWith = (over: Partial<TagHost> = {}) => {
  const scripts: string[] = [];
  const global: Record<string, unknown> = {};
  const host: TagHost = {
    href: 'https://www.timefix.com/?utm_source=x&gclid=1',
    title: 'Timefix',
    isAutomated: false,
    addScript: (src) => scripts.push(src),
    global,
    ...over,
  };
  return { host, scripts, global };
};

describe('startTags', () => {
  it('starts nothing without ids', () => {
    const { host, scripts } = hostWith();
    expect(startTags({}, host)).toEqual([]);
    expect(scripts).toEqual([]);
  });

  it('loads GA4 and queues one page view with the whole address, so UTMs and click ids reach it', () => {
    const { host, scripts, global } = hostWith();
    expect(startTags({ ga: 'G-ABC123XYZ' }, host)).toEqual(['ga']);
    expect(scripts).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ']);
    const queued = (global.dataLayer as IArguments[]).map((entry) => [...entry]);
    expect(queued[1]).toEqual(['config', 'G-ABC123XYZ', { send_page_view: false }]);
    expect(queued[2]).toEqual([
      'event',
      'page_view',
      { page_location: 'https://www.timefix.com/?utm_source=x&gclid=1', page_title: 'Timefix' },
    ]);
  });

  it('loads Clarity behind its queue', () => {
    const { host, scripts, global } = hostWith();
    expect(startTags({ clarity: 'abc123def' }, host)).toEqual(['clarity']);
    expect(scripts).toEqual(['https://www.clarity.ms/tag/abc123def']);
    expect(typeof global.clarity).toBe('function');
  });

  it('loads Vercel’s two scripts from the site’s own origin', () => {
    const { host, scripts } = hostWith();
    expect(startTags({ vercel: true }, host)).toEqual(['vercel']);
    expect(scripts).toEqual(['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js']);
  });

  it('refuses an id that is not one, so no address is built from it', () => {
    const { host, scripts } = hostWith();
    expect(startTags({ ga: 'G-x"/><script>', clarity: '../evil' }, host)).toEqual([]);
    expect(scripts).toEqual([]);
  });

  it('starts nothing under automation', () => {
    const { host, scripts } = hostWith({ isAutomated: true });
    expect(startTags({ ga: 'G-ABC123XYZ', clarity: 'abc123def', vercel: true }, host)).toEqual([]);
    expect(scripts).toEqual([]);
  });
});

describe('the CSP (vercel.json)', () => {
  const policy = (() => {
    const vercel = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'vercel.json'), 'utf8')) as {
      readonly headers: readonly { readonly headers: readonly { readonly key: string; readonly value: string }[] }[];
    };
    return vercel.headers.flatMap((rule) => rule.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  })();
  const directive = (name: string) =>
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/u))
      .find(([key]) => key === name)
      ?.slice(1) ?? [];

  it('lets every tag’s script load, and still no inline script', () => {
    expect(directive('script-src')).toEqual(
      expect.arrayContaining(["'self'", 'https://www.googletagmanager.com', 'https://www.clarity.ms']),
    );
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });

  it('lets them report: GA, Clarity and Vercel’s own origin', () => {
    expect(directive('connect-src')).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://*.google-analytics.com',
        'https://*.clarity.ms',
        'https://app.timefix.com',
      ]),
    );
  });
});
