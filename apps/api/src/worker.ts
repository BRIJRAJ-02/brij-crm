// The worker entrypoint, from the same image as the api. It holds the direct
// Postgres connection that background jobs (#8) and the outbox relay (#7) run on.
import { createServer } from 'node:http';
import { createDatabase, openDirectConnection } from '@crm/db';
import { loadEnv, WorkerEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { onShutdown } from './shutdown.ts';

const env = loadEnv(WorkerEnv);

const db = createDatabase({
  url: env.DATABASE_URL,
  applicationName: 'crm-worker',
  maxConnections: 5,
  onPoolError: (error) => log.error('Idle database client failed', errorFields(error)),
});

let direct: Awaited<ReturnType<typeof openDirectConnection>>;
try {
  await db.assertAppRole();
  direct = await openDirectConnection({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-worker-direct' });
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  await db.close();
  process.exit(1);
}

// A LISTEN connection that drops loses notifications. Exit, and let Railway restart us.
direct.on('error', (error) => {
  log.error('Direct database connection failed', errorFields(error));
  process.exit(1);
});

const health = createServer((request, response) => {
  const ok = request.url === '/health';
  response.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify(ok ? { status: 'ok' } : { code: 'NOT_FOUND' }));
});
health.listen(env.WORKER_PORT, '::', () =>
  log.info('Worker ready', { port: env.WORKER_PORT, environment: env.APP_ENV }),
);

onShutdown(async () => {
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await direct.end();
  await db.close();
});
