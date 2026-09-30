// The api entrypoint: every read and write the app makes.
import { createDatabase } from '@crm/db';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { ApiEnv, loadEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { onShutdown } from './shutdown.ts';

const env = loadEnv(ApiEnv);

const db = createDatabase({
  url: env.DATABASE_URL,
  applicationName: 'crm-api',
  onPoolError: (error) => log.error('Idle database client failed', errorFields(error)),
});
try {
  await db.assertAppRole();
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  await db.close();
  process.exit(1);
}

const server = serve({ fetch: createApp({ db, env }).fetch, port: env.PORT, hostname: '::' }, (info) =>
  log.info('API listening', { port: info.port, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await db.close();
});
