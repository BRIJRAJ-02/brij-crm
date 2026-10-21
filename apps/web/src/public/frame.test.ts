// Inside an embed's frame (spec 0023, 0023-embeds.md): the frame answers only
// an embed it can name a host for, posts its height to that origin and never
// to `*`, and keeps its embed when it goes on to a booking page.
import { describe, expect, it, vi } from 'vitest';
import { contextFromFrame, contextOfPage, hiddenOf } from './context.ts';
import { embedOf, framedUrl, reportHeight, type FrameMessage } from './frame.ts';

const search = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

describe('the embed a frame is', () => {
  it('takes the browser’s own ancestor over the host the address names', () => {
    expect(
      embedOf({
        search: search({ embed: '1', mode: 'popup', fid: '2', host: 'https://evil.example' }),
        isFramed: true,
        ancestorOrigins: ['https://acme.com'],
      }),
    ).toEqual({ mode: 'popup', frameId: '2', hostOrigin: 'https://acme.com' });
  });

  it('uses the named host where the browser has no ancestor list, and nothing that is no web origin', () => {
    expect(
      embedOf({ search: search({ embed: '1', fid: '1', host: 'https://acme.com/x' }), isFramed: true })?.hostOrigin,
    ).toBe('https://acme.com');
    expect(
      embedOf({ search: search({ embed: '1', fid: '1', host: 'javascript:alert(1)' }), isFramed: true }),
    ).toBeUndefined();
    expect(
      embedOf({ search: search({ embed: '1', fid: 'x', host: 'https://acme.com' }), isFramed: true }),
    ).toBeUndefined();
    expect(
      embedOf({ search: search({ embed: '1', fid: '1', host: 'https://acme.com' }), isFramed: false }),
    ).toBeUndefined();
  });

  it('posts each new height once, rounded up, to the host’s origin only', () => {
    const post = vi.fn<(message: FrameMessage, origin: string) => void>();
    let height = 400.2;
    let changed: () => void = () => undefined;
    reportHeight(
      { mode: 'inline', frameId: '3', hostOrigin: 'https://acme.com' },
      post,
      () => height,
      (callback) => {
        changed = callback;
        return () => undefined;
      },
    );
    changed();
    height = 520;
    changed();
    expect(post.mock.calls).toEqual([
      [{ timefix: 1, type: 'height', fid: '3', height: 401 }, 'https://acme.com'],
      [{ timefix: 1, type: 'height', fid: '3', height: 520 }, 'https://acme.com'],
    ]);
  });

  it('keeps the embed on a booking page of ours', () => {
    expect(framedUrl('/b/abc?p=fb1.x', { mode: 'inline', frameId: '4', hostOrigin: 'https://acme.com' })).toBe(
      '/b/abc?p=fb1.x&embed=1&mode=inline&fid=4&host=https%3A%2F%2Facme.com',
    );
  });
});

describe('where a submission came from, as the frame sends it', () => {
  it('reads the context the script passed, text only and cut short', () => {
    const ctx = JSON.stringify({
      page_url: 'https://acme.com/pricing',
      page_title: 'P'.repeat(400),
      utm_campaign: 'spring',
      params: { plan: 'pro', count: 3 },
      evil: '<script>',
    });
    expect(contextFromFrame(search({ ctx }), 'inline')).toEqual({
      mode: 'inline',
      version: '1',
      page_url: 'https://acme.com/pricing',
      page_title: 'P'.repeat(300),
      utm_campaign: 'spring',
      params: { plan: 'pro' },
    });
    expect(contextFromFrame(search({ ctx: 'not json' }), 'popup')).toEqual({ mode: 'popup', version: '1' });
  });

  it('reads the hosted page’s own visit, and gives the older hidden fields from it', () => {
    const context = contextOfPage({
      href: 'https://app.example/f/demo?utm_source=mail',
      title: 'Demo',
      referrer: 'https://acme.com/',
    });
    expect(context).toEqual({
      mode: 'page',
      version: '1',
      page_url: 'https://app.example/f/demo?utm_source=mail',
      page_title: 'Demo',
      referrer: 'https://acme.com/',
      utm_source: 'mail',
    });
    expect(hiddenOf(context)).toEqual({
      page: 'https://app.example/f/demo?utm_source=mail',
      referrer: 'https://acme.com/',
      utm_source: 'mail',
    });
  });
});
