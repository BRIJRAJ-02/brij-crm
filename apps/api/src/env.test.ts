// The api's sign in and mail variables (spec 0005): what each environment
// must set, and what an unset or empty one means.
import { describe, expect, it } from 'vitest';
import { ApiEnv, LOCAL_CENTRIFUGO_API_KEY, LOCAL_CENTRIFUGO_TOKEN_SECRET, WorkerEnv } from './env.ts';

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
  WORKER_INTERNAL_URL: 'http://worker.railway.internal:8080',
  WORKER_WAKE_SECRET: 'a-wake-secret-of-at-least-32-characters',
  CENTRIFUGO_TOKEN_SECRET: 'a-centrifugo-token-secret-of-32-characters',
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

describe("the relay's wake up call (spec 0005)", () => {
  it('is optional locally, where an empty value counts as unset', () => {
    const env = ApiEnv.parse({ ...local, WORKER_INTERNAL_URL: '', WORKER_WAKE_SECRET: '' });
    expect(env.WORKER_INTERNAL_URL).toBeUndefined();
    expect(env.WORKER_WAKE_SECRET).toBeUndefined();
  });

  it('needs the worker address and the secret outside local', () => {
    const { WORKER_INTERNAL_URL: _u, WORKER_WAKE_SECRET: _s, ...rest } = production;
    for (const APP_ENV of ['preview', 'production']) {
      expect(problems({ ...rest, APP_ENV }).sort()).toEqual(['WORKER_INTERNAL_URL', 'WORKER_WAKE_SECRET']);
    }
    expect(problems(production)).toEqual([]);
  });

  it("refuses .env.example's secret outside local, and plain http to a public worker address", () => {
    const placeholder = 'local-only-worker-wake-secret-not-for-deployment';
    expect(problems({ ...production, WORKER_WAKE_SECRET: placeholder })).toEqual(['WORKER_WAKE_SECRET']);
    expect(problems({ ...local, WORKER_WAKE_SECRET: placeholder })).toEqual([]);
    expect(problems({ ...production, WORKER_INTERNAL_URL: 'http://worker.example.com' })).toEqual([
      'WORKER_INTERNAL_URL',
    ]);
    expect(problems({ ...production, WORKER_INTERNAL_URL: 'https://worker.example.com' })).toEqual([]);
    expect(problems({ ...local, WORKER_INTERNAL_URL: 'http://localhost:3001' })).toEqual([]);
  });

  it('refuses a short secret, or one with spaces, anywhere', () => {
    expect(problems({ ...local, WORKER_WAKE_SECRET: 'short' })).toEqual(['WORKER_WAKE_SECRET']);
    expect(problems({ ...production, WORKER_WAKE_SECRET: 'a wake secret with spaces in it, 32+ long' })).toEqual([
      'WORKER_WAKE_SECRET',
    ]);
  });
});

describe("live updates' token secret (spec 0005)", () => {
  it('is optional locally and in previews, where unset turns live updates off', () => {
    expect(problems(local)).toEqual([]);
    expect(ApiEnv.parse({ ...local, CENTRIFUGO_TOKEN_SECRET: '' }).CENTRIFUGO_TOKEN_SECRET).toBeUndefined();
    expect(
      ApiEnv.parse({ ...local, CENTRIFUGO_TOKEN_SECRET: LOCAL_CENTRIFUGO_TOKEN_SECRET }).CENTRIFUGO_TOKEN_SECRET,
    ).toBe(LOCAL_CENTRIFUGO_TOKEN_SECRET);
    expect(problems({ ...production, APP_ENV: 'preview', CENTRIFUGO_TOKEN_SECRET: undefined })).toEqual([]);
  });

  it('is optional in production too, where unset turns live updates off', () => {
    expect(problems({ ...production, CENTRIFUGO_TOKEN_SECRET: undefined })).toEqual([]);
  });

  it("refuses .env.example's secret, or one shorter than 32 characters, outside local", () => {
    for (const APP_ENV of ['preview', 'production']) {
      expect(problems({ ...production, APP_ENV, CENTRIFUGO_TOKEN_SECRET: LOCAL_CENTRIFUGO_TOKEN_SECRET })).toEqual([
        'CENTRIFUGO_TOKEN_SECRET',
      ]);
      expect(problems({ ...production, APP_ENV, CENTRIFUGO_TOKEN_SECRET: 'short' })).toEqual([
        'CENTRIFUGO_TOKEN_SECRET',
      ]);
    }
  });
});

describe('the worker environment (spec 0005, the relay)', () => {
  const worker = {
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://app:p@localhost:6432/crm',
    DATABASE_URL_DIRECT: 'postgres://app:p@localhost:5433/crm',
  };
  const centrifugo = {
    CENTRIFUGO_API_URL: 'http://centrifugo.railway.internal:9000',
    CENTRIFUGO_API_KEY: 'a-centrifugo-key-of-at-least-32-characters',
  };

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
      apiKey: centrifugo.CENTRIFUGO_API_KEY,
    });
    expect(workerProblems({ ...worker, CENTRIFUGO_API_URL: centrifugo.CENTRIFUGO_API_URL })).toEqual([
      'CENTRIFUGO_API_KEY',
    ]);
    expect(workerProblems({ ...worker, CENTRIFUGO_API_URL: 'not a url', CENTRIFUGO_API_KEY: 'key' })).toEqual([
      'CENTRIFUGO_API_URL',
    ]);
  });

  it('needs both, and the wake secret, outside local', () => {
    const wake = { WORKER_WAKE_SECRET: 'a-wake-secret-of-at-least-32-characters' };
    for (const APP_ENV of ['preview', 'production']) {
      expect(workerProblems({ ...worker, APP_ENV }).sort()).toEqual([
        'CENTRIFUGO_API_KEY',
        'CENTRIFUGO_API_URL',
        'WORKER_WAKE_SECRET',
      ]);
      expect(workerProblems({ ...worker, APP_ENV, ...centrifugo, ...wake })).toEqual([]);
    }
    expect(workerProblems({ ...worker, WORKER_WAKE_SECRET: 'short' })).toEqual(['WORKER_WAKE_SECRET']);
  });

  const deployed = {
    ...worker,
    ...centrifugo,
    APP_ENV: 'production',
    WORKER_WAKE_SECRET: 'a-wake-secret-of-at-least-32-characters',
  };

  it("refuses .env.example's Centrifugo key, or one shorter than 32 characters, outside local", () => {
    expect(workerProblems({ ...deployed, CENTRIFUGO_API_KEY: LOCAL_CENTRIFUGO_API_KEY })).toEqual([
      'CENTRIFUGO_API_KEY',
    ]);
    expect(workerProblems({ ...deployed, CENTRIFUGO_API_KEY: 'x'.repeat(31) })).toEqual(['CENTRIFUGO_API_KEY']);
    expect(workerProblems({ ...deployed, CENTRIFUGO_API_KEY: 'x'.repeat(32) })).toEqual([]);
    // Locally, the compose stack's key is the point.
    expect(
      workerProblems({
        ...worker,
        CENTRIFUGO_API_URL: 'http://localhost:9000',
        CENTRIFUGO_API_KEY: LOCAL_CENTRIFUGO_API_KEY,
      }),
    ).toEqual([]);
  });

  it('refuses plain http to Centrifugo unless the host is on the private network or this machine', () => {
    for (const url of [
      'https://centrifugo.example.com',
      'http://centrifugo.railway.internal:9000',
      'http://localhost:9000',
      'http://127.0.0.1:9000',
    ]) {
      expect(workerProblems({ ...deployed, CENTRIFUGO_API_URL: url }), url).toEqual([]);
    }
    for (const url of [
      'http://centrifugo.example.com',
      'http://railway.internal.example.com',
      'ftp://centrifugo.railway.internal',
    ]) {
      expect(workerProblems({ ...deployed, CENTRIFUGO_API_URL: url }), url).toEqual(['CENTRIFUGO_API_URL']);
      expect(workerProblems({ ...worker, CENTRIFUGO_API_URL: url, CENTRIFUGO_API_KEY: 'key' }), url).toEqual([
        'CENTRIFUGO_API_URL',
      ]);
    }
  });

  it("refuses .env.example's wake secret outside local", () => {
    const placeholder = 'local-only-worker-wake-secret-not-for-deployment';
    expect(workerProblems({ ...deployed, WORKER_WAKE_SECRET: placeholder })).toEqual(['WORKER_WAKE_SECRET']);
    expect(workerProblems({ ...worker, WORKER_WAKE_SECRET: placeholder })).toEqual([]);
  });
});
