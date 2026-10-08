// The api entrypoint: every read and write the app makes.
import { createDatabase, createIdentityStore } from '@crm/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { isEdgeGuardEnforced } from './edge.ts';
import { ApiEnv, loadEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { createMailer } from './mail/mailer.ts';
import { captureFault, flush, MONITORING_FLUSH_MS } from './monitoring/sentry.ts';
import { createRelayWake, NO_WAKE } from './realtime/wake.ts';
import { onShutdown } from './shutdown.ts';

const env = loadEnv(ApiEnv);

const onPoolError = (error: Error) => {
  log.error('Idle database client failed', errorFields(error));
  captureFault(error, { task: 'database pool' });
};
const db = createDatabase({ url: env.DATABASE_URL, applicationName: 'crm-api', onPoolError });
// Global identity on its own login (spec 0005): the only role that reads and writes schema `auth`.
const identity = createIdentityStore({
  url: env.IDENTITY_DATABASE_URL,
  applicationName: 'crm-api-identity',
  onPoolError,
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
const auth = createAuth({ env, identity, mailer });
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

const server = serve(
  { fetch: createApp({ services: { db, identity, auth, wakeRelay }, env }).fetch, port: env.PORT, hostname: '::' },
  (info) => log.info('API listening', { port: info.port, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([db.close(), identity.close()]);
  // What monitoring still holds goes out, within the shutdown window.
  await flush(MONITORING_FLUSH_MS);
});
