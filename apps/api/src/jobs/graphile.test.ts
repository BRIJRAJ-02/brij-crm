// Graphile Worker in the loop (spec 0008, AC-102, AC-103, AC-111, AC-115,
// AC-121): the real runners on the worker login, against the test database. A
// test job runs start to finish in slices handed back through the queue and
// leaves no queue row behind; a graceful stop mid job hands it back, and new
// runners carry it on to the end with every item done once; a job that keeps
// failing ends failed after Graphile's backoff and leaves no row either; and a
// job started for later runs at its time, never before.
import {
  createRunner,
  createWorkspace,
  defineKind,
  getJob,
  jobKinds,
  newId,
  startTestJob,
  type Runner,
} from '@crm/core';
import { enterAsActor, systemScope, type DailyCleanupInput } from '@crm/core/system';
import { startJobForTest, testScope } from '@crm/core/testing';
import { createDatabase, openQueueConnection, type Database, type QueueConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import * as z from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { backgroundHooks } from '../hooks.ts';
import { DailyPayload, dailyDay, startJobRunners, type JobsLog } from './graphile.ts';

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
    enterAsActor: (input) => enterAsActor({ db }, input),
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
