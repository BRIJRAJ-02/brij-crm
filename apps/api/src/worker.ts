// The worker entrypoint, from the same image as the api. It runs the outbox
// relay (spec 0005) and the background jobs' runners (spec 0008) on its own
// direct Postgres login (`crm_worker_user`), with the jobs' tenant work on the
// pooled app login. Its one HTTP port answers Railway's health check and the
// api's poke, which wakes the relay when it is dormant (`realtime/wake.ts`).
import { jobKinds } from '@crm/core';
import { audiences, runDailyCleanup, systemScope } from '@crm/core/system';
import {
  assertWorkerConnection,
  createDatabase,
  createOutboxReader,
  openDirectConnection,
  openQueueConnection,
} from '@crm/db';
import { backgroundHooks } from './hooks.ts';
import { startJobRunners } from './jobs/graphile.ts';
import { createJobRunner } from './jobs/runner.ts';
import { loadEnv, WorkerEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { captureFault, flush, heartbeat, metrics, MONITORING_FLUSH_MS, raiseIssue } from './monitoring/sentry.ts';
import { createLagSample, createStatsReporter, relaySource } from './monitoring/stats.ts';
import { createCentrifugoPublisher } from './realtime/centrifugo.ts';
import { createRelay } from './realtime/relay.ts';
import { onShutdown } from './shutdown.ts';
import { createWorkerServer } from './worker-http.ts';

const env = loadEnv(WorkerEnv);

const db = createDatabase({
  url: env.DATABASE_URL,
  applicationName: 'crm-worker',
  // Six job slices at once (two heavy, four light), and two spare for the relay's audiences and the claims.
  maxConnections: 8,
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
// NOTIFY must arrive). A direct login outside crm_worker (spec 0008: the group that alone reaches the queue), such
// as production's login before `pnpm db:worker-login`, still runs the relay as before, with the jobs off. The
// relay opens its own connections from here on.
let directInWorker = false;
try {
  await db.assertAppRole();
  const proof = await openDirect(true);
  try {
    directInWorker = (await assertWorkerConnection(proof, 'DATABASE_URL_DIRECT')).inWorker;
  } finally {
    await proof.end();
  }
} catch (error) {
  log.error('Refusing to start', errorFields(error));
  captureFault(error, { task: 'start' });
  await Promise.all([db.close(), flush(MONITORING_FLUSH_MS)]);
  process.exit(1);
}

// Whether the jobs' runners start, and why not (spec 0008): JOBS_RUNNER (off in production until milestone 3's
// sleep, so Graphile's LISTEN and poll never keep Neon awake), and a direct login in crm_worker.
const jobsOff =
  env.JOBS_RUNNER === 'off'
    ? 'JOBS_RUNNER is off'
    : directInWorker
      ? undefined
      : 'the direct login is not in crm_worker; run pnpm db:worker-login';
if (jobsOff !== undefined) log.warn('jobs.off', { reason: jobsOff });

// The relay logs a fault it can't recover from as an error; each one is reported too (its message only: the fields
// can name workspaces, which stay in the log).
const reportingLog = {
  ...log,
  error: (message: string, fields?: Record<string, unknown>) => {
    log.error(message, fields);
    captureFault(new Error(message), { task: 'relay' });
  },
};

// The relay's lag values between two stats ticks: every one up to 500 a minute, a uniform sample past that.
const lagSample = createLagSample();

const relay =
  env.centrifugo === undefined
    ? undefined
    : createRelay({
        connect: async () => createOutboxReader(await openDirect(false)),
        // Spec 0009's audiences, read on the pool with the relay's system scope; only while the relay is awake.
        audiences: (workspaceId) => audiences(systemScope(db, workspaceId)),
        publishBatch: createCentrifugoPublisher(env.centrifugo).publishBatch,
        log: reportingLog,
        // Only crm_worker may run crm_outbox_prune (spec 0007, milestone 3): on another login (where the jobs, and
        // so the daily cleanup, are off too) the outbox keeps every row until the login moves to crm_worker_user.
        prune: directInWorker,
        // Each published row's delay from commit to publish, from Postgres's clock at both ends (spec 0010,
        // AC-179), into the bounded sample the stats tick records, so a burst costs a turn nothing.
        lag: lagSample.add,
      });
if (relay === undefined) {
  log.info('Relay off: CENTRIFUGO_API_URL and CENTRIFUGO_API_KEY are unset, so no change is published');
} else {
  if (!directInWorker) {
    log.warn('relay.prune.off', { reason: 'the direct login is not in crm_worker; run pnpm db:worker-login' });
  }
  relay.start();
}

// The background jobs (spec 0008): the core runner does each slice on the pool, as the job's member (entered again
// at every slice) or the system; Graphile's two runners, on the queue pool, only wake it and order the slices.
// With the jobs off, jobs started meanwhile wait, stored and queued, for a worker that runs them.
const queue =
  jobsOff === undefined
    ? openQueueConnection({
        url: env.DATABASE_URL_DIRECT,
        applicationName: 'crm-worker-queue',
        max: 4,
        onError: (error) => {
          log.error('Idle queue client failed', errorFields(error));
          captureFault(error, { task: 'queue pool' });
        },
      })
    : undefined;
// The kinds, with the queue reader the daily cleanup's requeue phase asks which jobs still have a queue row.
const registry = jobKinds({ environment: env.APP_ENV, ...(queue === undefined ? {} : { queue }) });
const jobs =
  queue === undefined
    ? undefined
    : await startJobRunners({
        queue,
        runner: createJobRunner({
          db,
          registry,
          // A batch stored a change event: the relay publishes it, even if it had gone dormant.
          onStored: () => relay?.wake(),
          log,
        }),
        log,
        onFault: (error) => captureFault(error, { task: 'jobs' }),
        // The daily cleanup (milestone 3): the outbox, the dead queue rows, then one maintenance job a workspace.
        daily: (input) =>
          runDailyCleanup(
            {
              registry,
              systemScope: (workspaceId) => systemScope(db, workspaceId),
              hooks: backgroundHooks,
              sweep: queue,
              log,
              onStored: () => relay?.wake(),
            },
            input,
          ),
      });

const health = createWorkerServer({
  wakeSecret: env.WORKER_WAKE_SECRET,
  onWake: () => relay?.wake(),
  // From memory only: the jobs' runners are awake for as long as the process runs (sleep comes with milestone 3).
  health: () => ({
    state: 'awake',
    jobs: jobs === undefined ? 'off' : 'on',
    ...(relay === undefined ? { relay: 'off' } : { relay: { mode: relay.mode(), ...relay.stats() } }),
  }),
});
health.listen(env.WORKER_PORT, '::', () =>
  log.info('Worker ready', {
    port: env.WORKER_PORT,
    environment: env.APP_ENV,
    relay: relay !== undefined,
    jobs: jobs !== undefined,
  }),
);

// The stats tick (spec 0010, AC-179 to AC-182): once a minute, from memory only, it records whether the worker is
// awake, the relay's lag sample and, while awake, the relay's backlog; raises RELAY_LAGGING; and checks in to the heartbeat, awake or
// asleep. Until spec 0008's sleep gives the worker one lifecycle, it is awake while the jobs' runners run (they
// listen and poll for as long as the process lives) or while the relay is active, and asleep while the relay is
// dormant with the jobs off, as production runs today.
const stats = createStatsReporter({
  sources: relay === undefined ? [] : [relaySource(() => relay.stats())],
  metrics,
  lag: lagSample,
  heartbeat,
  raise: raiseIssue,
  isAwake: () => jobs !== undefined || relay?.mode() === 'active',
  log,
});
stats.start();

onShutdown(async () => {
  // The slices in hand finish their batch and hand their jobs back to the queue first.
  await jobs?.stop();
  await queue?.close();
  await relay?.stop();
  // After the relay, so the lags of its last publishes go out with the flush below.
  stats.stop();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await db.close();
  // What monitoring still holds goes out, within the shutdown window.
  await flush(MONITORING_FLUSH_MS);
});
