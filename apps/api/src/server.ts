// The api entrypoint: every read and write the app makes.
import { createDatabase, createIdentityStore } from '@crm/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { isEdgeGuardEnforced } from './edge.ts';
import { ApiEnv, loadEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { createMailer } from './mail/mailer.ts';
import { onShutdown } from './shutdown.ts';

const env = loadEnv(ApiEnv);

const onPoolError = (error: Error) => log.error('Idle database client failed', errorFields(error));
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
  await Promise.all([db.close(), identity.close()]);
  process.exit(1);
}

// Whether the edge guard is on, never the secret itself. Off in a deployed
// environment is the rollout window (spec 0005), so it warns until #57.
if (isEdgeGuardEnforced({ secret: env.EDGE_SECRET, environment: env.APP_ENV })) {
  log.info('Edge guard on', { edgeGuard: 'on' });
} else if (env.APP_ENV === 'local') {
  log.info('Edge guard off', { edgeGuard: 'off', reason: 'local' });
} else {
  log.warn('Edge guard off: the API answers callers that bypass the app', {
    edgeGuard: 'off',
    reason: 'EDGE_SECRET is unset',
  });
}

const mailer = createMailer(env);
const auth = createAuth({ env, identity, mailer });
// What sign in offers and where codes go, never a key or an address.
log.info('Sign in ready', {
  mail: mailer.transport,
  google: auth.providers.google,
  signup: env.SIGNUP_ALLOWLIST === undefined ? (env.APP_ENV === 'local' ? 'open' : 'closed') : 'allowlist',
});

const server = serve(
  { fetch: createApp({ services: { db, identity, auth }, env }).fetch, port: env.PORT, hostname: '::' },
  (info) => log.info('API listening', { port: info.port, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([db.close(), identity.close()]);
});
