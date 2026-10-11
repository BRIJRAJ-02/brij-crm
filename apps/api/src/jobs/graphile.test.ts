// Graphile Worker in the loop (spec 0008, AC-102, AC-103, AC-115, AC-121):
// the real runners on the worker login, against the test database. A test
// job runs start to finish in slices handed back through the queue and
// leaves no queue row behind; a graceful stop mid job hands it back, and new
// runners carry it on to the end with every item done once.
import { createRunner, createWorkspace, getJob, jobKinds, newId, startTestJob, type Runner } from '@crm/core';
import { enterAsActor, systemScope } from '@crm/core/system';
import { testScope } from '@crm/core/testing';
import { createDatabase, openQueueConnection, type Database, type QueueConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { backgroundHooks } from '../hooks.ts';
import { startJobRunners, type JobsLog } from './graphile.ts';

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

const registry = jobKinds({ environment: 'local' });
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
});
