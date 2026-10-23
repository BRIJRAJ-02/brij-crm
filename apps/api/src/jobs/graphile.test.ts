// Graphile Worker in the loop (spec 0008, AC-102, AC-103, AC-111, AC-115,
// AC-121): the real runners on the worker login, against the test database. A
// test job runs start to finish in slices handed back through the queue and
// leaves no queue row behind; a graceful stop mid job hands it back, and new
// runners carry it on to the end with every item done once; a job that keeps
// failing ends failed after Graphile's backoff and leaves no row either; and a
// job started for later runs at its time, never before.
import {
  connectCalendar,
  createRunner,
  createWorkspace,
  decodeTokenKey,
  defineKind,
  getJob,
  jobKinds,
  listCalendarConnections,
  newId,
  NO_RULE_SOURCE,
  removeCalendarConnection,
  startTestJob,
  type Runner,
} from '@crm/core';
import { enterAsActor, POLL_INTERVAL_MS, syncConnection, systemScope, type DailyCleanupInput } from '@crm/core/system';
import { createFakeCalendarProvider, startJobForTest, testScope } from '@crm/core/testing';
import { createDatabase, openQueueConnection, type Database, type QueueConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import * as z from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { backgroundHooks } from '../hooks.ts';
import { CALENDAR_POLL_PRIORITY, DailyPayload, dailyDay, startJobRunners, type JobsLog } from './graphile.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');
let db: Database;
let queue: QueueConnection;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-graphile-tests', maxConnections: 8 });
  queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-graphile-tests-queue', max: 4 });
});
afterAll(async () => {
  await queue.close();
  await db.close();
});

/** A light kind whose batch always throws, tried twice: Graphile waits exp(1) seconds between. */
const alwaysFails = defineKind({
  kind: 'test.always_fails',
  lane: 'light',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({}),
  cancellable: true,
  maxAttempts: 2,
  batchSize: 10,
  sample: {},
  step: () => Promise.reject(new Error('This batch always fails.')),
});

const registry = jobKinds({ environment: 'local', extra: [alwaysFails] });
const quiet: JobsLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

function coreRunner(sliceMs: number): Runner {
  return createRunner({
    db,
    registry,
    enterAsActor: (input) => enterAsActor({ db, rules: NO_RULE_SOURCE }, input),
    systemScope: (workspaceId) => systemScope(db, workspaceId),
    hooks: backgroundHooks,
    log: quiet,
    sliceMs,
  });
}

async function owner() {
  const created = await createWorkspace(db, {
    name: 'Graphile',
    slug: `graphile-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  return testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
}

const queueRows = (jobId: string) =>
  testQuery<{ key: string | null }>(
    ownerUrl,
    `select key from graphile_worker._private_jobs where payload->>'jobId' = $1`,
    [jobId],
  );

describe('the job runners on Graphile Worker', () => {
  it('run a job start to finish in slices, leaving no queue row behind', async () => {
    const scope = await owner();
    const runners = await startJobRunners({ queue, runner: coreRunner(100), log: quiet, pollInterval: 200 });
    try {
      const job = await startTestJob(scope, registry, {
        id: newId(),
        items: 300,
        batchSize: 50,
        batchMillis: 30,
        refuseEvery: 100,
      });
      await expect
        .poll(async () => (await getJob(scope, registry, job.id)).status, { timeout: 20_000, interval: 100 })
        .toBe('succeeded');
      expect(await getJob(scope, registry, job.id)).toMatchObject({ done: 297, refused: 3 });
      await expect.poll(async () => (await queueRows(job.id)).length, { timeout: 5_000 }).toBe(0);
    } finally {
      await runners.stop();
    }
  });

  it('hand a job back on a graceful stop, and new runners carry it on to the end, every item once', async () => {
    const scope = await owner();
    const first = await startJobRunners({ queue, runner: coreRunner(20_000), log: quiet, pollInterval: 200 });
    const job = await startTestJob(scope, registry, { id: newId(), items: 200, batchSize: 10, batchMillis: 50 });
    await expect
      .poll(async () => (await getJob(scope, registry, job.id)).done, { timeout: 20_000, interval: 50 })
      .toBeGreaterThan(0);
    await first.stop();
    const stopped = await getJob(scope, registry, job.id);
    expect(stopped.status).toBe('running');
    expect(stopped.done).toBeLessThan(200);
    expect((await queueRows(job.id)).length).toBe(1);
    const second = await startJobRunners({ queue, runner: coreRunner(20_000), log: quiet, pollInterval: 200 });
    try {
      await expect
        .poll(async () => (await getJob(scope, registry, job.id)).status, { timeout: 20_000, interval: 100 })
        .toBe('succeeded');
      const [states] = await testQuery<{ done: number; pending: number }>(
        ownerUrl,
        `select count(*) filter (where state = 'done')::int as done, count(*) filter (where state = 'pending')::int as pending
         from job_items where job_id = $1`,
        [job.id],
      );
      expect(states).toEqual({ done: 200, pending: 0 });
      expect((await getJob(scope, registry, job.id)).done).toBe(200);
    } finally {
      await second.stop();
    }
  });

  it('end a job that keeps failing after Graphile’s backoff, recorded on the job and gone from the queue', async () => {
    const scope = await owner();
    const lines: unknown[] = [];
    const keep = (message: string, fields?: Record<string, unknown>) => lines.push({ message, ...fields });
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: { info: keep, warn: keep, error: keep },
      pollInterval: 200,
    });
    try {
      const { jobId } = await startJobForTest(scope, registry, {
        kind: 'test.always_fails',
        params: {},
        items: [newId(), newId()],
      });
      await expect
        .poll(async () => (await getJob(scope, registry, jobId)).status, { timeout: 20_000, interval: 100 })
        .toBe('failed');
      expect(await getJob(scope, registry, jobId)).toMatchObject({ error: { code: 'JOB_FAILED' }, done: 0 });
      await expect.poll(async () => (await queueRows(jobId)).length, { timeout: 5_000 }).toBe(0);
      // The thrown message (which could quote a value) reached neither the log nor the queue row.
      expect(JSON.stringify(lines)).toContain('A job slice failed');
      expect(JSON.stringify(lines)).not.toContain('always fails');
    } finally {
      await runners.stop();
    }
  });

  it('report a runner that stops on its own (its pool shut down), but not one stopped by us', async () => {
    const failures: unknown[] = [];
    const exitCode = process.exitCode;
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: quiet,
      pollInterval: 200,
      onFailed: (error) => failures.push(error),
    });
    try {
      // A breaking migration elsewhere: Graphile 0.18.0 shuts its pool down, and the runner's promise resolves.
      await queue.pool.query(`select pg_notify('worker:migrate', '{"breaking":true}')`);
      await expect.poll(() => failures.length, { timeout: 20_000, interval: 100 }).toBeGreaterThanOrEqual(1);
      expect(String(failures[0])).toContain('stopped on its own');
    } finally {
      await runners.stop();
      process.exitCode = exitCode;
    }
    // Our own stop is never a failure.
    const count = failures.length;
    const again = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: quiet,
      pollInterval: 200,
      onFailed: (error) => failures.push(error),
    });
    await again.stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(failures).toHaveLength(count);
  });

  it('run the daily cleanup once for a missed day, and queue a continuation for what its budget left', async () => {
    // The cron last ran three days ago (the worker was down or asleep): one day of fill runs it once, not three times.
    await testQuery(
      ownerUrl,
      `insert into graphile_worker._private_known_crontabs (identifier, known_since, last_execution)
       values ('maintenance_daily', now() - interval '10 days', now() - interval '3 days')
       on conflict (identifier) do update set last_execution = excluded.last_execution`,
    );
    const calls: DailyCleanupInput[] = [];
    const after = newId();
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: quiet,
      pollInterval: 200,
      daily: (input) => {
        calls.push(input);
        // The first call runs out of time; the continuation finishes.
        return Promise.resolve(
          calls.length === 1
            ? { pruned: 0, dead: 0, workspaces: 0, failed: 0, next: after }
            : { pruned: 0, dead: 0, workspaces: 1, failed: 0 },
        );
      },
    });
    try {
      await expect.poll(() => calls.length, { timeout: 20_000, interval: 100 }).toBe(2);
      // The last 03:00 UTC before now: the day the missed run was for.
      const due = new Date();
      due.setUTCHours(3, 0, 0, 0);
      if (due.getTime() > Date.now()) due.setUTCDate(due.getUTCDate() - 1);
      const day = due.toISOString().slice(0, 10);
      expect(calls).toEqual([{ day }, { day, after }]);
      // Nothing more, and nothing left on the queue for it.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(calls).toHaveLength(2);
      await expect
        .poll(
          async () =>
            (
              await testQuery(
                ownerUrl,
                `select 1 from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id
                 where t.identifier = 'crm_cron_daily'`,
              )
            ).length,
          { timeout: 5_000 },
        )
        .toBe(0);
    } finally {
      await runners.stop();
    }
  });

  it('read the day a daily payload is for: the continuation’s, the cron’s, or today', () => {
    const now = new Date('2026-10-15T08:00:00Z');
    expect(dailyDay({ day: '2026-10-14' }, now)).toBe('2026-10-14');
    expect(dailyDay({ _cron: { ts: '2026-10-13T03:00:00.000Z' } }, now)).toBe('2026-10-13');
    expect(dailyDay({}, now)).toBe('2026-10-15');
    expect(DailyPayload.safeParse({ day: 'tomorrow' }).success).toBe(false);
    expect(DailyPayload.safeParse({ after: 'not-an-id' }).success).toBe(false);
  });

  it('run a job started for later at its time, never before', async () => {
    const scope = await owner();
    const runners = await startJobRunners({ queue, runner: coreRunner(20_000), log: quiet, pollInterval: 200 });
    try {
      const runAt = new Date(Date.now() + 3_000);
      const { jobId } = await startJobForTest(scope, registry, {
        kind: 'dev.simulate',
        params: { batchMillis: 0 },
        items: [newId()],
        runAt,
      });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect((await getJob(scope, registry, jobId)).status).toBe('queued');
      await expect
        .poll(async () => (await getJob(scope, registry, jobId)).status, { timeout: 10_000, interval: 100 })
        .toBe('succeeded');
      const started = Date.parse((await getJob(scope, registry, jobId)).startedAt ?? '');
      expect(started).toBeGreaterThanOrEqual(runAt.getTime());
      // Within 5 seconds of its time while the worker is awake (AC-111).
      expect(started - runAt.getTime()).toBeLessThan(5_000);
    } finally {
      await runners.stop();
    }
  });
});

describe('calendar sync on the light runner (spec 0024)', () => {
  it('syncs a newly connected calendar, queues its next poll 15 minutes on, and nothing once it stops', async () => {
    const scope = await owner();
    const fake = createFakeCalendarProvider();
    const tokenKey = decodeTokenKey(Buffer.alloc(32, 4).toString('base64'));
    const exchanged = await fake.provider.exchangeCode('code:ada@acme.dev', 'https://app.test/callback');
    // Connecting queues the first sync through crm_enqueue_calendar_sync, in the connect's transaction.
    const connection = await connectCalendar(scope, { provider: 'google', exchanged, tokenKey });
    const syncRows = () =>
      testQuery<{ run_at: Date; key: string | null; locked: boolean; priority: number }>(
        ownerUrl,
        `select run_at, key, locked_at is not null as locked, priority from graphile_worker._private_jobs
         where payload->>'connectionId' = $1 order by id`,
        [connection.id],
      );
    // What a person asked for now runs at priority 0.
    expect(await syncRows()).toMatchObject([{ priority: 0 }]);
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: quiet,
      pollInterval: 200,
      calendar: (input) =>
        syncConnection(
          {
            providers: { google: fake.provider },
            tokenKey,
            systemScope: (workspaceId) => systemScope(db, workspaceId),
            hooks: backgroundHooks(),
            isFreeDomain: () => false,
          },
          input,
        ),
    });
    try {
      await expect
        .poll(async () => (await listCalendarConnections(scope))[0]?.status, { timeout: 15_000, interval: 100 })
        .toBe('connected');
      // The run handed its row back and queued the next, on the same key, a poll interval away.
      await expect
        .poll(async () => (await syncRows()).filter((row) => !row.locked), { timeout: 5_000, interval: 100 })
        .toHaveLength(1);
      const [next] = await syncRows();
      expect(next?.key).toBe(`crm-calendar:${scope.workspaceId}:${connection.id}`);
      expect((next?.run_at.getTime() ?? 0) - Date.now()).toBeGreaterThan(POLL_INTERVAL_MS - 60_000);
      // The poll waits behind notices, Sync now and connects (priority 0), however overdue it gets.
      expect(next?.priority).toBe(CALENDAR_POLL_PRIORITY);
      expect(fake.calls('listChanges')).toBe(1);
      // Disconnected: a run brought forward finds it gone and queues nothing more.
      await removeCalendarConnection(scope, { connectionId: connection.id });
      await testQuery(
        ownerUrl,
        `update graphile_worker._private_jobs set run_at = now() where payload->>'connectionId' = $1`,
        [connection.id],
      );
      await expect.poll(async () => (await syncRows()).length, { timeout: 10_000, interval: 100 }).toBe(0);
    } finally {
      await runners.stop();
    }
  });

  it('logs each push channel a run opened, with our ids and its expiry, never its token', async () => {
    const scope = await owner();
    const fake = createFakeCalendarProvider();
    const tokenKey = decodeTokenKey(Buffer.alloc(32, 4).toString('base64'));
    const exchanged = await fake.provider.exchangeCode('code:bo@acme.dev', 'https://app.test/callback');
    const connection = await connectCalendar(scope, { provider: 'google', exchanged, tokenKey });
    const lines: { message: string; level: string; fields: Record<string, unknown> }[] = [];
    const recorded: JobsLog = {
      info: (message, fields = {}) => void lines.push({ message, level: 'info', fields }),
      warn: (message, fields = {}) => void lines.push({ message, level: 'warn', fields }),
      error: (message, fields = {}) => void lines.push({ message, level: 'error', fields }),
    };
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: recorded,
      pollInterval: 200,
      calendar: (input) =>
        syncConnection(
          {
            providers: { google: fake.provider },
            tokenKey,
            systemScope: (workspaceId) => systemScope(db, workspaceId),
            hooks: backgroundHooks(),
            isFreeDomain: () => false,
            pushAddress: 'https://hooks.test/api/calendar/google/notify',
          },
          input,
        ),
    });
    try {
      await expect
        .poll(() => lines.filter((line) => line.message === 'calendar.channel').length, { timeout: 15_000 })
        .toBe(1);
    } finally {
      await runners.stop();
    }
    const [opened] = fake.watched();
    const [main] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text as id from calendar_calendars where connection_id = $1 and is_primary`,
      [connection.id],
    );
    expect(lines.find((line) => line.message === 'calendar.channel')).toEqual({
      message: 'calendar.channel',
      level: 'info',
      fields: {
        workspaceId: scope.workspaceId,
        connectionId: connection.id,
        calendarId: main?.id,
        outcome: 'opened',
        expiresAt: opened?.channel.expiresAt,
        renewed: false,
      },
    });
    const written = JSON.stringify(lines);
    expect(written).not.toContain(opened?.token.split('.')[2] ?? '-');
    expect(written).not.toContain(opened?.channel.id ?? '-');
  });

  it('logs the sync at warn naming a calendar it couldn’t read, with the provider’s code and status', async () => {
    const scope = await owner();
    const fake = createFakeCalendarProvider();
    const tokenKey = decodeTokenKey(Buffer.alloc(32, 4).toString('base64'));
    const exchanged = await fake.provider.exchangeCode('code:cy@acme.dev', 'https://app.test/callback');
    const connection = await connectCalendar(scope, { provider: 'google', exchanged, tokenKey });
    const [main] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text as id from calendar_calendars where connection_id = $1 and is_primary`,
      [connection.id],
    );
    // The first sync lists the calendars, and Google doesn't answer for the main one's changes this once.
    fake.failNext('listChanges', 'CALENDAR_UNAVAILABLE', 1, { status: 503, reason: 'backendError' });
    const lines: { message: string; level: string; fields: Record<string, unknown> }[] = [];
    const recorded: JobsLog = {
      info: (message, fields = {}) => void lines.push({ message, level: 'info', fields }),
      warn: (message, fields = {}) => void lines.push({ message, level: 'warn', fields }),
      error: (message, fields = {}) => void lines.push({ message, level: 'error', fields }),
    };
    const runners = await startJobRunners({
      queue,
      runner: coreRunner(20_000),
      log: recorded,
      pollInterval: 200,
      calendar: (input) =>
        syncConnection(
          {
            providers: { google: fake.provider },
            tokenKey,
            systemScope: (workspaceId) => systemScope(db, workspaceId),
            hooks: backgroundHooks(),
            isFreeDomain: () => false,
          },
          input,
        ),
    });
    try {
      await expect
        .poll(() => lines.filter((line) => line.message === 'calendar.sync').length, { timeout: 15_000 })
        .toBe(1);
    } finally {
      await runners.stop();
    }
    expect(lines.find((line) => line.message === 'calendar.sync')).toEqual({
      message: 'calendar.sync',
      level: 'warn',
      fields: {
        connectionId: connection.id,
        outcome: 'retry',
        code: 'CALENDAR_UNAVAILABLE',
        failedCalendars: [{ calendarId: main?.id, code: 'CALENDAR_UNAVAILABLE', status: 503, reason: 'backendError' }],
      },
    });
  });
});
