// The worker entrypoint, from the same image as the api. It runs the outbox
// relay (spec 0005) on its own direct Postgres connection, and later the
// background jobs (#8). Its one HTTP port answers Railway's health check and
// the api's poke, which wakes the relay when it is dormant (`realtime/wake.ts`).
import { createServer } from 'node:http';
import { createDatabase, createOutboxReader, openDirectConnection } from '@crm/db';
import { loadEnv, WorkerEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { createCentrifugoPublisher } from './realtime/centrifugo.ts';
import { createRelay } from './realtime/relay.ts';
import { onShutdown } from './shutdown.ts';
import { createWorkerListener } from './worker-http.ts';

const env = loadEnv(WorkerEnv);

const db = createDatabase({
  url: env.DATABASE_URL,
  applicationName: 'crm-worker',
  maxConnections: 5,
  onPoolError: (error) => log.error('Idle database client failed', errorFields(error)),
});

const openDirect = () => openDirectConnection({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-worker-direct' });

// Refuse to start on a role that can bypass row level security, or a direct URL that is really a pooler (a
// NOTIFY must arrive). The relay opens its own connections from here on, and reconnects when one drops.
try {
  await db.assertAppRole();
  const proof = await openDirect();
  await proof.end();
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  await db.close();
  process.exit(1);
}

const relay =
  env.centrifugo === undefined
    ? undefined
    : createRelay({
        connect: async () => createOutboxReader(await openDirect()),
        publishBatch: createCentrifugoPublisher(env.centrifugo).publishBatch,
        log,
      });
if (relay === undefined) {
  log.info('Relay off: CENTRIFUGO_API_URL and CENTRIFUGO_API_KEY are unset, so no change is published');
} else {
  relay.start();
}

const health = createServer(createWorkerListener({ wakeSecret: env.WORKER_WAKE_SECRET, onWake: () => relay?.wake() }));
health.listen(env.WORKER_PORT, '::', () =>
  log.info('Worker ready', { port: env.WORKER_PORT, environment: env.APP_ENV, relay: relay !== undefined }),
);

onShutdown(async () => {
  await relay?.stop();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await db.close();
});
