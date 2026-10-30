// A company's logo from our own origin (spec 0059, AC-5903 to AC-5906), with a fake session, limiter and network, so
// no database and no real site: the route fetches only for a signed in person and a public host name written one
// way, answers an icon for 7 days and a miss for a day at the edge, never keeps an answer about the person asking,
// never sets a cookie, and counts 300 a minute each. The fetch takes the head's icon sized for a logo, then
// /favicon.ico, through the one outside door, which refuses a private address before connecting and after a redirect.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Auth } from './auth/auth.ts';
import { createMemoryLimiter } from './limits.ts';
import {
  LOGO_CACHE_CONTROL,
  LOGO_LIMIT,
  LOGO_MISS_CACHE_CONTROL,
  LOGO_RETRY_CACHE_CONTROL,
  mountLogos,
} from './logos.ts';
import { createFaviconFetch, type FaviconFetch } from './public/favicon.ts';
import type { Lookup } from './public/outside.ts';

const USER = '01a17d71-1ebc-7ae4-986b-7879179e331a';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 1, 2, 3]);

/** A fake fetch answering from a table of URL to Response, recording what it was asked. */
function fakeFetch(answers: Readonly<Record<string, () => Response>>) {
  const asked: string[] = [];
  const fetch = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    const make = answers[url];
    return Promise.resolve(make === undefined ? new Response('', { status: 404 }) : make());
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const body = (bytes: Uint8Array | string, type: string) => () =>
  new Response(bytes, { headers: { 'content-type': type } });
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });

/** Every host resolves to one public address, but for the names `inside` points inward. */
const lookup: Lookup = (hostname) => Promise.resolve(hostname.startsWith('inside.') ? ['10.0.0.7'] : ['93.184.216.34']);

/** The route over fakes: `signedIn` false answers no session; `renewals` records what each session read asked. */
function setUp({
  signedIn = true,
  logos,
  limiter = createMemoryLimiter(),
}: {
  signedIn?: boolean;
  logos: FaviconFetch;
  limiter?: ReturnType<typeof createMemoryLimiter>;
}) {
  const renewals: (boolean | undefined)[] = [];
  const auth: Pick<Auth, 'session'> = {
    session: (_headers, _clientIp, options) => {
      renewals.push(options?.renew);
      return Promise.resolve(
        signedIn
          ? ({
              user: { id: USER },
              // A renewed session's cookie, which the route must never pass on.
              setCookies: ['session=renewed; Path=/; HttpOnly'],
            } as unknown as Awaited<ReturnType<Auth['session']>>)
          : undefined,
      );
    },
  };
  const app = new Hono<{
    Variables: { requestId: string; clientIp: string | undefined; origin: string | undefined };
  }>().basePath('/api');
  app.use('*', async (c, next) => {
    c.set('requestId', 'test');
    c.set('clientIp', undefined);
    c.set('origin', undefined);
    await next();
  });
  mountLogos(app, { auth, logos, limiter });
  return { app, renewals };
}

/** A logo fetch that answers a PNG for every domain, recording which it was asked for. */
function everySite() {
  const asked: string[] = [];
  const logos: FaviconFetch = (link) => {
    asked.push(link);
    return Promise.resolve({ ok: true, type: 'image/png', bytes: PNG });
  };
  return { logos, asked };
}

describe('GET /api/logos/:domain', () => {
  it('answers the site’s icon from our origin, kept 7 days in the browser and at the edge (AC-5903, AC-5905)', async () => {
    const { logos, asked } = everySite();
    const { app, renewals } = setUp({ logos });
    const answered = await app.request('/api/logos/acme.com');
    expect(answered.status).toBe(200);
    expect(answered.headers.get('content-type')).toBe('image/png');
    expect(answered.headers.get('cache-control')).toBe(LOGO_CACHE_CONTROL);
    expect(answered.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answered.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await answered.arrayBuffer())).toEqual(PNG);
    expect(asked).toEqual(['https://acme.com/']);
    // Read, never renewed, and no cookie on an answer the edge keeps for everyone.
    expect(renewals).toEqual([false]);
    expect(answered.headers.get('set-cookie')).toBeNull();
  });

  it('answers a site with no icon 404, kept a day, so the initial shows (AC-5901, AC-5905)', async () => {
    const { app } = setUp({ logos: () => Promise.resolve({ ok: false, reason: 'status' }) });
    const answered = await app.request('/api/logos/acme.com');
    expect(answered.status).toBe(404);
    expect(answered.headers.get('cache-control')).toBe(LOGO_MISS_CACHE_CONTROL);
    expect(await answered.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps a site that timed out or couldn’t be reached only five minutes, so one slow moment passes', async () => {
    for (const reason of ['timeout', 'network'] as const) {
      const { app } = setUp({ logos: () => Promise.resolve({ ok: false, reason }) });
      const answered = await app.request('/api/logos/acme.com');
      expect(answered.status, reason).toBe(404);
      expect(answered.headers.get('cache-control'), reason).toBe(LOGO_RETRY_CACHE_CONTROL);
    }
  });

  it('fetches nothing without a session, and never lets the edge keep that answer (AC-5906)', async () => {
    const { logos, asked } = everySite();
    const { app } = setUp({ signedIn: false, logos });
    const answered = await app.request('/api/logos/acme.com');
    expect(answered.status).toBe(404);
    expect(answered.headers.get('cache-control')).toBe('private, no-store');
    expect(answered.headers.get('set-cookie')).toBeNull();
    expect(asked).toEqual([]);
  });

  it('fetches nothing, and reads no session, for an address that is not one public host name (AC-5906)', async () => {
    const { logos, asked } = everySite();
    const { app, renewals } = setUp({ logos });
    for (const path of [
      'localhost',
      '10.0.0.1',
      '%5B::1%5D',
      '127.0.0.1',
      'printer.local',
      'Acme.com',
      'acme%2Ecom',
      'acme.com.',
      'acme.com:443',
      'acme.com?v=2',
      'user@acme.com',
    ]) {
      const answered = await app.request(`/api/logos/${path}`);
      expect(answered.status, path).toBe(404);
      expect(answered.headers.get('cache-control'), path).toBe(LOGO_MISS_CACHE_CONTROL);
    }
    expect(asked).toEqual([]);
    expect(renewals).toEqual([]);
  });

  it('answers 429 past 300 a minute for one person, never kept anywhere (AC-5906)', async () => {
    let now = 0;
    const { logos, asked } = everySite();
    const { app } = setUp({ logos, limiter: createMemoryLimiter({ now: () => now }) });
    for (let index = 0; index < LOGO_LIMIT.max; index += 1) {
      expect((await app.request(`/api/logos/site-${String(index)}.com`)).status).toBe(200);
    }
    const over = await app.request('/api/logos/one-more.com');
    expect(over.status).toBe(429);
    // Kept only in this person's browser, until they may ask again.
    const wait = over.headers.get('retry-after');
    expect(Number(wait)).toBeGreaterThan(0);
    expect(over.headers.get('cache-control')).toBe(`private, max-age=${wait ?? ''}`);
    expect(asked).toHaveLength(LOGO_LIMIT.max);
    now += LOGO_LIMIT.windowMs;
    expect((await app.request('/api/logos/one-more.com')).status).toBe(200);
  });
});

// The fetch behind the route (AC-5904): the head's icon sized for a logo, else /favicon.ico, through the outside door.
describe('createFaviconFetch, preferring the icon sized for a logo', () => {
  const logoFetch = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
    createFaviconFetch({ fetch, lookup, prefer: 'logo', ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  it('reads the home page first and takes the icon that fills a logo', async () => {
    const { fetch, asked } = fakeFetch({
      'https://acme.com/': body(
        '<head><link rel="icon" sizes="32x32" href="/32.png"><link rel="apple-touch-icon" href="/touch.png"></head>',
        'text/html; charset=utf-8',
      ),
      'https://acme.com/touch.png': body(PNG, 'image/png'),
    });
    expect(await logoFetch(fetch)('https://acme.com/')).toMatchObject({ ok: true, type: 'image/png' });
    expect(asked).toEqual(['https://acme.com/', 'https://acme.com/touch.png']);
  });

  it('falls back to /favicon.ico when the page declares nothing, can’t be read, or its icon misses', async () => {
    const pages: readonly Readonly<Record<string, () => Response>>[] = [
      { 'https://acme.com/': body('<head></head>', 'text/html') },
      { 'https://acme.com/': () => new Response('', { status: 500 }) },
      {
        'https://acme.com/': body('<link rel="icon" sizes="512x512" href="/big.png">', 'text/html'),
        'https://acme.com/big.png': body('<html>not an image</html>', 'image/png'),
      },
    ];
    for (const answers of pages) {
      const { fetch, asked } = fakeFetch({ ...answers, 'https://acme.com/favicon.ico': body(ICO, 'image/x-icon') });
      expect(await logoFetch(fetch)('https://acme.com/')).toMatchObject({ ok: true, type: 'image/x-icon' });
      expect(asked.at(-1)).toBe('https://acme.com/favicon.ico');
    }
  });

  it('answers a miss when the site has no icon at all', async () => {
    const { fetch } = fakeFetch({ 'https://acme.com/': body('<head></head>', 'text/html') });
    expect(await logoFetch(fetch)('https://acme.com/')).toEqual({ ok: false, reason: 'status' });
  });

  it('never connects to a private address: not first, not by a redirect, not by a declared icon (AC-5904)', async () => {
    // A name that resolves inward is refused before any connection.
    const inward = fakeFetch({});
    expect(await logoFetch(inward.fetch)('https://inside.acme.com/')).toMatchObject({ ok: false });
    expect(inward.asked).toEqual([]);
    // A redirect to one is refused before following it, and so is an icon the page points at one.
    const { fetch, asked } = fakeFetch({
      'https://acme.com/': redirect('https://inside.acme.com/'),
      'https://acme.com/favicon.ico': redirect('https://10.0.0.1/favicon.ico'),
    });
    expect(await logoFetch(fetch)('https://acme.com/')).toMatchObject({ ok: false });
    const declaring = fakeFetch({
      'https://acme.com/': body('<link rel="icon" sizes="512x512" href="https://inside.acme.com/i.png">', 'text/html'),
    });
    await logoFetch(declaring.fetch)('https://acme.com/');
    for (const each of [...asked, ...declaring.asked]) expect(new URL(each).hostname).toBe('acme.com');
  });

  it('keeps to one deadline for the page and both images together (AC-5904)', async () => {
    // Each read alone would finish inside the timeout; together they don't, so the whole gives up at it.
    const slow = ((input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error('aborted'));
          return;
        }
        const url = input instanceof Request ? input.url : String(input);
        const timer = setTimeout(() => {
          resolve(
            url === 'https://acme.com/'
              ? new Response('<link rel="icon" sizes="64x64" href="/64.png">', {
                  headers: { 'content-type': 'text/html' },
                })
              : new Response('', { status: 404 }),
          );
        }, 30);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      })) as typeof globalThis.fetch;
    expect(await logoFetch(slow, 50)('https://acme.com/')).toEqual({ ok: false, reason: 'timeout' });
  });
});
