// The api entrypoint: every read and write the app makes.
import { isInvitedEmail, twoFactorRequiredBy } from '@crm/core';
import { createDatabase, createIdentityStore } from '@crm/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { isEdgeGuardEnforced } from './edge.ts';
import { ApiEnv, loadEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { createMailer } from './mail/mailer.ts';
import { createAnalytics, POSTHOG_EU_HOST } from './monitoring/posthog.ts';
import { captureFault, flush, MONITORING_FLUSH_MS } from './monitoring/sentry.ts';
import { createSignedOutNotice, NO_SIGNED_OUT } from './realtime/signed-out.ts';
import { createRelayWake, NO_WAKE } from './realtime/wake.ts';
import { APP_RULES } from './rules.ts';
import { onShutdown } from './shutdown.ts';
import { createRequestTiming } from './timing.ts';

const env = loadEnv(ApiEnv);

const onPoolError = (error: Error) => {
  log.error('Idle database client failed', errorFields(error));
  captureFault(error, { task: 'database pool' });
};
// The load stack's timing header (spec 0011, AC-202): only with LOAD_TIMING=on, which ApiEnv allows only locally.
const timing = env.LOAD_TIMING === 'on' ? createRequestTiming() : undefined;
const timed = timing === undefined ? {} : { timing: timing.current };
const db = createDatabase({ url: env.DATABASE_URL, applicationName: 'crm-api', onPoolError, ...timed });
// Global identity on its own login (spec 0005): the only role that reads and writes schema `auth`.
const identity = createIdentityStore({
  url: env.IDENTITY_DATABASE_URL,
  applicationName: 'crm-api-identity',
  onPoolError,
  ...timed,
});
try {
  await db.assertAppRole();
  await identity.assertIdentityRole();
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  captureFault(error, { task: 'start' });
  await Promise.all([db.close(), identity.close(), flush(MONITORING_FLUSH_MS)]);
  process.exit(1);
}

// Whether the edge guard is on, never the secret itself. ApiEnv requires the secret outside local, so it is off
// only on a laptop.
const edgeGuard = isEdgeGuardEnforced({ environment: env.APP_ENV }) ? 'on' : 'off';
log.info(`Edge guard ${edgeGuard}`, { edgeGuard, ...(edgeGuard === 'off' ? { reason: 'local' } : {}) });

const mailer = createMailer(env);
// Product events (spec 0010, milestone 3): sent only where POSTHOG_KEY is set, else a no op.
const analytics = createAnalytics({
  key: env.POSTHOG_KEY,
  host: env.POSTHOG_HOST ?? POSTHOG_EU_HOST,
  environment: env.APP_ENV,
  log,
});
log.info(`Product analytics ${analytics.enabled ? 'on' : 'off'}`, { analytics: analytics.enabled ? 'on' : 'off' });
// A new address off the allowlist may sign up while an open email invitation names it (spec 0031, AC-807).
const auth = createAuth({
  env,
  identity,
  mailer,
  analytics,
  invited: (email) => isInvitedEmail({ db }, email),
  requiredBy: (userId) => twoFactorRequiredBy({ db, identity }, userId),
});
// What sign in offers and where codes go, never a key or an address.
log.info('Sign in ready', {
  mail: mailer.transport,
  google: auth.providers.google,
  signup:
    env.SIGNUP_ALLOWLIST === undefined
      ? env.APP_ENV === 'local'
        ? 'open'
        : 'closed'
      : env.SIGNUP_ALLOWLIST[0] === '*'
        ? 'open'
        : 'allowlist',
});

// The relay's wake up call (spec 0005). ApiEnv requires both variables outside local; a laptop without
// WORKER_INTERNAL_URL leaves the relay to its own timer and pokes nothing.
const wakeRelay =
  env.WORKER_INTERNAL_URL === undefined
    ? NO_WAKE
    : createRelayWake({ url: env.WORKER_INTERNAL_URL, secret: env.WORKER_WAKE_SECRET, log });
log.info(`Relay wake ${wakeRelay === NO_WAKE ? 'off' : 'on'}`);
// Signing a session out from another device cuts that person's live connections through the worker (spec 0033).
const signedOut =
  env.WORKER_INTERNAL_URL === undefined
    ? NO_SIGNED_OUT
    : createSignedOutNotice({ url: env.WORKER_INTERNAL_URL, secret: env.WORKER_WAKE_SECRET, log });
if (timing !== undefined) log.info('Load timing on: every /api/rpc answer carries Server-Timing');

const server = serve(
  {
    fetch: createApp({
      services: {
        db,
        identity,
        auth,
        wakeRelay,
        signedOut,
        analytics,
        mailer,
        rules: APP_RULES,
        ...(timing === undefined ? {} : { timing }),
      },
      env,
    }).fetch,
    port: env.PORT,
    hostname: '::',
  },
  (info) => log.info('API listening', { port: info.port, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([db.close(), identity.close()]);
  // What monitoring and analytics still hold goes out, both at once, within the shutdown window.
  await Promise.all([flush(MONITORING_FLUSH_MS), analytics.shutdown(MONITORING_FLUSH_MS)]);
});
