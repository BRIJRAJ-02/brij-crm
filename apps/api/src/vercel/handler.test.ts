// The api as a Vercel Function (spec 0045): it boots from its environment and
// answers liveness with Vercel's release, without the database; an invalid
// environment answers 503 and logs the variables at fault, never a value; the
// jobs endpoint refuses a missing or wrong secret, a request the middleware
// didn't vouch for, and any method but POST and (Vercel Cron's, with
// `CRON_SECRET` set) GET, before it touches the database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EDGE_HEADER } from '../edge.ts';
import { ApiEnv, FunctionEnv } from '../env.ts';
import { captureLogs, TEST_EDGE_SECRET } from '../testing.ts';
import {
  bearerOf,
  createFunctionApi,
  DRAIN_BUDGET_MS,
  JOBS_RUN_PATH,
  JOBS_SECRET_HEADER,
  scheduledTurn,
  SCHEDULED_MINIMUM_MS,
  secretMatches,
  type FunctionApi,
} from './handler.ts';

const NOWHERE = 'postgres://nobody:nothing@127.0.0.1:1/none';
const SHA = '5332cb46565e22105f3ebdc1e249337ba0ab4a7d';
const JOBS_SECRET = 'a-jobs-run-secret-of-at-least-32-characters';
const CRON_SECRET = 'a-vercel-cron-secret-of-at-least-32-characters';
const BETTER_AUTH_SECRET = 'a-preview-better-auth-secret-of-32-characters';

/** A preview deployment's variables on Vercel: every check outside local applies. */
const preview: Record<string, string> = {
  VERCEL: '1',
  VERCEL_GIT_COMMIT_SHA: SHA,
  APP_ENV: 'preview',
  NODE_ENV: 'production',
  DATABASE_URL: NOWHERE,
  IDENTITY_DATABASE_URL: NOWHERE,
  DATABASE_URL_DIRECT: NOWHERE,
  APP_URL: 'https://app.test',
  BETTER_AUTH_URL: 'https://app.test',
  BETTER_AUTH_SECRET,
  EDGE_SECRET: TEST_EDGE_SECRET,
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Timefix <sign-in@app.test>',
  WORKER_WAKE_SECRET: 'a-worker-wake-secret-of-at-least-32-characters',
  FORMS_IP_SALT: 'a-forms-ip-salt-of-at-least-32-characters',
  JOBS_RUN_SECRET: JOBS_SECRET,
};

let kept: Promise<unknown>[] = [];
let logs: ReturnType<typeof captureLogs>;
const platform = { keepAlive: (work: Promise<unknown>) => void kept.push(work) };

beforeEach(() => {
  kept = [];
  logs = captureLogs();
});
afterEach(() => {
  logs.restore();
});

function api(env: Record<string, string> = preview): FunctionApi {
  return createFunctionApi(env, platform);
}

function call(target: FunctionApi, path: string, init: RequestInit = {}): Promise<Response> {
  return target.fetch(new Request(`https://app.test${path}`, init));
}

const vouched = { [EDGE_HEADER]: TEST_EDGE_SECRET };

describe('the function entry', () => {
  it('boots from its environment and answers liveness with the Vercel release, without the database', async () => {
    const response = await call(api(), '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', release: SHA });
    expect(logs.lines().map((line) => line.message)).toContain('API on Vercel');
    // Monitoring's flush is handed to the platform after every request.
    expect(kept.length).toBeGreaterThan(0);
  });

  it('answers 503 for every other route while the database is out of reach', async () => {
    const response = await call(api(), '/api/rpc/system/status', { method: 'POST', headers: vouched });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe('API_UNAVAILABLE');
  });

  it('answers 503 on an invalid environment, and logs the variables at fault but never a value', async () => {
    const { DATABASE_URL: _dropped, ...rest } = preview;
    const response = await call(api({ ...rest, JOBS_RUN_SECRET: 'short' }), '/api/health');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'API_UNAVAILABLE',
      message: 'The API is not configured on this deployment.',
    });
    const refusal = logs.lines().find((line) => line.message === 'Refusing to start, the environment is invalid');
    expect(refusal?.problems).toMatch(/DATABASE_URL/);
    expect(refusal?.problems).toMatch(/JOBS_RUN_SECRET/);
    const written = JSON.stringify(logs.lines());
    for (const secret of [TEST_EDGE_SECRET, BETTER_AUTH_SECRET, preview.WORKER_WAKE_SECRET]) {
      expect(written).not.toContain(secret);
    }
  });
});

describe('the environment on Vercel', () => {
  it('needs no worker address on Vercel, and still does on every other host', () => {
    expect(ApiEnv.safeParse(preview).success).toBe(true);
    const { VERCEL: _vercel, ...elsewhere } = preview;
    const result = ApiEnv.safeParse(elsewhere);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['WORKER_INTERNAL_URL']);
  });

  it('requires the direct login and the jobs secret outside local, and refuses the local placeholder', () => {
    const issues = (input: Record<string, string>) =>
      FunctionEnv.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(issues({ APP_ENV: 'production' })).toEqual(['DATABASE_URL_DIRECT', 'JOBS_RUN_SECRET']);
    expect(issues({ ...preview, JOBS_RUN_SECRET: 'local-only-jobs-secret-0000000000000000' })).toEqual([
      'JOBS_RUN_SECRET',
    ]);
    expect(issues({ ...preview, JOBS_RUN_SECRET: 'a jobs secret with spaces in it, 32 chars' })).toEqual([
      'JOBS_RUN_SECRET',
    ]);
    expect(issues({ APP_ENV: 'local' })).toEqual([]);
  });

  it('takes CRON_SECRET as optional everywhere, with the jobs secret’s rules', () => {
    const issues = (input: Record<string, string>) =>
      FunctionEnv.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(issues(preview)).toEqual([]);
    expect(issues({ ...preview, CRON_SECRET })).toEqual([]);
    // Empty in a file counts as unset.
    expect(issues({ ...preview, CRON_SECRET: '' })).toEqual([]);
    expect(issues({ ...preview, CRON_SECRET: 'short' })).toEqual(['CRON_SECRET']);
    expect(issues({ ...preview, CRON_SECRET: 'a cron secret with spaces in it, 32 chars' })).toEqual(['CRON_SECRET']);
    expect(issues({ ...preview, CRON_SECRET: 'local-only-cron-secret-000000000000000000' })).toEqual(['CRON_SECRET']);
  });
});

describe('the jobs endpoint', () => {
  const post = (headers: Record<string, string>) => call(api(), JOBS_RUN_PATH, { method: 'POST', headers });

  it('refuses a request without the secret, or with a wrong one', async () => {
    for (const headers of [vouched, { ...vouched, [JOBS_SECRET_HEADER]: `${JOBS_SECRET}x` }]) {
      const response = await post(headers);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses a request the middleware did not vouch for, even with the right secret', async () => {
    const response = await post({ [JOBS_SECRET_HEADER]: JOBS_SECRET });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('EDGE_REQUIRED');
  });

  it('answers 404 to any method but POST, and where the jobs secret is unset', async () => {
    const get = await call(api(), JOBS_RUN_PATH, { headers: { ...vouched, [JOBS_SECRET_HEADER]: JOBS_SECRET } });
    expect(get.status).toBe(404);
    const put = await call(api({ ...preview, CRON_SECRET }), JOBS_RUN_PATH, {
      method: 'PUT',
      headers: { ...vouched, [JOBS_SECRET_HEADER]: JOBS_SECRET, authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(put.status).toBe(404);
    const { JOBS_RUN_SECRET: _secret, ...unset } = preview;
    const off = await call(api({ ...unset, APP_ENV: 'local', NODE_ENV: 'test' }), JOBS_RUN_PATH, {
      method: 'POST',
      headers: { [JOBS_SECRET_HEADER]: JOBS_SECRET },
    });
    expect(off.status).toBe(404);
  });

  it('takes the right secret through the edge on to the database, which is out of reach here', async () => {
    const response = await post({ ...vouched, [JOBS_SECRET_HEADER]: JOBS_SECRET });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'API_UNAVAILABLE',
      message: 'The API cannot reach its database right now.',
    });
  });

  it('compares the secret over digests, so a different length is simply wrong', () => {
    expect(secretMatches(JOBS_SECRET, JOBS_SECRET)).toBe(true);
    expect(secretMatches(JOBS_SECRET, 'short')).toBe(false);
    expect(secretMatches(JOBS_SECRET, null)).toBe(false);
  });
});

describe('Vercel Cron’s run of the jobs (GET, CRON_SECRET)', () => {
  const cron = (env: Record<string, string>, headers: Record<string, string>) =>
    call(api(env), JOBS_RUN_PATH, { headers });
  const withCron = { ...preview, CRON_SECRET };

  it('answers 404 where CRON_SECRET is unset, whatever the request carries', async () => {
    const response = await cron(preview, { ...vouched, authorization: `Bearer ${CRON_SECRET}` });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('refuses no bearer, a wrong one, another scheme, and the jobs secret in its place', async () => {
    for (const headers of [
      vouched,
      { ...vouched, authorization: `Bearer ${CRON_SECRET}x` },
      { ...vouched, authorization: `Basic ${CRON_SECRET}` },
      { ...vouched, authorization: CRON_SECRET },
      { ...vouched, authorization: `Bearer ${JOBS_SECRET}` },
      { ...vouched, [JOBS_SECRET_HEADER]: JOBS_SECRET },
    ]) {
      const response = await cron(withCron, headers);
      expect(response.status, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses a request the middleware did not vouch for, even with the right bearer', async () => {
    const response = await cron(withCron, { authorization: `Bearer ${CRON_SECRET}` });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('EDGE_REQUIRED');
  });

  it('takes the right bearer through the edge on to the database, and keeps POST on the jobs secret alone', async () => {
    const response = await cron(withCron, { ...vouched, authorization: `Bearer ${CRON_SECRET}` });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe('API_UNAVAILABLE');
    const posted = await call(api(withCron), JOBS_RUN_PATH, {
      method: 'POST',
      headers: { ...vouched, authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(posted.status).toBe(401);
    const written = JSON.stringify(logs.lines());
    expect(written).not.toContain(CRON_SECRET);
  });

  it('reads a bearer token only in the Bearer scheme, whose name is any case', () => {
    expect(bearerOf(`Bearer ${CRON_SECRET}`)).toBe(CRON_SECRET);
    expect(bearerOf(`bearer ${CRON_SECRET}`)).toBe(CRON_SECRET);
    expect(bearerOf(null)).toBeNull();
    expect(bearerOf('Bearer ')).toBeNull();
    expect(bearerOf(`Basic ${CRON_SECRET}`)).toBeNull();
    expect(bearerOf(`Bearer ${CRON_SECRET} extra`)).toBeNull();
  });
});

describe('the scheduled turn', () => {
  it('always runs its minimum, so the hourly digest and the daily cleanup cron lines start even in a quiet hour', () => {
    expect(scheduledTurn()).toEqual({ budgetMs: DRAIN_BUDGET_MS, minimumMs: SCHEDULED_MINIMUM_MS });
  });
});
