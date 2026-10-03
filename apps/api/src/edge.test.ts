// The guard on its own: when it is on, and when the forwarded IP is believed.
import { describe, expect, it } from 'vitest';
import { createEdgeGuard, EDGE_HEADER, isEdgeGuardEnforced } from './edge.ts';
import { ApiEnv } from './env.ts';

const SECRET = 'an-edge-secret-of-at-least-32-characters';

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://api.test/api/rpc/system/status', { headers });
}

describe('isEdgeGuardEnforced', () => {
  it.each([
    [SECRET, 'preview', true],
    [SECRET, 'production', true],
    [SECRET, 'local', false],
    [undefined, 'preview', false],
    [undefined, 'production', false],
  ] as const)('with secret %s in %s is %s', (secret, environment, enforced) => {
    expect(isEdgeGuardEnforced({ secret, environment })).toBe(enforced);
  });
});

describe('clientIp', () => {
  it('is undefined before the guard has run on the request', () => {
    const guard = createEdgeGuard({ secret: SECRET, environment: 'production' });
    expect(guard.clientIp(request({ [EDGE_HEADER]: SECRET, 'x-forwarded-for': '203.0.113.7' }))).toBeUndefined();
  });

  it('is the first forwarded address once the guard admitted the request by its secret', () => {
    const guard = createEdgeGuard({ secret: SECRET, environment: 'production' });
    const admitted = request({ [EDGE_HEADER]: SECRET, 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' });
    expect(guard.admit(admitted)).toBe(true);
    expect(guard.clientIp(admitted)).toBe('203.0.113.7');
  });

  it('is undefined for a refused request', () => {
    const guard = createEdgeGuard({ secret: SECRET, environment: 'production' });
    const refused = request({ [EDGE_HEADER]: 'nope', 'x-forwarded-for': '6.6.6.6' });
    expect(guard.admit(refused)).toBe(false);
    expect(guard.clientIp(refused)).toBeUndefined();
  });

  it('is undefined while the guard is off outside local', () => {
    const guard = createEdgeGuard({ secret: undefined, environment: 'production' });
    const open = request({ 'x-forwarded-for': '6.6.6.6' });
    expect(guard.admit(open)).toBe(true);
    expect(guard.clientIp(open)).toBeUndefined();
  });

  it('is undefined with no forwarded header, even when trusted', () => {
    const guard = createEdgeGuard({ secret: undefined, environment: 'local' });
    const local = request();
    expect(guard.admit(local)).toBe(true);
    expect(guard.clientIp(local)).toBeUndefined();
  });
});

describe('EDGE_SECRET in the api environment', () => {
  const base = {
    APP_ENV: 'production',
    DATABASE_URL: 'postgres://u:p@db.test/crm',
    APP_URL: 'https://app.test',
  };

  it('is optional, and an empty value counts as unset', () => {
    expect(ApiEnv.parse(base).EDGE_SECRET).toBeUndefined();
    expect(ApiEnv.parse({ ...base, EDGE_SECRET: '' }).EDGE_SECRET).toBeUndefined();
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(ApiEnv.safeParse({ ...base, EDGE_SECRET: 'short' }).success).toBe(false);
  });

  it.each([
    ['a trailing newline', `${SECRET}\n`],
    ['a space', `${SECRET} x`],
    ['a non ASCII character', `${SECRET}é`],
  ])('refuses a secret with %s, which a header would not carry intact', (_name, secret) => {
    expect(ApiEnv.safeParse({ ...base, EDGE_SECRET: secret }).success).toBe(false);
  });

  it('accepts a secret of 32 characters or more', () => {
    expect(ApiEnv.parse({ ...base, EDGE_SECRET: SECRET }).EDGE_SECRET).toBe(SECRET);
  });
});
