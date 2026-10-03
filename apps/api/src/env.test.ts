// The api's sign in and mail variables (spec 0005): what each environment
// must set, and what an unset or empty one means.
import { describe, expect, it } from 'vitest';
import { ApiEnv, WorkerEnv } from './env.ts';

const local = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgres://app:p@localhost:6432/crm',
  IDENTITY_DATABASE_URL: 'postgres://identity:p@localhost:5433/crm',
  APP_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'local-only-better-auth-secret-0000000000',
  BETTER_AUTH_URL: 'http://localhost:5173',
  MAILPIT_URL: 'http://localhost:8025',
};

const production = {
  ...local,
  APP_ENV: 'production',
  APP_URL: 'https://app.test',
  BETTER_AUTH_URL: 'https://app.test',
  BETTER_AUTH_SECRET: 'a-production-secret-of-at-least-32-characters',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'onboarding@resend.dev',
  EDGE_SECRET: 'an-edge-secret-of-at-least-32-characters',
};

function problems(input: Record<string, unknown>): string[] {
  const result = ApiEnv.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('the sign in environment', () => {
  it('boots locally on Mailpit, with an open sign up and a local sender', () => {
    const env = ApiEnv.parse(local);
    expect(env.MAILPIT_URL).toBe('http://localhost:8025');
    expect(env.SIGNUP_ALLOWLIST).toBeUndefined();
    expect(env.MAIL_FROM).toBe('CRM <sign-in@crm.localhost>');
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('needs the identity login, a long secret and the public origin everywhere', () => {
    const { IDENTITY_DATABASE_URL: _i, BETTER_AUTH_URL: _u, ...rest } = local;
    expect(problems({ ...rest, BETTER_AUTH_SECRET: 'short' }).sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'IDENTITY_DATABASE_URL',
    ]);
  });

  it('needs a way to send codes locally', () => {
    expect(problems({ ...local, MAILPIT_URL: '' })).toEqual(['MAILPIT_URL']);
    expect(problems({ ...local, MAILPIT_URL: '', RESEND_API_KEY: 're_test' })).toEqual([]);
  });

  it('needs Resend and a sender outside local, and ignores Mailpit there', () => {
    expect(problems({ ...production, RESEND_API_KEY: undefined, MAIL_FROM: '' }).sort()).toEqual([
      'MAIL_FROM',
      'RESEND_API_KEY',
    ]);
    expect(ApiEnv.parse(production).MAILPIT_URL).toBeUndefined();
    expect(ApiEnv.parse({ ...production, MAIL_FROM: 'CRM <onboarding@resend.dev>' }).MAIL_FROM).toBe(
      'CRM <onboarding@resend.dev>',
    );
    expect(problems({ ...production, MAIL_FROM: 'not a sender' })).toEqual(['MAIL_FROM']);
  });

  it('refuses the local placeholder secret outside local', () => {
    expect(problems({ ...production, BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET })).toEqual(['BETTER_AUTH_SECRET']);
  });

  it('takes Google only with both of its variables', () => {
    expect(problems({ ...local, GOOGLE_CLIENT_ID: 'id' })).toEqual(['GOOGLE_CLIENT_SECRET']);
    expect(problems({ ...local, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })).toEqual([]);
    expect(problems({ ...local, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })).toEqual([]);
  });

  it('reads the allowlist comma separated, trimmed and lowercased, and refuses a non email', () => {
    expect(
      ApiEnv.parse({ ...production, SIGNUP_ALLOWLIST: ' Ada@Example.com, grace@example.com ,' }).SIGNUP_ALLOWLIST,
    ).toEqual(['ada@example.com', 'grace@example.com']);
    expect(ApiEnv.parse({ ...production, SIGNUP_ALLOWLIST: '' }).SIGNUP_ALLOWLIST).toBeUndefined();
    expect(problems({ ...production, SIGNUP_ALLOWLIST: 'ada@example.com, nope' })).toEqual(['SIGNUP_ALLOWLIST.1']);
  });

  it('refuses APP_ENV=local in a production build', () => {
    expect(problems({ ...local, NODE_ENV: 'production' })).toEqual(['APP_ENV']);
    expect(problems({ ...local, NODE_ENV: 'development' })).toEqual([]);
    expect(problems({ ...production, NODE_ENV: 'production' })).toEqual([]);
  });

  it('refuses a BETTER_AUTH_URL on another origin than APP_URL outside local', () => {
    expect(problems({ ...production, BETTER_AUTH_URL: 'https://api.railway.test' })).toEqual(['BETTER_AUTH_URL']);
    expect(problems({ ...production, BETTER_AUTH_URL: 'http://app.test' })).toEqual(['BETTER_AUTH_URL']);
    expect(problems({ ...production, BETTER_AUTH_URL: 'https://app.test:8443' })).toEqual(['BETTER_AUTH_URL']);
    // A path or a trailing slash is the same origin.
    expect(problems({ ...production, BETTER_AUTH_URL: 'https://app.test/' })).toEqual([]);
    expect(problems({ ...production, APP_ENV: 'preview', BETTER_AUTH_URL: 'https://elsewhere.test' })).toEqual([
      'BETTER_AUTH_URL',
    ]);
    // Locally the API may sit on its own port.
    expect(problems({ ...local, BETTER_AUTH_URL: 'http://localhost:3000' })).toEqual([]);
  });
});

describe('the worker environment (spec 0005, the relay)', () => {
  const worker = {
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://app:p@localhost:6432/crm',
    DATABASE_URL_DIRECT: 'postgres://app:p@localhost:5433/crm',
  };
  const centrifugo = { CENTRIFUGO_API_URL: 'http://centrifugo.railway.internal:9000', CENTRIFUGO_API_KEY: 'key' };

  function workerProblems(input: Record<string, unknown>): string[] {
    const result = WorkerEnv.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  }

  it('boots locally without Centrifugo, with the relay off', () => {
    expect(WorkerEnv.parse(worker).centrifugo).toBeUndefined();
    expect(WorkerEnv.parse({ ...worker, CENTRIFUGO_API_URL: '', CENTRIFUGO_API_KEY: '' }).centrifugo).toBeUndefined();
  });

  it('turns the relay on with both variables, and refuses one alone', () => {
    expect(WorkerEnv.parse({ ...worker, ...centrifugo }).centrifugo).toEqual({
      apiUrl: centrifugo.CENTRIFUGO_API_URL,
      apiKey: 'key',
    });
    expect(workerProblems({ ...worker, CENTRIFUGO_API_URL: centrifugo.CENTRIFUGO_API_URL })).toEqual([
      'CENTRIFUGO_API_KEY',
    ]);
    expect(workerProblems({ ...worker, CENTRIFUGO_API_URL: 'not a url', CENTRIFUGO_API_KEY: 'key' })).toEqual([
      'CENTRIFUGO_API_URL',
    ]);
  });

  it('needs both outside local', () => {
    for (const APP_ENV of ['preview', 'production']) {
      expect(workerProblems({ ...worker, APP_ENV }).sort()).toEqual(['CENTRIFUGO_API_KEY', 'CENTRIFUGO_API_URL']);
      expect(workerProblems({ ...worker, APP_ENV, ...centrifugo })).toEqual([]);
    }
  });
});
