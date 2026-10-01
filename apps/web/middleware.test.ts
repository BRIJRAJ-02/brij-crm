// The middleware is the one origin's edge: it decides where /api goes and what
// the API is told about the caller. Vercel reads the rewrite and the upstream
// request headers from the response's x-middleware-* headers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware, { config } from './middleware.ts';

const API = 'https://api-production.up.railway.app';

function call(path: string, headers: Record<string, string> = {}): Response {
  return middleware(new Request(`https://brij-crm.vercel.app${path}`, { method: 'POST', headers }));
}

function upstreamHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

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
