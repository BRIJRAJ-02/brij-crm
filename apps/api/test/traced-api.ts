// A real api process with tracing on, for `src/monitoring/tracing.test.ts`
// (spec 0010, AC-170). Sentry has to start before `pg` loads for database
// queries to become spans, as `instrument.ts` does in production, so this runs
// as its own Node process: it starts Sentry with a transport that prints each
// envelope (`ENVELOPE <json>` per line), then loads the app on the test
// database, serves it on a free port, signs in by code, calls a procedure, runs
// a parameterised query that fails (its value must never reach Sentry), asks
// for both health checks, flushes and exits. No Vitest here: it runs on Node.
//
// Env: TRACE_DATABASE_URL, TRACE_IDENTITY_URL (the test database's two logins),
// TRACE_EMAIL (who signs in), TRACE_ENVIRONMENT (`preview` traces everything).
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AppEnvironment } from '@crm/contracts';
import * as z from 'zod';
import { flush, nameRequest, startSentry } from '../src/monitoring/sentry.ts';

const Env = z.object({
  TRACE_DATABASE_URL: z.url(),
  TRACE_IDENTITY_URL: z.url(),
  TRACE_EMAIL: z.email(),
  TRACE_ENVIRONMENT: AppEnvironment,
});
const env = Env.parse(process.env);

startSentry({
  dsn: 'https://public@o1.ingest.de.sentry.io/1',
  environment: env.TRACE_ENVIRONMENT,
  release: 'trace-test',
  service: 'api',
  deliver: (envelope) => {
    process.stdout.write(`ENVELOPE ${JSON.stringify(envelope)}\n`);
    return Promise.resolve();
  },
});

// Only now, with Sentry watching, does anything load `pg`.
const { createDatabase, createIdentityStore } = await import('@crm/db');
const { sql } = await import('drizzle-orm');
const { serve } = await import('@hono/node-server');
const { createApp } = await import('../src/app.ts');
const { createAuth } = await import('../src/auth/auth.ts');
const { NO_WAKE } = await import('../src/realtime/wake.ts');

const APP_URL = 'https://app.test';
const apiEnv = {
  APP_ENV: 'local',
  NODE_ENV: 'test',
  DATABASE_URL: env.TRACE_DATABASE_URL,
  IDENTITY_DATABASE_URL: env.TRACE_IDENTITY_URL,
  PORT: 0,
  APP_URL,
  BETTER_AUTH_SECRET: 'local-only-test-secret-that-is-long-enough',
  BETTER_AUTH_URL: APP_URL,
  MAIL_FROM: 'CRM <sign-in@crm.localhost>',
  MAILPIT_URL: 'http://127.0.0.1:1',
} as const;

const codes: string[] = [];
const db = createDatabase({ url: apiEnv.DATABASE_URL, applicationName: 'crm-api-trace-test' });
const identity = createIdentityStore({ url: apiEnv.IDENTITY_DATABASE_URL, applicationName: 'crm-api-trace-test' });
const mailer = {
  transport: 'mailpit' as const,
  send: (message: { text: string }) => {
    const code = /\b(\d{6})\b/.exec(message.text)?.[1];
    if (code !== undefined) codes.push(code);
    return Promise.resolve();
  },
};
const auth = createAuth({ env: apiEnv, identity, mailer });
const app = createApp({ services: { db, identity, auth, wakeRelay: NO_WAKE }, env: apiEnv });

/** The value the failing query is bound with: Postgres quotes it in its error, which must stay here. */
const FAILING_VALUE = 'Ada Lovelace';
const FAILING_PATH = '/api/rpc/trace/failingQuery';

// One extra address beside the app: a traced request whose query fails with a bound value in Postgres's message.
const server = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: async (request) => {
    if (new URL(request.url).pathname !== FAILING_PATH) return app.fetch(request);
    nameRequest('rpc trace.failingQuery');
    const failed = await db
      .withWorkspace(randomUUID(), (tx) => tx.execute(sql`select ${FAILING_VALUE}::int`))
      .then(
        () => false,
        () => true,
      );
    return new Response(failed ? 'failed' : 'ran', { status: failed ? 500 : 200 });
  },
});
await new Promise((resolve) => server.once('listening', resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${String(port)}/api`;
// What a browser sends through Vercel's middleware, with a user agent and an address that must not reach Sentry.
const headers = {
  origin: APP_URL,
  'x-crm-edge': 'the-edge-header-is-only-checked-for-presence-by-the-sampler',
  'content-type': 'application/json',
  'user-agent': 'TraceTestBrowser/1.0',
  'x-forwarded-for': '203.0.113.77',
};
const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });

try {
  const sent = await post('/auth/email-otp/send-verification-otp', { email: env.TRACE_EMAIL, type: 'sign-in' });
  if (sent.status !== 200) throw new Error(`Sending a code answered ${String(sent.status)}.`);
  const signedIn = await post('/auth/sign-in/email-otp', { email: env.TRACE_EMAIL, otp: codes.at(-1) });
  if (signedIn.status !== 200) throw new Error(`Signing in answered ${String(signedIn.status)}.`);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0] ?? '')
    .join('; ');
  const me = await post('/rpc/me/get?search=ada', { json: {} }, { cookie });
  if (me.status !== 200) throw new Error(`me.get answered ${String(me.status)}.`);
  const failing = await post('/rpc/trace/failingQuery', { json: {} });
  if (failing.status !== 500) throw new Error(`The failing query answered ${String(failing.status)}.`);
  await fetch(`${base}/health`, { headers });
  await fetch(`${base}/health/ready`, { headers });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await flush(5000);
  await Promise.all([db.close(), identity.close()]);
}
