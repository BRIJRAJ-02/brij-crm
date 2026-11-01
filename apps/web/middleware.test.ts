// The middleware is the one origin's edge: it decides where /api goes and what
// the API is told about the caller. Vercel reads the rewrite and the upstream
// request headers from the response's x-middleware-* headers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourcePattern } from './csp.ts';
import { readFileSync } from 'node:fs';
import middleware, {
  apiTarget,
  CARD_PATH,
  STRIP_PATH,
  config,
  EDGE_HEADER,
  GEO_HEADERS,
  HANDLE_PATH,
  handleHostRedirect,
  hasSessionHint,
  ORIGIN_HEADER,
  PUBLIC_HOST_PATH,
  CRAWL_FILES,
  publicHostRedirect,
  SESSION_HINT_COOKIE,
  SESSION_HINT_PRESENT,
  STAY_PARAM,
  TRACE_HEADERS,
} from './middleware.ts';
import * as paths from './public-paths.ts';
import { MIDDLEWARE_MATCHER } from './public-paths.ts';
import {
  SESSION_HINT_COOKIE as cookieName,
  SESSION_HINT_PRESENT as cookiePresent,
} from './src/features/auth/parent-hint.ts';

const API = 'https://api-production.up.railway.app';

function call(path: string, headers: Record<string, string> = {}): Response {
  return middleware(new Request(`https://brij-crm.vercel.app${path}`, { method: 'POST', headers }));
}

function upstreamHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

// Local by default, whatever the machine running the tests has set.
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('api proxy middleware', () => {
  it('runs for every path but the built files, as public-paths.ts says', () => {
    expect(config.matcher).toEqual([MIDDLEWARE_MATCHER]);
    const matched = sourcePattern(MIDDLEWARE_MATCHER);
    for (const pathname of ['/', '/api', '/api/rpc/x', '/sign-in', '/ada/30min', '/b/AbCdEfGhIjKlMnOp', '/x.js']) {
      expect(matched.test(pathname), pathname).toBe(true);
    }
    const builtFiles = [
      '/assets/index-abc.js',
      '/brand/timefix-mark.svg',
      '/favicon.ico',
      '/layers.css',
      '/theme-boot.js',
    ];
    for (const pathname of builtFiles) {
      expect(matched.test(pathname), pathname).toBe(false);
    }
  });

  it('passes any other path on untouched, with none of the API’s headers', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', 'a'.repeat(40));
    const response = call('/w/acme/objects/people');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(upstreamHeader(response, EDGE_HEADER)).toBeNull();
  });

  it('rewrites an /api request to the same path and query on the Railway API', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/rpc/system/status?cursor=abc');
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${API}/api/rpc/system/status?cursor=abc`);
  });

  it('tells the API the public host and protocol the browser used', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/health');
    expect(upstreamHeader(response, 'x-forwarded-host')).toBe('brij-crm.vercel.app');
    expect(upstreamHeader(response, 'x-forwarded-proto')).toBe('https');
  });

  it('replaces a client supplied x-forwarded-for with the IP Vercel saw', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/health', { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '203.0.113.7' });
    expect(upstreamHeader(response, 'x-forwarded-for')).toBe('203.0.113.7');
  });

  it('passes on the place the edge resolved, the city percent encoded (spec 0033)', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/auth/sign-in/email-otp', {
      [GEO_HEADERS.country]: 'BR',
      [GEO_HEADERS.city]: 'S%C3%A3o%20Paulo',
    });
    expect(upstreamHeader(response, GEO_HEADERS.country)).toBe('BR');
    expect(upstreamHeader(response, GEO_HEADERS.city)).toBe('S%C3%A3o%20Paulo');
  });

  it('sends no place when the edge resolved none', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/health');
    expect(upstreamHeader(response, GEO_HEADERS.country)).toBeNull();
    expect(upstreamHeader(response, GEO_HEADERS.city)).toBeNull();
  });

  it('drops a caller’s trace headers, so no caller picks the API’s sampling or trace id', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/rpc/records/query', {
      'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
      baggage: 'sentry-sampled=true,sentry-org_id=1',
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(TRACE_HEADERS).toEqual(['sentry-trace', 'baggage', 'traceparent']);
    const kept = response.headers.get('x-middleware-override-headers')?.split(',') ?? [];
    for (const header of TRACE_HEADERS) {
      expect(upstreamHeader(response, header)).toBeNull();
      expect(kept).not.toContain(header);
    }
  });

  it('drops x-forwarded-for when Vercel gave no client IP, rather than passing the client’s', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/health', { 'x-forwarded-for': '6.6.6.6' });
    expect(upstreamHeader(response, 'x-forwarded-for')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).not.toContain('x-forwarded-for');
  });

  it('passes the browser’s own headers through, so cookies and the Origin check still work', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    const response = call('/api/rpc/system/status', {
      cookie: 'session=abc',
      origin: 'https://brij-crm.vercel.app',
    });
    expect(upstreamHeader(response, 'cookie')).toBe('session=abc');
    expect(upstreamHeader(response, 'origin')).toBe('https://brij-crm.vercel.app');
  });

  it('vouches for the request with the edge secret, replacing a forged copy from the client', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    const response = call('/api/rpc/system/status', { [EDGE_HEADER]: 'forged-by-the-client' });
    expect(upstreamHeader(response, EDGE_HEADER)).toBe('the-real-edge-secret-of-32-characters');
  });

  it('copies the browser’s Origin into the vouched origin header, replacing a client’s own copy', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    const response = call('/api/rpc/system/status', {
      origin: 'https://brij-crm.vercel.app',
      [ORIGIN_HEADER]: 'https://evil.test',
    });
    expect(upstreamHeader(response, ORIGIN_HEADER)).toBe('https://brij-crm.vercel.app');
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).toContain(ORIGIN_HEADER);
    const noOrigin = call('/api/rpc/system/status', { [ORIGIN_HEADER]: 'https://evil.test' });
    expect(upstreamHeader(noOrigin, ORIGIN_HEADER)).toBeNull();
    expect(noOrigin.headers.get('x-middleware-override-headers')?.split(',')).not.toContain(ORIGIN_HEADER);
  });

  it('sends no vouched origin while EDGE_SECRET is unset in development, and drops a client’s copy', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', '');
    vi.stubEnv('VERCEL_ENV', 'development');
    const response = call('/api/rpc/system/status', {
      origin: 'https://brij-crm.vercel.app',
      [ORIGIN_HEADER]: 'https://evil.test',
    });
    expect(upstreamHeader(response, ORIGIN_HEADER)).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).not.toContain(ORIGIN_HEADER);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('strips a client’s edge header and sends none while EDGE_SECRET is %s in development', (_name, secret) => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', secret);
    vi.stubEnv('VERCEL_ENV', 'development');
    const response = call('/api/rpc/system/status', { [EDGE_HEADER]: 'forged-by-the-client' });
    expect(upstreamHeader(response, EDGE_HEADER)).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).not.toContain(EDGE_HEADER);
  });

  it.each([
    ['a secret too short', 'short'],
    ['a secret with a space', 'the-real-edge-secret of-32-characters'],
  ])('answers 503 rather than send %s', async (_name, secret) => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', secret);
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(((await response.json()) as { code: string }).code).toBe('API_UNAVAILABLE');
  });

  it.each([
    ['preview', undefined],
    ['production', undefined],
    ['preview', ''],
    ['production', ''],
  ])('answers 503 in %s while EDGE_SECRET is unset or empty (%j), since the API would refuse', async (env, secret) => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', secret);
    vi.stubEnv('VERCEL_ENV', env);
    const response = call('/api/health', { [EDGE_HEADER]: 'forged-by-the-client' });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(await response.json()).toEqual({
      code: 'API_UNAVAILABLE',
      message: 'This deployment has no edge secret set.',
    });
  });

  it('forwards in production with the secret set', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    vi.stubEnv('VERCEL_ENV', 'production');
    const response = call('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${API}/api/health`);
  });

  it('never sends the secret to an API address that isn’t https', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', 'http://api-production.up.railway.app');
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('sends /api on to the function in this project while API_ORIGIN_INTERNAL is %s (spec 0045)', (_name, origin) => {
    vi.stubEnv('API_ORIGIN_INTERNAL', origin);
    const response = call('/api/rpc/system/status?cursor=abc');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});

describe('the api switch (spec 0045)', () => {
  it('proxies when API_ORIGIN_INTERNAL is set, and runs the function when it is unset or empty', () => {
    expect(apiTarget({ API_ORIGIN_INTERNAL: API })).toBe('proxy');
    expect(apiTarget({})).toBe('function');
    expect(apiTarget({ API_ORIGIN_INTERNAL: '' })).toBe('function');
  });

  it('vouches for a request to the function with the edge secret, replacing a forged copy', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', '');
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    vi.stubEnv('VERCEL_ENV', 'production');
    const response = call('/api/rpc/system/status', {
      [EDGE_HEADER]: 'forged-by-the-client',
      [ORIGIN_HEADER]: 'https://evil.example',
      origin: 'https://brij-crm.vercel.app',
      'x-forwarded-for': '6.6.6.6',
      'sentry-trace': 'caller-chosen',
    });
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(upstreamHeader(response, EDGE_HEADER)).toBe('the-real-edge-secret-of-32-characters');
    expect(upstreamHeader(response, ORIGIN_HEADER)).toBe('https://brij-crm.vercel.app');
    expect(upstreamHeader(response, 'x-forwarded-for')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).not.toContain('sentry-trace');
  });

  it('answers 503 in production when the function mode has no edge secret, as the proxy does', async () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', '');
    vi.stubEnv('EDGE_SECRET', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(((await response.json()) as { code: string }).code).toBe('API_UNAVAILABLE');
  });

  it('leaves the share card for this project, never the API, whatever the API is', () => {
    // The card sits under /api/public/ so one origin serves it, but api/card.mjs draws it. Were it proxied, a
    // deployment whose API is Railway would answer every pasted link's picture with that API's 404.
    vi.stubEnv('API_ORIGIN_INTERNAL', 'https://api.timefix.com');
    vi.stubEnv('EDGE_SECRET', 'the-real-edge-secret-of-32-characters');
    vi.stubEnv('VERCEL_ENV', 'production');
    const response = call('/api/public/handles/ada/card.png');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    // The handle's own public read is the API's, as it always was.
    expect(call('/api/public/handles/ada').headers.get('x-middleware-rewrite')).toContain('api.timefix.com');
  });

  it('refuses a malformed edge secret in the function mode too', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', '');
    vi.stubEnv('EDGE_SECRET', 'short');
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });
});

describe('the public booking host (BOOKING_PUBLIC_ORIGIN)', () => {
  const at = (url: string, headers: Record<string, string> = {}) => middleware(new Request(url, { headers }));
  const hint = `${SESSION_HINT_COOKIE}=${SESSION_HINT_PRESENT}`;
  /** The same request made twice: once plain, once carrying the session hint. */
  const bothWays: readonly Record<string, string>[] = [{}, { cookie: hint }];

  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://app.timefix.com');
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', 'https://timefix.com');
    vi.stubEnv('PUBLIC_HOST_HOME_URL', 'https://www.timefix.com');
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
  });

  it.each(['/sign-in', '/settings/profile', '/w/acme', '/api/rpc/system/status', '/book.html'])(
    'moves %s there to the marketing site, for good',
    (pathname) => {
      const response = at(`https://timefix.com${pathname}`);
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe('https://www.timefix.com/');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(response.headers.get('vary')).toBe('host');
    },
  );

  // The apex's home is the one answer that reads a cookie (25 Oct 2026), so it is never kept for anyone else.
  it('takes a browser holding the session hint to the app, privately', () => {
    const response = at('https://timefix.com/', { cookie: `theme=dark; ${hint}` });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://app.timefix.com/');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('cookie, host');
  });

  it('takes a browser without the hint to the marketing site, and keeps that answer private too', () => {
    const response = at('https://timefix.com/');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://www.timefix.com/');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('cookie, host');
  });

  it(`keeps the marketing site with ?${STAY_PARAM}, which may be cached for good`, () => {
    const response = at(`https://timefix.com/?${STAY_PARAM}=1`, { cookie: hint });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://www.timefix.com/');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('vary')).toBe('host');
  });

  it('never reads a cookie for the other paths, so their move stays cacheable for everyone', () => {
    for (const pathname of ['/sign-in', '/w/acme', '/book.html']) {
      const response = at(`https://timefix.com${pathname}`, { cookie: hint });
      expect(response.status, pathname).toBe(308);
      expect(response.headers.get('location'), pathname).toBe('https://www.timefix.com/');
      expect(response.headers.get('cache-control'), pathname).toBe('public, max-age=3600');
      expect(response.headers.get('vary'), pathname).toBe('host');
    }
  });

  it.each(['/ada', '/ada/30min', '/b/AbCdEfGhIjKlMnOp', '/f/contact', '/embed/v1.js', '/embed.js'])(
    'keeps %s there, with the session hint or without it',
    (pathname) => {
      for (const headers of bothWays) {
        const response = at(`https://timefix.com${pathname}`, headers);
        expect(response.status).not.toBe(308);
        expect(response.status).not.toBe(302);
        expect(response.headers.get('x-middleware-next')).toBe('1');
      }
    },
  );

  it('proxies the public API there as anywhere', () => {
    const response = at('https://timefix.com/api/public/handles/ada/30min');
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${API}/api/public/handles/ada/30min`);
  });

  it('leaves the app’s own routes, API and files alone', () => {
    for (const pathname of ['/', '/settings/profile', '/w/acme', '/api/rpc/system/status', '/favicon.ico']) {
      for (const headers of bothWays) {
        const response = at(`https://app.timefix.com${pathname}`, headers);
        expect(response.status, pathname).not.toBe(308);
        expect(response.status, pathname).not.toBe(302);
      }
    }
  });

  it('moves a handle address off the app’s host to the booking origin, for good', () => {
    for (const [pathname, location] of [
      ['/ada', 'https://timefix.com/ada'],
      ['/ada/30min', 'https://timefix.com/ada/30min'],
      ['/ada?month=2026-11', 'https://timefix.com/ada?month=2026-11'],
    ]) {
      const response = at(`https://app.timefix.com${pathname}`);
      expect(response.status, pathname).toBe(308);
      expect(response.headers.get('location'), pathname).toBe(location);
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(response.headers.get('vary')).toBe('host');
    }
  });

  it('moves no handle address while one host serves both, as a preview does', () => {
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', 'https://app.timefix.com');
    expect(at('https://app.timefix.com/ada').status).not.toBe(308);
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', '');
    expect(at('https://app.timefix.com/ada').status).not.toBe(308);
  });

  it('changes nothing with PUBLIC_HOST_HOME_URL or APP_URL unset, or when the public origin is the app’s own', () => {
    const moves = (url: string) => [308, 302].includes(at(url, { cookie: hint }).status);
    vi.stubEnv('PUBLIC_HOST_HOME_URL', '');
    expect(moves('https://timefix.com/')).toBe(false);
    vi.stubEnv('PUBLIC_HOST_HOME_URL', 'https://www.timefix.com');
    vi.stubEnv('APP_URL', '');
    expect(moves('https://timefix.com/')).toBe(false);
    vi.stubEnv('APP_URL', 'https://app.timefix.com');
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', 'https://app.timefix.com');
    expect(moves('https://app.timefix.com/')).toBe(false);
  });
});

// Vercel compiles middleware.ts on its own: an import of the repo's TypeScript or a workspace package fails the
// deploy (it did on 22 Oct 2026), so what it needs from public-paths.ts is written out there, and kept equal here.
describe('the public host check written out in middleware.ts', () => {
  it('imports nothing but @vercel/functions', () => {
    const source = readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)';/gms)].map((match) => match[1]);
    expect(imports).toEqual(['@vercel/functions']);
  });

  it('serves exactly the paths public-paths.ts serves', () => {
    expect(PUBLIC_HOST_PATH.source).toBe(paths.PUBLIC_HOST_PATH.source);
    expect(HANDLE_PATH.source).toBe(paths.HANDLE_PATH.source);
    expect(CARD_PATH.source).toBe(paths.CARD_PATH.source);
    expect(STRIP_PATH.source).toBe(paths.STRIP_PATH.source);
    expect(CRAWL_FILES).toEqual(paths.CRAWL_FILES);
  });

  it('moves exactly what public-paths.ts moves', () => {
    const env = {
      PUBLIC_HOST_HOME_URL: 'https://www.timefix.com',
      BOOKING_PUBLIC_ORIGIN: 'https://timefix.com',
      APP_URL: 'https://app.timefix.com',
    };
    const urls = [
      'https://timefix.com/',
      'https://timefix.com/settings',
      'https://timefix.com/ada',
      'https://timefix.com/ada/30min',
      'https://timefix.com/b/abcdefghijklmnop',
      'https://timefix.com/api/public/booking/x/slots',
      'https://app.timefix.com/w/ada/home',
      'https://app.timefix.com/ada',
      'https://app.timefix.com/ada/30min',
      'https://app.timefix.com/settings',
      'https://app.timefix.com/api/rpc/system/status',
    ];
    const cookies = [undefined, `${SESSION_HINT_COOKIE}=${SESSION_HINT_PRESENT}`, 'theme=dark'];
    for (const each of [...urls, `https://timefix.com/?${STAY_PARAM}=1`]) {
      for (const cookie of cookies) {
        expect(publicHostRedirect(new URL(each), env, cookie), `${each} ${String(cookie)}`).toEqual(
          paths.publicHostRedirect(new URL(each), env, cookie),
        );
      }
      expect(handleHostRedirect(new URL(each), env), each).toBe(paths.handleHostRedirect(new URL(each), env));
    }
    expect(publicHostRedirect(new URL('https://timefix.com/settings'), env)).toEqual({
      location: 'https://www.timefix.com/',
      onCookie: false,
    });
    expect(publicHostRedirect(new URL('https://timefix.com/ada/30min'), env)).toBeUndefined();
    expect(handleHostRedirect(new URL('https://app.timefix.com/ada'), env)).toBe('https://timefix.com/ada');
  });

  it('reads the session hint cookie exactly as public-paths.ts does', () => {
    expect(SESSION_HINT_COOKIE).toBe(cookieName);
    expect(SESSION_HINT_PRESENT).toBe(cookiePresent);
    expect(STAY_PARAM).toBe(paths.STAY_PARAM);
    for (const cookie of [
      undefined,
      '',
      `${cookieName}=${cookiePresent}`,
      `a=1; ${cookieName}=${cookiePresent}; b=2`,
      `${cookieName}=`,
      `${cookieName}=0`,
      `x${cookieName}=${cookiePresent}`,
      `${cookieName}_other=${cookiePresent}`,
    ]) {
      expect(hasSessionHint(cookie), String(cookie)).toBe(paths.hasSessionHint(cookie));
    }
  });
});
