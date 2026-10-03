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

const server = serve(
  { fetch: createApp({ services: { db, identity, auth }, env }).fetch, port: env.PORT, hostname: '::' },
  (info) => log.info('API listening', { port: info.port, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([db.close(), identity.close()]);
});
