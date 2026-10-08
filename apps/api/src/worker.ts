// The worker entrypoint, from the same image as the api. It runs the outbox
// relay (spec 0005) on its own direct Postgres connection, and later the
// background jobs (#8). Its one HTTP port answers Railway's health check and
// the api's poke, which wakes the relay when it is dormant (`realtime/wake.ts`).
import { assertAppConnection, createDatabase, createOutboxReader, openDirectConnection } from '@crm/db';
import { loadEnv, WorkerEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { captureFault, flush, MONITORING_FLUSH_MS } from './monitoring/sentry.ts';
import { createCentrifugoPublisher } from './realtime/centrifugo.ts';
import { createRelay } from './realtime/relay.ts';
import { onShutdown } from './shutdown.ts';
import { createWorkerServer } from './worker-http.ts';

const env = loadEnv(WorkerEnv);

const db = createDatabase({
  url: env.DATABASE_URL,
  applicationName: 'crm-worker',
  maxConnections: 5,
  onPoolError: (error) => {
    log.error('Idle database client failed', errorFields(error));
    captureFault(error, { task: 'database pool' });
  },
});

// The boot proof checks that a NOTIFY arrives on DATABASE_URL_DIRECT (no pooler); the relay's own connections,
// opened each time it wakes, skip that second connection and NOTIFY.
const openDirect = (proveListen: boolean) =>
  openDirectConnection({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-worker-direct', proveListen });

// Refuse to start on a role that can bypass row level security, on either URL (the direct one is the relay's,
// and reads and marks rows under row level security like the pool), or a direct URL that is really a pooler (a
// NOTIFY must arrive). The relay opens its own connections from here on.
try {
  await db.assertAppRole();
  const proof = await openDirect(true);
  try {
    await assertAppConnection(proof, 'DATABASE_URL_DIRECT');
  } finally {
    await proof.end();
  }
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  captureFault(error, { task: 'start' });
  await Promise.all([db.close(), flush(MONITORING_FLUSH_MS)]);
  process.exit(1);
}

// The relay logs a fault it can't recover from as an error; each one is reported too (its message only: the fields
// can name workspaces, which stay in the log).
const reportingLog = {
  ...log,
  error: (message: string, fields?: Record<string, unknown>) => {
    log.error(message, fields);
    captureFault(new Error(message), { task: 'relay' });
  },
};

const relay =
  env.centrifugo === undefined
    ? undefined
    : createRelay({
        connect: async () => createOutboxReader(await openDirect(false)),
        publishBatch: createCentrifugoPublisher(env.centrifugo).publishBatch,
        log: reportingLog,
      });
if (relay === undefined) {
  log.info('Relay off: CENTRIFUGO_API_URL and CENTRIFUGO_API_KEY are unset, so no change is published');
} else {
  relay.start();
}

const health = createWorkerServer({
  wakeSecret: env.WORKER_WAKE_SECRET,
  onWake: () => relay?.wake(),
  health: () => (relay === undefined ? { relay: 'off' } : { relay: { mode: relay.mode(), ...relay.stats() } }),
});
health.listen(env.WORKER_PORT, '::', () =>
  log.info('Worker ready', { port: env.WORKER_PORT, environment: env.APP_ENV, relay: relay !== undefined }),
);

onShutdown(async () => {
  await relay?.stop();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await db.close();
  // What monitoring still holds goes out, within the shutdown window.
  await flush(MONITORING_FLUSH_MS);
});
