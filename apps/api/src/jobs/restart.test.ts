// Jobs survive a restart (spec 0008, AC-103): real worker processes
// (`test/jobs-worker.ts`, the worker's own wiring) run a 20,000 item job of
// `test.effects`, which writes one row per item in each batch's transaction.
// A graceful stop (SIGTERM) finishes the batch in hand and hands the job back,
// and a new worker carries on within 10 seconds of starting; a hard kill
// (SIGKILL) loses the batch in hand, and a new worker carries on once the dead
// worker's locks and lease run out (shortened here; the production numbers
// give 3 minutes). Two workers running at once (a deploy overlap) with two
// queue rows for one job are kept apart by the lease. Every time, each item's
// effect is counted exactly once.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkspace, newId } from '@crm/core';
import { ensureTestTables, startJobForTest, testScope } from '@crm/core/testing';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { restartRegistry } from '../../test/jobs-kinds.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-restart-tests' });
const registry = restartRegistry();

const workers: ChildProcess[] = [];
beforeAll(async () => {
  await ensureTestTables(ownerUrl);
});
afterAll(async () => {
  for (const child of workers) if (child.exitCode === null) child.kill('SIGKILL');
  await db.close();
});

/** A worker process with `timings`, ready once its runners started. */
async function worker(timings: Record<string, string> = {}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../test/jobs-worker.ts', import.meta.url))], {
    env: {
      PATH: process.env.PATH ?? '',
      JOBS_TEST_DATABASE_URL: appUrl,
      JOBS_TEST_DIRECT_URL: workerUrl,
      ...timings,
    },
  });
  workers.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const spawned = Date.now();
  await expect.poll(() => output.includes('jobs.runners.started'), { timeout: 20_000, interval: 50 }).toBe(true);
  return { child, exited, spawned, output: () => output };
}

/** A member's `kind` job over `count` items. */
async function startEffects(kind: string, count: number, params: { batchSize: number; batchMillis: number }) {
  const created = await createWorkspace(db, {
    name: 'Restart',
    slug: `restart-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const items = Array.from({ length: count }, () => newId());
  const { jobId } = await startJobForTest(scope, registry, { kind, params, items });
  return { workspaceId: created.workspaceId, jobId };
}

const jobState = async (jobId: string) => {
  const [row] = await testQuery<{ status: string; done: number; lease_until: Date | null }>(
    ownerUrl,
    'select status::text, done, lease_until from jobs where id = $1',
    [jobId],
  );
  if (row === undefined) throw new Error('The job is gone.');
  return row;
};

/** Every effect the job wrote, and how many items they name: equal when each item ran once. */
const effects = async (jobId: string) => {
  const [row] = await testQuery<{ rows: number; items: number }>(
    ownerUrl,
    'select count(*)::int as rows, count(distinct item_id)::int as items from test_job_effects where job_id = $1',
    [jobId],
  );
  return row ?? { rows: 0, items: 0 };
};

const queueRows = (jobId: string) =>
  testQuery<{ key: string | null; locked: boolean }>(
    ownerUrl,
    `select key, locked_at is not null as locked from graphile_worker._private_jobs where payload->>'jobId' = $1`,
    [jobId],
  );

const ITEMS = 20_000;

describe('a job survives a restart (AC-103)', () => {
  it('on SIGTERM finishes the batch in hand and hands the job back; a new worker carries on within 10 seconds, every item once', async () => {
    const job = await startEffects('test.effects', ITEMS, { batchSize: 500, batchMillis: 150 });
    const first = await worker();
    await expect
      .poll(async () => (await jobState(job.jobId)).done, { timeout: 30_000, interval: 50 })
      .toBeGreaterThanOrEqual(3_000);
    first.child.kill('SIGTERM');
    expect(await first.exited).toBe(0);
    expect(first.output()).toContain('"outcome":"stopped"');
    const stopped = await jobState(job.jobId);
    expect(stopped).toMatchObject({ status: 'running', lease_until: null });
    expect(stopped.done).toBeLessThan(ITEMS);
    // Handed back: one waiting row, under the job's key, and the effects so far are exactly the items done.
    expect(await queueRows(job.jobId)).toEqual([{ key: expect.stringContaining(job.jobId) as unknown, locked: false }]);
    expect(await effects(job.jobId)).toEqual({ rows: stopped.done, items: stopped.done });

    const second = await worker();
    await expect
      .poll(async () => (await jobState(job.jobId)).done, { timeout: 10_000, interval: 50 })
      .toBeGreaterThan(stopped.done);
    const resumedMs = Date.now() - second.spawned;
    expect(resumedMs, `SIGTERM: carried on ${String(resumedMs)} ms after the new worker started`).toBeLessThan(10_000);
    await expect
      .poll(async () => (await jobState(job.jobId)).status, { timeout: 60_000, interval: 200 })
      .toBe('succeeded');
    expect(await effects(job.jobId)).toEqual({ rows: ITEMS, items: ITEMS });
    expect((await jobState(job.jobId)).done).toBe(ITEMS);
    second.child.kill('SIGTERM');
    expect(await second.exited).toBe(0);
  }, 120_000);

  it('after SIGKILL loses only the batch in hand, and a new worker carries on once the dead locks and lease run out, every item once', async () => {
    // Shortened, keeping production's proportions: slices of 1 second (20 in production) under locks stale after 2
    // (120), checked every half second (a minute), and leases of 3 seconds (60). In production a hard killed
    // worker's job carries on within 3 minutes of a new one starting: its lock is stale 2 minutes after its slice
    // began, the next minutely release frees it, and its lease ran out long before.
    const timings = {
      JOBS_TEST_SLICE_MS: '1000',
      JOBS_TEST_LEASE_MS: '3000',
      JOBS_TEST_STALE_SECONDS: '2',
      JOBS_TEST_HOUSEKEEPING_MS: '500',
    };
    const job = await startEffects('test.effects', ITEMS, { batchSize: 500, batchMillis: 300 });
    const first = await worker(timings);
    await expect
      .poll(async () => (await jobState(job.jobId)).done, { timeout: 30_000, interval: 50 })
      .toBeGreaterThanOrEqual(3_000);
    first.child.kill('SIGKILL');
    await first.exited;
    const killed = await jobState(job.jobId);
    expect(killed.status).toBe('running');
    // The batch in hand rolled back with its effects: what's committed is exactly the items done.
    expect(await effects(job.jobId)).toEqual({ rows: killed.done, items: killed.done });

    const second = await worker(timings);
    await expect
      .poll(async () => (await jobState(job.jobId)).done, { timeout: 30_000, interval: 50 })
      .toBeGreaterThan(killed.done);
    const resumedMs = Date.now() - second.spawned;
    expect(resumedMs, `SIGKILL: carried on ${String(resumedMs)} ms after the new worker started`).toBeLessThan(15_000);
    await expect
      .poll(async () => (await jobState(job.jobId)).status, { timeout: 60_000, interval: 200 })
      .toBe('succeeded');
    expect(await effects(job.jobId)).toEqual({ rows: ITEMS, items: ITEMS });
    second.child.kill('SIGTERM');
    await second.exited;
  }, 150_000);

  it('keeps two workers apart during a deploy overlap: a second queue row for a running job waits for its lease', async () => {
    const count = 3_000;
    const job = await startEffects('test.effects_light', count, { batchSize: 100, batchMillis: 100 });
    const [old, fresh] = await Promise.all([worker(), worker()]);
    await expect
      .poll(async () => (await jobState(job.jobId)).done, { timeout: 20_000, interval: 20 })
      .toBeGreaterThan(0);
    // A second row for the job while a slice holds it, as a stale lock release or an old deploy's row would leave.
    await testQuery(
      ownerUrl,
      `select graphile_worker.add_job('crm_job_light', json_build_object('workspaceId', $1::uuid, 'jobId', $2::uuid))`,
      [job.workspaceId, job.jobId],
    );
    await expect
      .poll(async () => (await jobState(job.jobId)).status, { timeout: 60_000, interval: 100 })
      .toBe('succeeded');
    expect(await effects(job.jobId)).toEqual({ rows: count, items: count });
    expect(old.output().includes('job.leased-elsewhere') || fresh.output().includes('job.leased-elsewhere')).toBe(true);
    old.child.kill('SIGTERM');
    fresh.child.kill('SIGTERM');
    await Promise.all([old.exited, fresh.exited]);
  }, 120_000);
});
