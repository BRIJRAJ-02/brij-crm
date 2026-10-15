// The sleeping worker, for real (spec 0008, Letting the database sleep;
// AC-111, AC-117): the worker process on its own database, with a 2 second
// idle time and the relay on. Idle, it closes every connection it holds
// (none left in `pg_stat_activity`) and `/health` says `asleep` from memory;
// a wake call brings it back and a job started meanwhile runs within 5
// seconds of its commit; and a job scheduled past the 30 second horizon lets
// it sleep and wakes it at its time.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkspace, getJob, jobKinds, newId } from '@crm/core';
import { startJobForTest, testScope } from '@crm/core/testing';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { backgroundHooks } from '../hooks.ts';

const { appUrl, workerUrl, adminUrl } = inject('sleepDatabase');
const PORT = 3996;
const HEALTH = `http://127.0.0.1:${String(PORT)}/health`;
const WAKE = `http://127.0.0.1:${String(PORT)}/internal/outbox-wake`;
const database = new URL(appUrl).pathname.slice(1);
const registry = jobKinds({ environment: 'local' });

let db: Database;
let worker: ChildProcess | undefined;
let output = '';

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-sleep-tests' });
});
afterAll(async () => {
  if (worker !== undefined && worker.exitCode === null) {
    const exited = new Promise((resolve) => worker?.on('exit', resolve));
    worker.kill('SIGTERM');
    await exited;
  }
  await db.close();
});

/** The worker's `/health`, or undefined while it doesn't answer. */
async function health(): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(HEALTH).catch(() => undefined);
  return response?.ok === true ? ((await response.json()) as Record<string, unknown>) : undefined;
}

const state = async () => (await health())?.state;

/** How many connections the worker holds on its database (its pool, its queue pool, the relay's). */
async function connections(): Promise<number> {
  const rows = await testQuery<{ open: number }>(
    adminUrl,
    `select count(*)::int as open from pg_stat_activity where datname = $1 and application_name like 'crm-worker%'`,
    [database],
  );
  return rows[0]?.open ?? 0;
}

const wake = () => fetch(WAKE, { method: 'POST' }).then((response) => response.status);

describe('the sleeping worker (spec 0008, AC-111, AC-117)', () => {
  it('closes every connection when idle, wakes on a wake call and at a scheduled job’s time, and runs the job', async () => {
    worker = spawn(process.execPath, [fileURLToPath(new URL('../worker.ts', import.meta.url))], {
      env: {
        PATH: process.env.PATH ?? '',
        APP_ENV: 'local',
        DATABASE_URL: appUrl,
        DATABASE_URL_DIRECT: workerUrl,
        WORKER_PORT: String(PORT),
        WORKER_IDLE_SLEEP_SECONDS: '2',
        CENTRIFUGO_API_URL: 'http://localhost:9000',
        CENTRIFUGO_API_KEY: 'local-centrifugo-api-key',
      },
    });
    worker.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    worker.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const slow = { timeout: 45_000, interval: 250 };

    await expect.poll(state, slow).toBe('awake');
    // Idle for 2 seconds with nothing waiting: asleep, and every connection gone (the tenant pool lets its idle
    // ones go after 10 seconds, node-postgres's default).
    await expect.poll(state, slow).toBe('asleep');
    expect(output).toContain('Worker asleep');
    await expect.poll(connections, slow).toBe(0);
    // `/health` answers from memory while it sleeps: still no connection.
    expect(await health()).toMatchObject({ status: 'ok', state: 'asleep', jobs: 'on', relay: { mode: 'dormant' } });
    expect(await connections()).toBe(0);

    // A member starts a job and the api's wake call follows the commit: it runs within 5 seconds of the commit.
    const created = await createWorkspace(db, {
      name: 'Sleep',
      slug: `sleep-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
    const now = await startJobForTest(
      owner,
      registry,
      { kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId(), newId()] },
      backgroundHooks(),
    );
    expect(await wake()).toBe(204);
    await expect.poll(async () => (await getJob(owner, registry, now.jobId)).status, slow).toBe('succeeded');
    const ran = await getJob(owner, registry, now.jobId);
    expect(Date.parse(ran.startedAt ?? '') - Date.parse(ran.createdAt)).toBeLessThan(5_000);

    // Asleep again, then a job for 40 seconds from now: past the 30 second horizon, so after the wake call the worker
    // sleeps until its time, and its timer wakes it to run the job (within 60 seconds of its time, AC-111).
    await expect.poll(state, slow).toBe('asleep');
    const runAt = new Date(Date.now() + 40_000);
    const later = await startJobForTest(
      owner,
      registry,
      { kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()], runAt },
      backgroundHooks(),
    );
    expect(await wake()).toBe(204);
    await expect.poll(state, slow).toBe('awake');
    await expect.poll(state, slow).toBe('asleep');
    expect((await getJob(owner, registry, later.jobId)).status).toBe('queued');
    await expect
      .poll(async () => (await getJob(owner, registry, later.jobId)).status, { timeout: 90_000, interval: 500 })
      .toBe('succeeded');
    const started = Date.parse((await getJob(owner, registry, later.jobId)).startedAt ?? '');
    expect(started).toBeGreaterThanOrEqual(runAt.getTime());
    expect(started - runAt.getTime()).toBeLessThan(60_000);

    // It stops cleanly, asleep or awake.
    const exited = new Promise<number | null>((resolve) => worker?.on('exit', resolve));
    worker.kill('SIGTERM');
    expect(await exited).toBe(0);
  }, 240_000);
});
