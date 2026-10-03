// The Hono app's own refusals: the edge guard (spec 0005, AC-33), the body
// limits on /api/rpc and /api/auth, the Better Auth routes it serves, and
// the shared error shape on each.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTH_BODY_LIMIT_BYTES, RPC_BODY_LIMIT_BYTES } from './app.ts';
import { EDGE_HEADER } from './edge.ts';
import { APP_URL, captureLogs, createTestApp } from './testing.ts';

const SECRET = 'an-edge-secret-of-at-least-32-characters';

function rpcRequest(
  path: string,
  init: { headers?: Record<string, string>; body?: string | ReadableStream<Uint8Array> } = {},
): Request {
  return new Request(`${APP_URL}/api/rpc/${path}`, {
    method: 'POST',
    headers: { origin: APP_URL, 'content-type': 'application/json', ...init.headers },
    body: init.body ?? JSON.stringify({ json: null }),
    duplex: 'half',
  });
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  logs.restore();
});

describe('the edge guard', () => {
  const guarded = createTestApp({ APP_ENV: 'preview', EDGE_SECRET: SECRET });

  it('refuses /api/* without the header with 403 EDGE_REQUIRED', async () => {
    const response = await guarded.fetch(rpcRequest('context'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'EDGE_REQUIRED',
      message: 'This API is reachable only through the app.',
    });
  });

  it.each([
    ['a wrong secret', 'not-the-secret'],
    ['the secret with a byte more', `${SECRET}x`],
    ['the secret cut short', SECRET.slice(0, -1)],
    ['an empty header', ''],
  ])('refuses %s', async (_name, value) => {
    const response = await guarded.fetch(rpcRequest('context', { headers: { [EDGE_HEADER]: value } }));
    expect(response.status).toBe(403);
  });

  it('refuses unknown paths too, before saying they don’t exist', async () => {
    const response = await guarded.fetch(new Request(`${APP_URL}/api/nothing-here`));
    expect(response.status).toBe(403);
  });

  it('lets a request with the secret through, and trusts its forwarded IP', async () => {
    const response = await guarded.fetch(
      rpcRequest('context', { headers: { [EDGE_HEADER]: SECRET, 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { json: { clientIp: string | null } };
    expect(body.json.clientIp).toBe('203.0.113.7');
  });

  it.each(['/api/health', '/api/health/ready'])('leaves the health check %s open', async (path) => {
    const response = await guarded.fetch(new Request(`${APP_URL}${path}`));
    expect(response.status).not.toBe(403);
  });

  it('opens only the exact health paths', async () => {
    const response = await guarded.fetch(new Request(`${APP_URL}/api/health/../rpc/context`, { method: 'POST' }));
    expect(response.status).toBe(403);
    const encoded = await guarded.fetch(new Request(`${APP_URL}/api/health%2F..%2Frpc%2Fcontext`));
    expect(encoded.status).toBe(403);
  });

  it('is open locally, even with the secret set, and trusts the forwarded IP there', async () => {
    const local = createTestApp({ APP_ENV: 'local', EDGE_SECRET: SECRET });
    const response = await local.fetch(rpcRequest('context', { headers: { 'x-forwarded-for': '198.51.100.4' } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { json: { clientIp: string | null } };
    expect(body.json.clientIp).toBe('198.51.100.4');
  });

  it.each(['preview', 'production'] as const)(
    'is open in %s while EDGE_SECRET is unset, but trusts no forwarded IP',
    async (environment) => {
      const unset = createTestApp({ APP_ENV: environment });
      const response = await unset.fetch(rpcRequest('context', { headers: { 'x-forwarded-for': '6.6.6.6' } }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { json: { clientIp: string | null } };
      expect(body.json.clientIp).toBeNull();
    },
  );

  it('never logs the secret', async () => {
    await guarded.fetch(rpcRequest('context', { headers: { [EDGE_HEADER]: SECRET } }));
    await guarded.fetch(rpcRequest('context', { headers: { [EDGE_HEADER]: 'wrong' } }));
    expect(JSON.stringify(logs.lines())).not.toContain(SECRET);
  });
});

describe('the body limit on /api/rpc', () => {
  const app = createTestApp();
  const oversized = JSON.stringify({ json: { name: 'x'.repeat(RPC_BODY_LIMIT_BYTES), tags: [] } });

  it('answers a body over 1 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await app.fetch(rpcRequest('echo', { body: oversized }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'This request is larger than the 1 MB the API accepts.',
    });
  });

  it('counts a streamed body without a length too', async () => {
    const bytes = new TextEncoder().encode(oversized);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 64 * 1024) controller.enqueue(bytes.slice(at, at + 64 * 1024));
        controller.close();
      },
    });
    const response = await app.fetch(rpcRequest('echo', { body: stream }));
    expect(response.status).toBe(413);
  });

  it('reads a body just under the limit', async () => {
    const body = JSON.stringify({ json: { name: 'x'.repeat(RPC_BODY_LIMIT_BYTES - 100), tags: [] } });
    const response = await app.fetch(rpcRequest('echo', { body }));
    expect(response.status).toBe(200);
  });
});

describe('the body limit on /api/auth', () => {
  const app = createTestApp();
  const authRequest = (body: string | ReadableStream<Uint8Array>) =>
    new Request(`${APP_URL}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: { origin: APP_URL, 'content-type': 'application/json' },
      body,
      duplex: 'half',
    });
  const oversized = JSON.stringify({ email: 'ada@example.com', otp: 'x'.repeat(AUTH_BODY_LIMIT_BYTES) });

  it('answers a body over 64 KB with 413 PAYLOAD_TOO_LARGE, before Better Auth reads it', async () => {
    const response = await app.fetch(authRequest(oversized));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'This request is larger than the 64 KB sign in accepts.',
    });
  });

  it('counts a streamed body without a length too', async () => {
    const bytes = new TextEncoder().encode(oversized);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 16 * 1024) controller.enqueue(bytes.slice(at, at + 16 * 1024));
        controller.close();
      },
    });
    const response = await app.fetch(authRequest(stream));
    expect(response.status).toBe(413);
  });

  it('passes a body under the limit on to Better Auth', async () => {
    const response = await app.fetch(authRequest(JSON.stringify({ email: 'ada@example.com', otp: '123456' })));
    // Better Auth answers it (here with no database behind it), never the limit's 413.
    expect(response.status).not.toBe(413);
  });
});

describe('the Better Auth routes the API serves', () => {
  const app = createTestApp();

  it.each([
    ['POST', '/update-user'],
    ['GET', '/list-sessions'],
    ['POST', '/link-social'],
    ['POST', '/revoke-sessions'],
    ['POST', '/revoke-other-sessions'],
    ['POST', '/change-email'],
    ['POST', '/delete-user'],
    ['GET', '/ok'],
    ['POST', '/sign-up/email'],
    ['POST', '/sign-in/email'],
    ['POST', '/email-otp/check-verification-otp'],
    // A listed route, padded or encoded, is a different address.
    ['POST', '/sign-out/'],
    ['POST', '/sign%2Dout'],
    ['GET', '/GET-SESSION'],
  ])('answers %s %s with 404 NOT_FOUND', async (method, path) => {
    const response = await app.fetch(
      new Request(`${APP_URL}/api/auth${path}`, {
        method,
        headers: { origin: APP_URL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', message: 'There is nothing at this address.' });
  });

  it('serves the session read, which answers no session without a cookie', async () => {
    const response = await app.fetch(new Request(`${APP_URL}/api/auth/get-session`));
    expect(response.status).not.toBe(404);
  });
});

describe('the shared error shape', () => {
  const app = createTestApp();

  it('answers an unknown address with 404 NOT_FOUND and a request id', async () => {
    const response = await app.fetch(new Request(`${APP_URL}/api/nothing-here`));
    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', message: 'There is nothing at this address.' });
  });

  it('answers a write from another origin with 403 FORBIDDEN_ORIGIN', async () => {
    const response = await app.fetch(rpcRequest('context', { headers: { origin: 'https://evil.test' } }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('FORBIDDEN_ORIGIN');
  });
});
