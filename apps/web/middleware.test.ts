// The middleware is the one origin's edge: it decides where /api goes and what
// the API is told about the caller. Vercel reads the rewrite and the upstream
// request headers from the response's x-middleware-* headers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import middleware, { config, EDGE_HEADER, ORIGIN_HEADER } from './middleware.ts';

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
  it('matches /api and everything under it, and nothing else', () => {
    expect(config.matcher).toEqual(['/api', '/api/:path*']);
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
    const noOrigin = call('/api/rpc/system/status', { [ORIGIN_HEADER]: 'https://evil.test' });
    expect(upstreamHeader(noOrigin, ORIGIN_HEADER)).toBeNull();
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

  it('answers 503 with the error shape when the deployment has no API address', async () => {
    vi.stubEnv('API_ORIGIN_INTERNAL', '');
    const response = call('/api/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(await response.json()).toEqual({
      code: 'API_UNAVAILABLE',
      message: 'This deployment has no API address set.',
    });
  });
});
