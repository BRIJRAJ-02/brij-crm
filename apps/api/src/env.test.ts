// The api's sign in and mail variables (spec 0005): what each environment
// must set, and what an unset or empty one means.
import { describe, expect, it } from 'vitest';
import { ApiEnv, LOCAL_CENTRIFUGO_API_KEY, LOCAL_CENTRIFUGO_TOKEN_SECRET, wakesOnUse, WorkerEnv } from './env.ts';

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
  RECAPTCHA_SITE_KEY: '6LcSiteKeyForTestsOnly000000000000000000',
  RECAPTCHA_SECRET_KEY: '6LcSecretKeyForTestsOnly0000000000000000',
  FORMS_IP_SALT: 'a-forms-ip-salt-of-at-least-32-characters',
};

function problems(input: Record<string, unknown>): string[] {
  const result = ApiEnv.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('the forms environment (spec 0023)', () => {
  it('boots locally with no reCAPTCHA keys and no salt (every submission unchecked)', () => {
    expect(problems(local)).toEqual([]);
  });

  it('takes the reCAPTCHA keys together or not at all, never requires them, and requires the salt outside local', () => {
    expect(problems({ ...local, RECAPTCHA_SITE_KEY: production.RECAPTCHA_SITE_KEY })).toEqual(['RECAPTCHA_SECRET_KEY']);
    expect(problems(production)).toEqual([]);
    const { RECAPTCHA_SITE_KEY: _site, RECAPTCHA_SECRET_KEY: _secret, FORMS_IP_SALT: _salt, ...bare } = production;
    expect(problems(bare)).toEqual(['FORMS_IP_SALT']);
    expect(problems({ ...bare, APP_ENV: 'preview', FORMS_IP_SALT: production.FORMS_IP_SALT })).toEqual([]);
  });
});

describe('the sign in environment', () => {
  it('boots locally on Mailpit, with an open sign up and a local sender', () => {
    const env = ApiEnv.parse(local);
    expect(env.MAILPIT_URL).toBe('http://localhost:8025');
    expect(env.SIGNUP_ALLOWLIST).toBeUndefined();
    expect(env.MAIL_FROM).toBe('Timefix <sign-in@crm.localhost>');
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
    // A bare address goes out under the product's name.
    expect(ApiEnv.parse(production).MAIL_FROM).toBe('Timefix <onboarding@resend.dev>');
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

  it('takes a compose service name over plain http locally only (the load stack, spec 0011)', () => {
    expect(problems({ ...local, WORKER_INTERNAL_URL: 'http://worker:3101' })).toEqual([]);
    for (const APP_ENV of ['preview', 'production']) {
      expect(problems({ ...production, APP_ENV, WORKER_INTERNAL_URL: 'http://worker:3101' })).toEqual([
        'WORKER_INTERNAL_URL',
      ]);
    }
    // A dotted name is a DNS name, never a compose service: still refused over http, locally too.
    expect(problems({ ...local, WORKER_INTERNAL_URL: 'http://worker.example.com' })).toEqual(['WORKER_INTERNAL_URL']);
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

  it('runs the jobs locally and in previews, and not in production, unless JOBS_RUNNER says (spec 0008)', () => {
    const deployed = {
      ...worker,
      ...centrifugo,
      WORKER_WAKE_SECRET: 'a-wake-secret-of-at-least-32-characters-long',
    };
    expect(WorkerEnv.parse(worker).JOBS_RUNNER).toBe('on');
    expect(WorkerEnv.parse({ ...deployed, APP_ENV: 'preview' }).JOBS_RUNNER).toBe('on');
    expect(WorkerEnv.parse({ ...deployed, APP_ENV: 'production' }).JOBS_RUNNER).toBe('off');
    expect(WorkerEnv.parse({ ...deployed, APP_ENV: 'production', JOBS_RUNNER: 'on' }).JOBS_RUNNER).toBe('on');
    expect(WorkerEnv.parse({ ...worker, JOBS_RUNNER: 'off' }).JOBS_RUNNER).toBe('off');
    expect(WorkerEnv.parse({ ...worker, JOBS_RUNNER: '' }).JOBS_RUNNER).toBe('on');
    expect(workerProblems({ ...worker, JOBS_RUNNER: 'yes' })).toEqual(['JOBS_RUNNER']);
  });

  it('wakes the worker on use outside production unless WORKER_WAKE_ON_USE says (spec 0008)', () => {
    expect(wakesOnUse(ApiEnv.parse(local))).toBe(true);
    expect(wakesOnUse(ApiEnv.parse(production))).toBe(false);
    expect(wakesOnUse(ApiEnv.parse({ ...production, WORKER_WAKE_ON_USE: 'on' }))).toBe(true);
    expect(wakesOnUse(ApiEnv.parse({ ...local, WORKER_WAKE_ON_USE: 'off' }))).toBe(false);
    expect(ApiEnv.safeParse({ ...local, WORKER_WAKE_ON_USE: 'yes' }).success).toBe(false);
  });

  it('sleeps after 180 idle seconds unless WORKER_IDLE_SLEEP_SECONDS says, 0 never (spec 0008, milestone 3)', () => {
    expect(WorkerEnv.parse(worker).WORKER_IDLE_SLEEP_SECONDS).toBe(180);
    expect(WorkerEnv.parse({ ...worker, WORKER_IDLE_SLEEP_SECONDS: '' }).WORKER_IDLE_SLEEP_SECONDS).toBe(180);
    expect(WorkerEnv.parse({ ...worker, WORKER_IDLE_SLEEP_SECONDS: '0' }).WORKER_IDLE_SLEEP_SECONDS).toBe(0);
    expect(WorkerEnv.parse({ ...worker, WORKER_IDLE_SLEEP_SECONDS: '30' }).WORKER_IDLE_SLEEP_SECONDS).toBe(30);
    for (const value of ['-1', '1.5', 'soon', '86401']) {
      expect(workerProblems({ ...worker, WORKER_IDLE_SLEEP_SECONDS: value }), value).toEqual([
        'WORKER_IDLE_SLEEP_SECONDS',
      ]);
    }
  });

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

  it('takes plain http to a compose service name locally only (the load stack, spec 0011)', () => {
    const local = { ...worker, ...centrifugo, CENTRIFUGO_API_URL: 'http://centrifugo:9000' };
    expect(workerProblems(local)).toEqual([]);
    expect(workerProblems({ ...deployed, CENTRIFUGO_API_URL: 'http://centrifugo:9000' })).toEqual([
      'CENTRIFUGO_API_URL',
    ]);
    expect(workerProblems({ ...local, CENTRIFUGO_API_URL: 'http://centrifugo.example.com:9000' })).toEqual([
      'CENTRIFUGO_API_URL',
    ]);
  });

  it.each(['preview', 'production'])('refuses a compose service name, however written, in %s', (APP_ENV) => {
    for (const url of ['http://centrifugo:9000', 'http://CENTRIFUGO:9000', ' http://centrifugo:9000 ']) {
      expect(workerProblems({ ...deployed, APP_ENV, CENTRIFUGO_API_URL: url }), url).toEqual(['CENTRIFUGO_API_URL']);
    }
  });

  it('refuses what only looks like a service name, locally too', () => {
    for (const url of [
      'http://centrifugo.',
      'http://centrifugo@evil.com',
      'http://evil.com#@centrifugo',
      'http://10:9000',
      'http://0xa9fea9fe',
    ]) {
      expect(workerProblems({ ...worker, ...centrifugo, CENTRIFUGO_API_URL: url }), url).toEqual([
        'CENTRIFUGO_API_URL',
      ]);
    }
  });

  it('refuses APP_ENV=local with NODE_ENV=production, as the api does', () => {
    expect(workerProblems({ ...worker, NODE_ENV: 'production' })).toEqual(['APP_ENV']);
  });

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

describe('product analytics (spec 0010, milestone 3)', () => {
  it('is off unless a key is set, where an empty value counts as unset', () => {
    const env = ApiEnv.parse({ ...production, POSTHOG_KEY: '', POSTHOG_HOST: '' });
    expect(env.POSTHOG_KEY).toBeUndefined();
    expect(env.POSTHOG_HOST).toBeUndefined();
  });

  it('takes a project key and the EU ingest host', () => {
    const env = ApiEnv.parse({ ...production, POSTHOG_KEY: 'phc_abc123XYZ', POSTHOG_HOST: 'https://eu.i.posthog.com' });
    expect(env.POSTHOG_KEY).toBe('phc_abc123XYZ');
    expect(env.POSTHOG_HOST).toBe('https://eu.i.posthog.com');
  });

  it.each(['phx_personalkey', 'phs_secretkey', 'phc_', 'phc_has space', 'abc', 'phc_abc\n'])(
    'refuses %j as the key: only a project key (phc_) is sent with events',
    (key) => {
      expect(problems({ ...production, POSTHOG_KEY: key })).toEqual(['POSTHOG_KEY']);
    },
  );

  it.each([
    'http://eu.i.posthog.com',
    'https://us.i.posthog.com',
    'https://eu.i.posthog.com/',
    'https://eu-assets.i.posthog.com',
    'https://posthog.example.com',
  ])('refuses %s as the host: EU ingest over https only', (host) => {
    expect(problems({ ...production, POSTHOG_HOST: host })).toEqual(['POSTHOG_HOST']);
  });
});

describe("the load harness's timing header (spec 0011, AC-202)", () => {
  it('is off unless set, and may be on locally', () => {
    expect(ApiEnv.parse(local).LOAD_TIMING).toBeUndefined();
    expect(ApiEnv.parse({ ...local, LOAD_TIMING: '' }).LOAD_TIMING).toBeUndefined();
    expect(ApiEnv.parse({ ...local, LOAD_TIMING: 'on' }).LOAD_TIMING).toBe('on');
  });

  it('refuses LOAD_TIMING=on outside local, so the API will not boot with it there', () => {
    expect(problems({ ...production, LOAD_TIMING: 'on' })).toEqual(['LOAD_TIMING']);
    expect(problems({ ...production, APP_ENV: 'preview', LOAD_TIMING: 'on' })).toEqual(['LOAD_TIMING']);
    expect(problems({ ...production, LOAD_TIMING: 'off' })).toEqual([]);
  });

  it('takes only on or off', () => {
    expect(problems({ ...local, LOAD_TIMING: 'yes' })).toEqual(['LOAD_TIMING']);
  });
});

describe('calendar sync (spec 0024)', () => {
  const key = Buffer.alloc(32, 3).toString('base64');
  const on = {
    CALENDAR_SYNC: 'on',
    GOOGLE_CALENDAR_CLIENT_ID: 'client.apps.googleusercontent.com',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
    CALENDAR_TOKEN_KEY: key,
  };
  const worker = {
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://app:p@localhost:6432/crm',
    DATABASE_URL_DIRECT: 'postgres://app:p@localhost:5433/crm',
  };
  const workerProblems = (input: Record<string, unknown>) => {
    const result = WorkerEnv.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('is off unless switched on, asking nothing of the app then', () => {
    expect(ApiEnv.parse(local).calendar).toBeUndefined();
    expect(ApiEnv.parse({ ...local, CALENDAR_SYNC: 'off', CALENDAR_TOKEN_KEY: 'not a key' }).calendar).toBeUndefined();
    expect(WorkerEnv.parse(worker).calendar).toBeUndefined();
  });

  it('needs the client, its secret and a 32 byte key when on, and keeps them only decoded in `calendar`', () => {
    expect(problems({ ...local, CALENDAR_SYNC: 'on' }).sort()).toEqual([
      'CALENDAR_TOKEN_KEY',
      'GOOGLE_CALENDAR_CLIENT_ID',
      'GOOGLE_CALENDAR_CLIENT_SECRET',
    ]);
    expect(problems({ ...local, ...on, CALENDAR_TOKEN_KEY: Buffer.alloc(16, 1).toString('base64') })).toEqual([
      'CALENDAR_TOKEN_KEY',
    ]);
    const env = ApiEnv.parse({ ...local, ...on });
    expect(env.calendar).toMatchObject({ clientId: 'client.apps.googleusercontent.com', clientSecret: 'secret' });
    expect(env.calendar?.tokenKey).toHaveLength(32);
    expect(env).not.toHaveProperty('CALENDAR_TOKEN_KEY');
    expect(env).not.toHaveProperty('GOOGLE_CALENDAR_CLIENT_SECRET');
    expect(WorkerEnv.parse({ ...worker, ...on }).calendar?.tokenKey).toHaveLength(32);
    expect(workerProblems({ ...worker, CALENDAR_SYNC: 'on' })).toHaveLength(3);
  });

  it('runs locally on the poll alone, and needs an https webhook origin elsewhere', () => {
    expect(ApiEnv.parse({ ...local, ...on }).calendar?.webhookOrigin).toBeUndefined();
    expect(problems({ ...production, ...on })).toEqual(['CALENDAR_WEBHOOK_ORIGIN']);
    expect(problems({ ...production, ...on, CALENDAR_WEBHOOK_ORIGIN: 'http://api.app.test' })).toEqual([
      'CALENDAR_WEBHOOK_ORIGIN',
    ]);
    expect(problems({ ...production, ...on, CALENDAR_WEBHOOK_ORIGIN: 'https://api.app.test/hooks' })).toEqual([
      'CALENDAR_WEBHOOK_ORIGIN',
    ]);
    expect(
      ApiEnv.parse({ ...production, ...on, CALENDAR_WEBHOOK_ORIGIN: 'https://api.app.test' }).calendar?.webhookOrigin,
    ).toBe('https://api.app.test');
  });
});
