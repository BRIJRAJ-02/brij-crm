// The middleware is the one origin's edge: it decides where /api goes and what
// the API is told about the caller. Vercel reads the rewrite and the upstream
// request headers from the response's x-middleware-* headers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourcePattern } from './csp.ts';
import middleware, { apiTarget, config, EDGE_HEADER, GEO_HEADERS, ORIGIN_HEADER, TRACE_HEADERS } from './middleware.ts';
import { MIDDLEWARE_MATCHER } from './public-paths.ts';

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

  it('refuses a malformed edge secret in the function mode too', () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', '');
    vi.stubEnv('EDGE_SECRET', 'short');
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });
});

describe('the public booking host (BOOKING_PUBLIC_ORIGIN)', () => {
  const at = (url: string) => middleware(new Request(url));

  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://app.timefix.ai');
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', 'https://timefix.com');
    vi.stubEnv('PUBLIC_HOST_HOME_URL', 'https://timefix.ai');
    vi.stubEnv('API_ORIGIN_INTERNAL', API);
  });

  it.each(['/', '/sign-in', '/settings/profile', '/w/acme', '/api/rpc/system/status', '/book.html'])(
    'moves %s there to the marketing site, for good',
    (pathname) => {
      const response = at(`https://timefix.com${pathname}`);
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe('https://timefix.ai/');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    },
  );

  it.each(['/ada', '/ada/30min', '/b/AbCdEfGhIjKlMnOp', '/f/contact', '/embed/v1.js', '/embed.js'])(
    'keeps %s there',
    (pathname) => {
      const response = at(`https://timefix.com${pathname}`);
      expect(response.status).not.toBe(308);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  it('proxies the public API there as anywhere', () => {
    const response = at('https://timefix.com/api/public/handles/ada/30min');
    expect(response.headers.get('x-middleware-rewrite')).toBe(`${API}/api/public/handles/ada/30min`);
  });

  it('leaves the app’s own host alone', () => {
    expect(at('https://app.timefix.ai/').status).not.toBe(308);
    expect(at('https://app.timefix.ai/settings/profile').status).not.toBe(308);
  });

  it('changes nothing with PUBLIC_HOST_HOME_URL or APP_URL unset, or when the public origin is the app’s own', () => {
    vi.stubEnv('PUBLIC_HOST_HOME_URL', '');
    expect(at('https://timefix.com/').status).not.toBe(308);
    vi.stubEnv('PUBLIC_HOST_HOME_URL', 'https://timefix.ai');
    vi.stubEnv('APP_URL', '');
    expect(at('https://timefix.com/').status).not.toBe(308);
    vi.stubEnv('APP_URL', 'https://app.timefix.ai');
    vi.stubEnv('BOOKING_PUBLIC_ORIGIN', 'https://app.timefix.ai');
    expect(at('https://app.timefix.ai/').status).not.toBe(308);
  });
});
