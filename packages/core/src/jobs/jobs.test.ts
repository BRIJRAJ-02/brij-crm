// Background jobs against a real Postgres as the app login (spec 0008,
// milestone 1): starting in the caller's transaction, the limits, who sees
// and cancels what, and the runner driven slice by slice with an injected
// clock, as Graphile Worker would call it.
import { sql } from 'drizzle-orm';
import { PERMISSIONS } from '@crm/contracts';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import * as z from 'zod';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { runWrite } from '../engine/write.ts';
import { rescope } from '../testing.ts';
import { devSimulate, SIMULATED_REFUSAL } from './kinds/dev-simulate.ts';
import { jobKinds } from './kinds/index.ts';
import { createRegistry, defineKind, kindContractProblems, type AnyKind } from './registry.ts';
import { cancelJob, getJob, listJobs, startJob, startTestJob } from './service.ts';
import { fakeClock, jobTestKit, refusalOf } from './test-kit.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-jobs-tests' });
afterAll(async () => {
  await db.close();
});

/** A kind that always fails its batch: for the attempt limit. */
const alwaysFails = defineKind({
  kind: 'test.fails',
  lane: 'light',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({}),
  cancellable: true,
  maxAttempts: 3,
  batchSize: 10,
  sample: {},
  step: () => Promise.reject(new Error('This batch always fails.')),
});

/** A system kind (cursor mode) that finishes in one batch. */
const systemOnce = defineKind({
  kind: 'test.system',
  lane: 'light',
  actor: 'system',
  mode: 'cursor',
  params: z.strictObject({}),
  cancellable: false,
  maxAttempts: 5,
  batchSize: 1,
  sample: {},
  step: () => Promise.resolve({ finished: true, counts: { done: 1 }, result: { phase: 'done' } }),
});

const { team, runnerFor, queueRows, jobEvents, itemStates, drive } = jobTestKit(db, ownerUrl);

describe('starting a job (AC-102, AC-116, AC-125)', () => {
  it('commits with its write and goes on the queue; a write that rolls back leaves no job and no queue row', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const kept = newId();
    await runWrite(t.member, (context) =>
      startJob(context, registry, { id: kept, kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
    );
    expect(await queueRows(kept)).toMatchObject([{ key: `crm-job:${t.workspaceId}:${kept}`, locked: false }]);
    const lost = newId();
    await expect(
      runWrite(t.member, async (context) => {
        await startJob(context, registry, { id: lost, kind: 'dev.simulate', params: { batchMillis: 0 } });
        throw new Error('The feature’s own write failed.');
      }),
    ).rejects.toThrow('The feature’s own write failed.');
    expect(await queueRows(lost)).toEqual([]);
    expect(await refusalOf(getJob(t.member, registry, lost))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers the job already made when started again with the same id', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const input = { id: newId(), items: 3, batchMillis: 0 };
    const first = await startTestJob(t.owner, registry, input, [outboxHook()]);
    const again = await startTestJob(t.owner, registry, input, [outboxHook()]);
    expect(again.id).toBe(first.id);
    expect(again.total).toBe(3);
    expect((await listJobs(t.owner, registry, { scope: 'all' })).jobs).toHaveLength(1);
    // Someone else's start with that id, or another kind's, is refused rather than handed this job.
    const other = runWrite(t.admin, (context) =>
      startJob(context, registry, { id: first.id, kind: 'dev.simulate', params: { batchMillis: 0 } }),
    );
    expect(await refusalOf(other)).toMatchObject({ code: 'ID_TAKEN' });
    // One event, from the first start, under its starter.
    const events = await jobEvents(t.workspaceId);
    expect(events).toHaveLength(1);
    expect(events[0]?.item_ids).toEqual([first.id]);
  });

  it('refuses the 21st unfinished member job, a job past a million items, and params its kind refuses', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const tight = rescope(t.owner, { limits: { unfinishedJobs: 2, jobItems: 5 } });
    await startTestJob(tight, registry, { id: newId(), items: 1, batchMillis: 0 });
    await startTestJob(tight, registry, { id: newId(), items: 1, batchMillis: 0 });
    expect(await refusalOf(startTestJob(tight, registry, { id: newId(), items: 1, batchMillis: 0 }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    const roomy = rescope(t.owner, { limits: { jobItems: 5 } });
    expect(await refusalOf(startTestJob(roomy, registry, { id: newId(), items: 6, batchMillis: 0 }))).toMatchObject({
      code: 'JOB_TOO_LARGE',
    });
    const bad = runWrite(t.owner, (context) =>
      startJob(context, registry, { kind: 'dev.simulate', params: { batchMillis: -1 } }),
    );
    expect(await refusalOf(bad)).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('makes a system kind the system’s from a member’s write: priority 10, never counted, seen by managers only', async () => {
    const t = await team();
    const registry = createRegistry([systemOnce]);
    const tight = rescope(t.member, { limits: { unfinishedJobs: 0 } });
    const { result } = await runWrite(tight, (context) =>
      startJob(context, registry, { kind: 'test.system', params: {} }),
    );
    const [row] = await testQuery<{ priority: number; created_by_type: string }>(
      ownerUrl,
      'select priority, created_by_type::text from jobs where id = $1',
      [result.jobId],
    );
    expect(row).toEqual({ priority: 10, created_by_type: 'system' });
    expect(await refusalOf(getJob(t.member, registry, result.jobId))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await getJob(t.admin, registry, result.jobId)).startedBy).toEqual({ type: 'system' });
    // A member kind from a scope with no member is a programming error.
    await expect(
      runWrite(systemScope(db, t.workspaceId), (context) =>
        startJob(context, jobKinds({ environment: 'local' }), { kind: 'dev.simulate', params: { batchMillis: 0 } }),
      ),
    ).rejects.toThrow(/member's job/);
  });

  it('answers NOT_FOUND for the test job in production, and FORBIDDEN to a member', async () => {
    const t = await team();
    const production = jobKinds({ environment: 'production' });
    expect(await refusalOf(startTestJob(t.owner, production, { id: newId(), items: 1, batchMillis: 0 }))).toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(
      await refusalOf(
        startTestJob(t.member, jobKinds({ environment: 'preview' }), { id: newId(), items: 1, batchMillis: 0 }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: PERMISSIONS['jobs.manage'].message });
  });
});

describe('who sees and cancels a job (AC-107, AC-114)', () => {
  it('shows a member their own jobs, a manager every job, and anyone else NOT_FOUND', async () => {
    const t = await team(['member', 'admin', 'member']);
    const registry = jobKinds({ environment: 'local' });
    const own = newId();
    await runWrite(t.member, (context) =>
      startJob(context, registry, { id: own, kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
    );
    expect((await getJob(t.member, registry, own)).startedBy).toEqual({ type: 'member', memberId: t.memberId });
    expect((await getJob(t.admin, registry, own)).id).toBe(own);
    const ids = (await listJobs(t.member, registry, { scope: 'mine' })).jobs.map((job) => job.id);
    expect(ids).toEqual([own]);
    expect((await listJobs(t.owner, registry, { scope: 'mine' })).jobs).toEqual([]);
    expect((await listJobs(t.owner, registry, { scope: 'all' })).jobs.map((job) => job.id)).toEqual([own]);
    expect(await refusalOf(listJobs(t.member, registry, { scope: 'all' }))).toMatchObject({ code: 'FORBIDDEN' });
    // Another member: the same 404 as an id that names nothing.
    const other = t.as(t.ids[2] ?? '', 'member');
    expect(await refusalOf(getJob(other, registry, own))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(cancelJob(other, registry, own))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(getJob(t.member, registry, newId()))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(getJob(t.member, registry, 'not-an-id'))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cancels a waiting job at once, names its starter on the event when an admin cancels, and refuses a finished one', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const id = newId();
    await runWrite(
      t.member,
      (context) =>
        startJob(context, registry, { id, kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
      [outboxHook()],
    );
    const cancelled = await cancelJob(t.admin, registry, id, [outboxHook()]);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellable: false });
    expect(cancelled.finishedAt).toBeDefined();
    const events = await jobEvents(t.workspaceId);
    expect(events.map((event) => event.actor_member_id)).toEqual([t.memberId, t.memberId]);
    expect(await refusalOf(cancelJob(t.member, registry, id))).toMatchObject({ code: 'JOB_FINISHED' });
    // The queue row is left; its slice finds the job finished and does nothing.
    const run = runnerFor(registry);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: id })).toBe('finished-already');
  });

  it('refuses to cancel a kind that can’t be cancelled', async () => {
    const t = await team();
    const registry = createRegistry([systemOnce]);
    const { result } = await runWrite(t.owner, (context) =>
      startJob(context, registry, { kind: 'test.system', params: {} }),
    );
    expect(await refusalOf(cancelJob(t.owner, registry, result.jobId))).toMatchObject({ code: 'JOB_NOT_CANCELLABLE' });
  });
});

describe('the runner (AC-103 to AC-107, AC-113, AC-120)', () => {
  it('runs a job to the end in slices: every item once, refusals grouped by code, progress at most once a second', async () => {
    const t = await team();
    const clock = fakeClock();
    const registry = jobKinds({ environment: 'local', sleep: clock.sleep });
    const run = runnerFor(registry, clock, { sliceMs: 2_000 });
    const job = await startTestJob(
      t.owner,
      registry,
      { id: newId(), items: 1_000, batchSize: 100, batchMillis: 400, refuseEvery: 10 },
      [outboxHook()],
    );
    const outcomes = await drive(run, t.workspaceId, job.id);
    // 10 batches of 400 ms in slices of 2 seconds: handed over between slices, then done.
    expect(outcomes.at(-1)).toBe('succeeded');
    expect(outcomes.filter((outcome) => outcome === 'handed-over').length).toBeGreaterThan(0);
    const done = await getJob(t.owner, registry, job.id);
    expect(done).toMatchObject({ status: 'succeeded', total: 1_000, done: 900, refused: 100, skipped: 0 });
    expect(done.result?.refusals).toEqual([
      { code: SIMULATED_REFUSAL, count: 100, itemIds: expect.any(Array) as unknown },
    ]);
    expect(done.result?.refusals?.[0]?.itemIds).toHaveLength(20);
    expect(await itemStates(t.workspaceId, job.id)).toEqual([
      { state: 'done', n: 900 },
      { state: 'refused', n: 100 },
    ]);
    // The start's event, then at most one a second across 4 seconds of batches, and the final one.
    const events = await jobEvents(t.workspaceId);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.length).toBeLessThanOrEqual(1 + 5 + 1);
    expect(events.every((event) => event.actor_member_id !== null)).toBe(true);
    expect(run.wakes()).toBeGreaterThan(0);
    // Each hand over replaced the job's one waiting row rather than adding another (here no Graphile takes them).
    expect(await queueRows(job.id)).toHaveLength(1);
    // The slice log lines carry ids and counts, never params.
    const logged = JSON.stringify(run.lines);
    expect(logged).toContain('job.slice.start');
    expect(logged).not.toContain('batchMillis');
  });

  it('retries a batch that throws without redoing a committed one, and ends failed at the attempt limit', async () => {
    const t = await team();
    const clock = fakeClock();
    const registry = jobKinds({ environment: 'local', sleep: clock.sleep });
    const run = runnerFor(registry, clock);
    const job = await startTestJob(t.owner, registry, {
      id: newId(),
      items: 30,
      batchSize: 10,
      batchMillis: 0,
      failAtPosition: 15,
    });
    const outcomes = await drive(run, t.workspaceId, job.id);
    expect(outcomes).toContain('threw');
    expect(outcomes.at(-1)).toBe('succeeded');
    expect(await getJob(t.owner, registry, job.id)).toMatchObject({ status: 'succeeded', done: 30 });

    const failing = createRegistry([alwaysFails]);
    const { result } = await runWrite(t.owner, (context) =>
      startJob(context, failing, { kind: 'test.fails', params: {}, items: [newId(), newId()] }),
    );
    const failRun = runnerFor(failing);
    await expect(failRun.runner.runSlice({ workspaceId: t.workspaceId, jobId: result.jobId })).rejects.toThrow();
    const retrying = await getJob(t.owner, failing, result.jobId);
    expect(retrying.status).toBe('running');
    expect(retrying.retryAt).toBeDefined();
    const after = await drive(failRun, t.workspaceId, result.jobId);
    expect(after.at(-1)).toBe('failed');
    expect(await getJob(t.owner, failing, result.jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'JOB_FAILED', message: 'This job stopped after repeated errors. What it finished is kept.' },
      done: 0,
    });
  });

  it('stops a running job before its next batch when it is cancelled', async () => {
    const t = await team();
    const clock = fakeClock();
    const registry = jobKinds({ environment: 'local', sleep: clock.sleep });
    const run = runnerFor(registry, clock, { sliceMs: 1_000 });
    const job = await startTestJob(t.owner, registry, { id: newId(), items: 100, batchSize: 10, batchMillis: 600 });
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('handed-over');
    const asked = await cancelJob(t.owner, registry, job.id);
    expect(asked.status).toBe('cancelling');
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('cancelled');
    const ended = await getJob(t.owner, registry, job.id);
    expect(ended).toMatchObject({ status: 'cancelled', done: 20 });
  });

  it('ends a removed member’s job ACTOR_REMOVED, and runs a system job as the system', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const id = newId();
    await runWrite(t.member, (context) =>
      startJob(context, registry, { id, kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
    );
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${t.memberId}`),
    );
    const run = runnerFor(registry);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: id })).toBe('failed');
    expect(await getJob(t.owner, registry, id)).toMatchObject({ status: 'failed', error: { code: 'ACTOR_REMOVED' } });

    const system = createRegistry([systemOnce]);
    const { result } = await runWrite(t.owner, (context) =>
      startJob(context, system, { kind: 'test.system', params: {} }),
    );
    expect(await runnerFor(system).runner.runSlice({ workspaceId: t.workspaceId, jobId: result.jobId })).toBe(
      'succeeded',
    );
    expect(await getJob(t.owner, system, result.jobId)).toMatchObject({ done: 1, result: { phase: 'done' } });
  });

  it('never lends system power to a job no member or the system started: it ends JOB_INVALID', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const id = newId();
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`
        insert into jobs (workspace_id, id, kind, lane, status, params, priority, total, created_by_type, created_by_id)
        values (${t.workspaceId}, ${id}, 'dev.simulate', 'heavy', 'queued', '{"batchMillis":0}'::jsonb, 0, 0,
          'api_key', ${newId()})
      `),
    );
    expect(await runnerFor(registry).runner.runSlice({ workspaceId: t.workspaceId, jobId: id })).toBe('failed');
    const [row] = await testQuery<{ error_code: string }>(ownerUrl, 'select error_code from jobs where id = $1', [id]);
    expect(row).toEqual({ error_code: 'JOB_INVALID' });
  });

  it('leaves a job another runner holds alone, queueing it again for when the lease ends', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const job = await startTestJob(t.owner, registry, { id: newId(), items: 5, batchMillis: 0 });
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(
        sql`update jobs set lease_owner = 'someone-else', lease_until = now() + interval '1 minute' where id = ${job.id}`,
      ),
    );
    const run = runnerFor(registry);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('leased-elsewhere');
    expect((await getJob(t.owner, registry, job.id)).done).toBe(0);
    // Its one waiting row now runs when the lease ends (the queue key test, AC-103).
    const [lease] = await testQuery<{ lease_until: Date }>(ownerUrl, 'select lease_until from jobs where id = $1', [
      job.id,
    ]);
    expect((await queueRows(job.id)).map((row) => row.run_at.getTime())).toEqual([lease?.lease_until.getTime()]);
    expect(run.lines.some((line) => line.message === 'job.leased-elsewhere')).toBe(true);
  });

  it('keeps two slices of one job apart in one process too: each slice holds its own lease', async () => {
    const t = await team();
    const clock = fakeClock();
    const registry = jobKinds({ environment: 'local', sleep: clock.sleep });
    const job = await startTestJob(t.owner, registry, { id: newId(), items: 50, batchSize: 10, batchMillis: 100 });
    const run = runnerFor(registry, clock);
    // A slice of this same runner holds the lease (it was killed mid slice, or a second row runs beside it).
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(
        sql`update jobs set lease_owner = 'test-runner:999', lease_until = now() + interval '1 minute' where id = ${job.id}`,
      ),
    );
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('leased-elsewhere');
  });

  it('cancels the job of a deleted workspace WORKSPACE_GONE', async () => {
    const t = await team();
    const registry = jobKinds({ environment: 'local' });
    const job = await startTestJob(t.owner, registry, { id: newId(), items: 5, batchMillis: 0 });
    await db.withWorkspace(t.workspaceId, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    expect(await runnerFor(registry).runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('cancelled');
    const [row] = await testQuery<{ status: string; error_code: string }>(
      ownerUrl,
      'select status::text, error_code from jobs where id = $1',
      [job.id],
    );
    expect(row).toEqual({ status: 'cancelled', error_code: 'WORKSPACE_GONE' });
  });
});

describe('the shared kind contract (AC-122)', () => {
  const kinds: readonly AnyKind[] = [devSimulate(), devSimulate(undefined, 'light')] as AnyKind[];

  it.each(kinds.map((kind) => [kind.kind, kind] as const))(
    '%s: strict params with no secrets, ids only on the queue, an idempotent batch, a call under 30 seconds',
    async (_name, kind) => {
      expect(kindContractProblems(kind)).toEqual([]);
      const t = await team();
      const registry = createRegistry([kind]);
      const items = Array.from({ length: 20 }, () => newId());
      const { result } = await runWrite(t.owner, (context) =>
        startJob(context, registry, { kind: kind.kind, params: kind.sample, items }),
      );
      const [queued] = await testQuery<{ payload: unknown }>(
        ownerUrl,
        'select payload from graphile_worker._private_jobs where key = $1',
        [`crm-job:${t.workspaceId}:${result.jobId}`],
      );
      expect(queued?.payload).toEqual({ workspaceId: t.workspaceId, jobId: result.jobId });
      // One batch commits; its progress is rolled back to before it; the batch runs again and changes nothing.
      const run = runnerFor(registry, fakeClock(), { sliceMs: 0 });
      const started = Date.now();
      await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: result.jobId });
      expect(Date.now() - started).toBeLessThan(30_000);
      const before = await itemStates(t.workspaceId, result.jobId);
      await db.withWorkspace(t.workspaceId, (tx) =>
        tx.execute(sql`update jobs set checkpoint = null where id = ${result.jobId}`),
      );
      await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: result.jobId });
      const after = await itemStates(t.workspaceId, result.jobId);
      const total = (rows: readonly { state: string; n: number }[]) =>
        rows.filter((row) => row.state !== 'pending').reduce((sum, row) => sum + row.n, 0);
      // The replay touched no decided item again: it only moved on to pending ones.
      expect(total(after)).toBeGreaterThanOrEqual(total(before));
      const job = await getJob(t.owner, registry, result.jobId);
      expect(job.done + job.refused + job.skipped).toBe(total(after));
    },
  );
});
