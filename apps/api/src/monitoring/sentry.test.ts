// The api's Sentry wrapper (spec 0010): a no op until started (AC-166), the one
// scrub in every send hook (AC-165), and sending that never slows or changes an
// answer, even when Sentry hangs (AC-166).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { memoryTransport } from '../../test/sentry.ts';
import { APP_URL, createTestApp } from '../testing.ts';
import { MonitoringEnv, serviceFor } from './config.ts';
import {
  captureFault,
  flush,
  isSentryStarted,
  keepBreadcrumb,
  type SentryConfig,
  sentryOptions,
  setRequestScope,
  startSentry,
  withRequestScope,
} from './sentry.ts';

const run = promisify(execFile);
const INSTRUMENT = fileURLToPath(new URL('./instrument.ts', import.meta.url));
const EMAIL = 'ada.lovelace@example.com';
const CONFIG: SentryConfig = {
  dsn: 'https://public@o1.ingest.de.sentry.io/1',
  environment: 'production',
  release: 'abc1234',
  service: 'api',
};

type BeforeSend = NonNullable<ReturnType<typeof sentryOptions>['beforeSend']>;
type SentryErrorEvent = Parameters<BeforeSend>[0];
type SentryBreadcrumb = Parameters<typeof keepBreadcrumb>[0];

/** An error event with something personal in every place the SDK could put one. */
function personalEvent(): SentryErrorEvent {
  const event = {
    message: `Duplicate key for ${EMAIL}`,
    request: {
      url: 'https://brij-crm-phi.vercel.app/api/auth/callback/google?code=4/0Ab&state=xyz',
      query_string: 'code=4/0Ab&state=xyz',
      cookies: { 'better-auth.session_token': 'session-secret' },
      data: `{"email":"${EMAIL}"}`,
      headers: { cookie: 'session-secret', authorization: 'Bearer token-secret', 'x-request-id': 'req-1' },
    },
    user: { id: 'user-1', email: EMAIL, ip_address: '203.0.113.9' },
    extra: { detail: 'Key (email)=(someone@example.com) already exists.' },
    breadcrumbs: [{ category: 'http', data: { url: '/api/rpc/records/query?search=ada' } }],
  };
  return event as unknown as SentryErrorEvent;
}

/** Everything that must never reach Sentry, from `personalEvent`. */
const SECRETS = [
  EMAIL,
  'someone@example.com',
  'session-secret',
  'token-secret',
  '203.0.113.9',
  'code=4/0Ab',
  'search=ada',
];

describe('before Sentry starts (no DSN: local and tests)', () => {
  it('does nothing, and fails nothing', async () => {
    expect(isSentryStarted()).toBe(false);
    expect(() => {
      captureFault(new Error('nobody hears this'), { requestId: 'r' });
      setRequestScope({ userId: 'u', workspaceId: 'w' });
    }).not.toThrow();
    expect(withRequestScope('r', () => 42)).toBe(42);
    await expect(flush(10)).resolves.toBeUndefined();
  });
});

describe('instrument.ts', () => {
  const env = { PATH: process.env.PATH ?? '', APP_ENV: 'local' };

  it('starts nothing without SENTRY_DSN_SERVER, and says so', async () => {
    const { stdout } = await run(process.execPath, ['--import', INSTRUMENT, '-e', '0'], { env });
    expect(stdout).toContain('"message":"Monitoring off"');
  });

  it('refuses to boot on a DSN that is not https', async () => {
    const started = run(process.execPath, ['--import', INSTRUMENT, '-e', '0'], {
      env: { ...env, SENTRY_DSN_SERVER: 'http://public@o1.ingest.de.sentry.io/1' },
    });
    const refused: unknown = await started.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({ code: 1 });
    expect(String((refused as { stderr?: unknown }).stderr)).toContain('SENTRY_DSN_SERVER');
  });

  it('tags the service from SERVICE, else from the entry file', () => {
    const parsed = MonitoringEnv.parse({ APP_ENV: 'production' });
    expect(serviceFor(parsed, '/app/apps/api/src/server.ts')).toBe('api');
    expect(serviceFor(parsed, '/app/apps/api/src/worker.ts')).toBe('worker');
    expect(serviceFor(MonitoringEnv.parse({ APP_ENV: 'production', SERVICE: 'worker' }), undefined)).toBe('worker');
  });

  it('takes the release from Railway, and counts an empty DSN as unset', () => {
    const parsed = MonitoringEnv.parse({
      APP_ENV: 'preview',
      SENTRY_DSN_SERVER: '',
      RAILWAY_GIT_COMMIT_SHA: 'abc1234',
    });
    expect(parsed.SENTRY_DSN_SERVER).toBeUndefined();
    expect(parsed.RAILWAY_GIT_COMMIT_SHA).toBe('abc1234');
  });
});

describe('the send hooks (AC-165)', () => {
  const options = sentryOptions(CONFIG);

  it('collects nothing personal on its own: no user info, cookies, bodies, queries or local variables', () => {
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(options.includeLocalVariables).toBe(false);
  });

  it('runs scrub in beforeSend', async () => {
    const { beforeSend } = options;
    if (beforeSend === undefined) throw new Error('No beforeSend.');
    const sent = JSON.stringify(await beforeSend(personalEvent(), {}));
    for (const secret of SECRETS) expect(sent).not.toContain(secret);
    expect(sent).toContain('"x-request-id":"req-1"');
    expect(sent).toContain('"id":"user-1"');
  });

  it('drops console breadcrumbs and scrubs the rest in beforeBreadcrumb', () => {
    const crumb = (value: object) => value as SentryBreadcrumb;
    expect(keepBreadcrumb(crumb({ category: 'console', message: `logged ${EMAIL}` }))).toBeNull();
    expect(keepBreadcrumb(crumb({ category: 'http', data: { url: '/api/auth/verify?email=a@b.co' } }))).toEqual({
      category: 'http',
      data: { url: '/api/auth/verify' },
    });
  });
});

describe('once started', () => {
  it('sends an unexpected error with its request, user and workspace, and nothing personal', async () => {
    const transport = memoryTransport();
    startSentry({ ...CONFIG, deliver: transport.deliver });
    expect(isSentryStarted()).toBe(true);

    const fault = Object.assign(new Error(`insert failed for ${EMAIL}`), {
      detail: 'Key (email)=(someone@example.com) already exists.',
    });
    withRequestScope('req-42', () => {
      setRequestScope({ userId: 'user-7' });
      setRequestScope({ workspaceId: 'workspace-9' });
      captureFault(fault, { requestId: 'req-42', procedure: 'records.create' });
    });
    // Outside that request, nothing of it remains.
    captureFault(new Error('a fault in no request'), { task: 'database pool' });
    await flush(2000);

    // Events are prepared in parallel, so they may arrive in either order.
    const events = transport.events();
    expect(events).toHaveLength(2);
    const inRequest = events.find((event) => event.tags?.request_id !== undefined);
    const outside = events.find((event) => event.tags?.request_id === undefined);
    expect(inRequest).toMatchObject({
      environment: 'production',
      release: 'abc1234',
      user: { id: 'user-7' },
      tags: { service: 'api', request_id: 'req-42', procedure: 'records.create', workspace_id: 'workspace-9' },
    });
    expect(inRequest?.exception?.values?.[0]?.value).toBe('insert failed for [email]');
    expect(outside?.tags).toEqual({ service: 'api', task: 'database pool' });
    expect(outside?.user).toBeUndefined();
    const sent = transport.envelopes.join('\n');
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain('someone@example.com');
  });

  it('answers as fast and the same when Sentry hangs, and a flush gives up on time (AC-166)', async () => {
    const app = createTestApp();
    const crash = () =>
      app.fetch(
        new Request(`${APP_URL}/api/rpc/crash`, {
          method: 'POST',
          headers: { origin: APP_URL, 'content-type': 'application/json' },
          body: '{}',
        }),
      );
    const before = await crash();
    const expected = await before.json();

    startSentry({ ...CONFIG, deliver: () => new Promise(() => undefined) });
    const started = performance.now();
    const answer = await crash();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual(expected);

    const flushing = performance.now();
    await flush(200);
    expect(performance.now() - flushing).toBeLessThan(1500);
  });

  it('answers the same when Sentry refuses every envelope', async () => {
    startSentry({ ...CONFIG, deliver: () => Promise.reject(new Error('Sentry is down')) });
    const answer = await createTestApp().fetch(
      new Request(`${APP_URL}/api/rpc/crash`, {
        method: 'POST',
        headers: { origin: APP_URL, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(answer.status).toBe(500);
    await expect(flush(500)).resolves.toBeUndefined();
  });
});
