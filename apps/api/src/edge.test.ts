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
    ['preview', true],
    ['production', true],
    ['local', false],
  ] as const)('in %s is %s', (environment, enforced) => {
    expect(isEdgeGuardEnforced({ environment })).toBe(enforced);
  });

  it.each(['preview', 'production'] as const)(
    'refuses everything but the health checks in %s when built without a secret (ApiEnv never boots so)',
    (environment) => {
      const guard = createEdgeGuard({ secret: undefined, environment });
      expect(guard.enforced).toBe(true);
      const open = request({ [EDGE_HEADER]: '', 'x-forwarded-for': '6.6.6.6' });
      expect(guard.admit(open)).toBe(false);
      expect(guard.clientIp(open)).toBeUndefined();
      expect(guard.admit(new Request('https://api.test/api/health'))).toBe(true);
    },
  );
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

  it('is undefined for a health check let through without the secret', () => {
    const guard = createEdgeGuard({ secret: SECRET, environment: 'production' });
    const health = new Request('https://api.test/api/health', { headers: { 'x-forwarded-for': '6.6.6.6' } });
    expect(guard.admit(health)).toBe(true);
    expect(guard.clientIp(health)).toBeUndefined();
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
    IDENTITY_DATABASE_URL: 'postgres://i:p@db.test/crm',
    APP_URL: 'https://app.test',
    BETTER_AUTH_SECRET: 'a-production-secret-of-at-least-32-characters',
    BETTER_AUTH_URL: 'https://app.test',
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'onboarding@resend.dev',
    EDGE_SECRET: SECRET,
  };

  const problems = (input: Record<string, unknown>) =>
    ApiEnv.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];

  it.each(['preview', 'production'])('is required in %s, and an empty value counts as unset', (environment) => {
    const { EDGE_SECRET: _secret, ...unset } = base;
    expect(problems({ ...unset, APP_ENV: environment })).toEqual(['EDGE_SECRET']);
    expect(problems({ ...base, APP_ENV: environment, EDGE_SECRET: '' })).toEqual(['EDGE_SECRET']);
    expect(problems({ ...base, APP_ENV: environment })).toEqual([]);
  });

  it('is optional locally, where the guard is off', () => {
    const local = { ...base, APP_ENV: 'local', MAILPIT_URL: 'http://localhost:8025', EDGE_SECRET: '' };
    expect(ApiEnv.parse(local).EDGE_SECRET).toBeUndefined();
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
