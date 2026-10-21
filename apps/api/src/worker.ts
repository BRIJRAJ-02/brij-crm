// The worker entrypoint, from the same image as the api. It runs the outbox
// relay (spec 0005) and the background jobs' runners (spec 0008) on its own
// direct Postgres login (`crm_worker_user`), with the jobs' tenant work on the
// pooled app login. Its one HTTP port answers Railway's health check and the
// api's poke, which wakes the relay when it is dormant (`realtime/wake.ts`).
// With the jobs on, the runners and the relay share one lifecycle (spec 0008,
// milestone 3, `jobs/lifecycle.ts`): awake while there is work, asleep with no
// connection at all once idle for `WORKER_IDLE_SLEEP_SECONDS`, so Neon's
// compute can suspend; the poke and a timer for scheduled work wake it.
import { workspaceChannel } from '@crm/contracts';
import { jobKinds, type QueueRows } from '@crm/core';
import {
  audiences,
  meetingFacts,
  removedUserIds,
  runDailyCleanup,
  syncConnection,
  systemScope,
  taskFacts,
  viewFacts,
} from '@crm/core/system';
import {
  assertWorkerConnection,
  createDatabase,
  createOutboxReader,
  openDirectConnection,
  openQueueConnection,
  type QueueConnection,
} from '@crm/db';
import { bookingLinkKey } from './booking-link.ts';
import { backgroundHooks } from './hooks.ts';
import { runBookingMail } from './jobs/booking-mail.ts';
import { createMailer } from './mail/mailer.ts';
import { parseSender } from './mail/mailpit.ts';
import { createFreeDomains } from './calendar/free-domains.ts';
import { createGoogleCalendar } from './calendar/google.ts';
import { GOOGLE_NOTIFY_PATH } from './calendar/services.ts';
import { runnerTasks, startJobRunners } from './jobs/graphile.ts';
import { createLifecycle, type AwakeWorker, type Lifecycle } from './jobs/lifecycle.ts';
import { createJobRunner } from './jobs/runner.ts';
import { APP_RULES } from './rules.ts';
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

// With the jobs on, the worker's lifecycle (spec 0008, milestone 3) owns one idle clock for the runners and the
// relay: the relay never goes dormant on its own, and sleeps and wakes with the rest. With them off (production
// until the owner turns them on), the relay keeps its own 3 minute rule, exactly as before.
const jobsOn = jobsOff === undefined;
let lifecycle: Lifecycle | undefined;

// Centrifugo's server API: the relay publishes through it and cuts removed people off (spec 0031, AC-817).
const centrifugo = env.centrifugo === undefined ? undefined : createCentrifugoPublisher(env.centrifugo);
const relay =
  centrifugo === undefined
    ? undefined
    : createRelay({
        connect: async () => createOutboxReader(await openDirect(false)),
        // Spec 0009's audiences, read on the pool with the relay's system scope; only while the relay is awake.
        audiences: (workspaceId) => audiences(systemScope(db, workspaceId)),
        // Spec 0009's facts, one read a batch for each kind a row needs: each named view's visibility and creator
        // (spec 0020), each tasks row's tasks (spec 0019), and each meetings row's meetings (spec 0024).
        facts: async (workspaceId, rows) => {
          const viewIds = rows.flatMap((row) => (row.kind === 'views' ? row.itemIds : []));
          const taskIds = rows.flatMap((row) => (row.kind === 'tasks' ? row.itemIds : []));
          const meetingIds = rows.flatMap((row) => (row.kind === 'meetings' ? row.itemIds : []));
          const scope = systemScope(db, workspaceId);
          return {
            ...(viewIds.length === 0 ? {} : { views: await viewFacts(scope, viewIds) }),
            ...(taskIds.length === 0 ? {} : { tasks: await taskFacts(scope, taskIds) }),
            ...(meetingIds.length === 0 ? {} : { meetings: await meetingFacts(scope, meetingIds) }),
          };
        },
        publishBatch: centrifugo.publishBatch,
        // Spec 0031, AC-817: a removed person's open tabs stop hearing the workspace once the `access` row went out.
        cutOff: async (workspaceId, memberIds) => {
          const userIds = await removedUserIds(systemScope(db, workspaceId), memberIds);
          await centrifugo.unsubscribe(workspaceChannel(workspaceId), userIds);
        },
        log: reportingLog,
        // Only crm_worker may run crm_outbox_prune (spec 0007, milestone 3): on another login (where the jobs, and
        // so the daily cleanup, are off too) the outbox keeps every row until the login moves to crm_worker_user.
        prune: directInWorker,
        // Each published row's delay from commit to publish, from Postgres's clock at both ends (spec 0010,
        // AC-179), into the bounded sample the stats tick records, so a burst costs a turn nothing.
        lag: lagSample.add,
        selfDormant: !jobsOn,
        onWork: () => lifecycle?.touch(),
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
// The queue pool lives only while the worker is awake; the daily cleanup's requeue phase reads it through this.
let queue: QueueConnection | undefined;
const queueRows: QueueRows = {
  rows: (workspaceId, jobIds) => {
    if (queue === undefined) return Promise.reject(new Error('The worker is not awake, so the queue is closed.'));
    return queue.rows(workspaceId, jobIds);
  },
};
const registry = jobKinds({ environment: env.APP_ENV, ...(jobsOn ? { queue: queueRows } : {}) });
const runner = createJobRunner({
  db,
  registry,
  // A member's job runs under the same rules as their requests (rules.ts).
  rules: APP_RULES,
  // A batch stored a change event: the relay publishes it, even if it had gone dormant.
  onStored: () => relay?.wake(),
  log,
});

// Calendar sync (spec 0024), when CALENDAR_SYNC=on: each connection's sync runs on the light runner as the system,
// calling Google outside every transaction; a sync that stored events wakes the relay. Off, its queued rows wait.
const calendarSync =
  env.calendar === undefined
    ? undefined
    : (() => {
        const settings = env.calendar;
        const deps = {
          providers: {
            google: createGoogleCalendar({ clientId: settings.clientId, clientSecret: settings.clientSecret }),
          },
          tokenKey: settings.tokenKey,
          systemScope: (workspaceId: string) => systemScope(db, workspaceId),
          hooks: backgroundHooks(),
          isFreeDomain: createFreeDomains(),
          // Push (spec 0024, milestone 2): channels open only where Google can reach us; locally the poll alone runs.
          ...(settings.webhookOrigin === undefined
            ? {}
            : { pushAddress: new URL(GOOGLE_NOTIFY_PATH, settings.webhookOrigin).toString() }),
        };
        return async (input: { readonly workspaceId: string; readonly connectionId: string }) => {
          const outcome = await syncConnection(deps, input);
          if (outcome.kind === 'synced') relay?.wake();
          return outcome;
        };
      })();
if (env.calendar === undefined) log.info('calendar.off', { reason: 'CALENDAR_SYNC is not on' });

// Booking emails (spec 0025, milestone 2): sent through the api's own transport (Resend, or Mailpit locally) with links
// to the app, each guest page link derived with the key the api mints tokens with. Without APP_URL or a transport,
// each queued email is logged and dropped.
const bookingMailer =
  env.APP_URL === undefined || (env.RESEND_API_KEY === undefined && env.MAILPIT_URL === undefined)
    ? undefined
    : createMailer({ RESEND_API_KEY: env.RESEND_API_KEY, MAIL_FROM: env.MAIL_FROM, MAILPIT_URL: env.MAILPIT_URL });
if (bookingMailer === undefined) log.info('booking.mail.off', { reason: 'APP_URL or a mail transport is not set' });
const bookingLinks =
  env.APP_URL === undefined
    ? undefined
    : {
        appOrigin: new URL(env.APP_URL).origin,
        linkKey: bookingLinkKey(env),
        organizerEmail: parseSender(env.MAIL_FROM).email,
      };
const bookingMail = (payload: unknown) =>
  runBookingMail(
    {
      systemScope: (workspaceId) => systemScope(db, workspaceId),
      mailer: bookingMailer,
      links: bookingLinks,
      log,
    },
    payload,
  );

/** Opens the queue pool and starts the runners: what waking means. The NOTIFY check proves the direct host first. */
async function openWorker(hooks: {
  readonly onActivity: () => void;
  readonly onFailed: (error: unknown) => void;
}): Promise<AwakeWorker> {
  const proof = await openDirect(true);
  await proof.end();
  const opened = openQueueConnection({
    url: env.DATABASE_URL_DIRECT,
    applicationName: 'crm-worker-queue',
    max: 4,
    onError: (error) => {
      log.error('Idle queue client failed', errorFields(error));
      captureFault(error, { task: 'queue pool' });
    },
  });
  try {
    const runners = await startJobRunners({
      queue: opened,
      runner,
      log,
      onFault: (error) => captureFault(error, { task: 'jobs' }),
      onActivity: hooks.onActivity,
      onFailed: hooks.onFailed,
      ...(calendarSync === undefined ? {} : { calendar: calendarSync }),
      bookingMail,
      // The daily cleanup (milestone 3): the outbox, the dead queue rows, then one maintenance job a workspace.
      daily: (input) =>
        runDailyCleanup(
          {
            registry,
            systemScope: (workspaceId) => systemScope(db, workspaceId),
            hooks: backgroundHooks,
            sweep: opened,
            log,
            onStored: () => relay?.wake(),
          },
          input,
        ),
    });
    queue = opened;
    return {
      busy: () => runners.busy(),
      // Rows the relay can't publish (Centrifugo down for a whole quiet spell) don't keep the worker awake; any
      // other workspace's waiting rows do. Only the tasks these runners run count.
      check: () =>
        opened.sleepCheck({
          outbox: relay !== undefined,
          stuck: relay?.stuckWorkspaces() ?? [],
          tasks: runnerTasks(calendarSync !== undefined),
        }),
      close: async () => {
        // The slices in hand finish their batch and hand their jobs back first.
        await runners.stop();
        if (queue === opened) queue = undefined;
        await opened.close();
      },
    };
  } catch (error) {
    await opened.close().catch(() => undefined);
    throw error;
  }
}

if (jobsOn) {
  lifecycle = createLifecycle({
    open: openWorker,
    ...(relay === undefined ? {} : { relay }),
    idleSleepMs: env.WORKER_IDLE_SLEEP_SECONDS * 1000,
    log,
  });
  void lifecycle.start();
  log.info('worker.sleep', {
    idleSeconds: env.WORKER_IDLE_SLEEP_SECONDS,
    ...(env.WORKER_IDLE_SLEEP_SECONDS === 0 ? { never: true } : {}),
  });
}

const health = createWorkerServer({
  wakeSecret: env.WORKER_WAKE_SECRET,
  // A wake call wakes the whole worker (runners and relay) when it sleeps, restarts its idle clock when awake, and
  // pokes the relay to drain what the write that sent it stored.
  onWake: () => {
    lifecycle?.wake();
    relay?.wake();
  },
  // From memory only, never a query: the lifecycle's state with the jobs on; with them off, as before.
  health: () => ({
    state: lifecycle?.state() ?? 'awake',
    jobs: jobsOn ? 'on' : 'off',
    ...(relay === undefined ? { relay: 'off' } : { relay: { mode: relay.mode(), ...relay.stats() } }),
  }),
});
health.listen(env.WORKER_PORT, '::', () =>
  log.info('Worker ready', {
    port: env.WORKER_PORT,
    environment: env.APP_ENV,
    relay: relay !== undefined,
    jobs: jobsOn,
  }),
);

// The stats tick (spec 0010, AC-179 to AC-182): once a minute, from memory only, it records whether the worker is
// awake, the relay's lag sample and, while awake, the relay's backlog; raises RELAY_LAGGING; and checks in to the
// heartbeat, awake or asleep. With the jobs on, awake is the lifecycle's state (spec 0008's one idle clock); with
// them off, as production runs until the owner turns them on, awake while the relay is active.
const stats = createStatsReporter({
  sources: relay === undefined ? [] : [relaySource(() => relay.stats())],
  metrics,
  lag: lagSample,
  heartbeat,
  raise: raiseIssue,
  isAwake: () => (lifecycle === undefined ? relay?.mode() === 'active' : lifecycle.state() === 'awake'),
  log,
});
stats.start();

onShutdown(async () => {
  // The slices in hand finish their batch and hand their jobs back to the queue first.
  await lifecycle?.stop();
  await relay?.stop();
  // After the relay, so the lags of its last publishes go out with the flush below.
  stats.stop();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await db.close();
  // What monitoring still holds goes out, within the shutdown window.
  await flush(MONITORING_FLUSH_MS);
});
