// Background jobs, dependable and fair (spec 0008, milestone 2), against a real
// Postgres as the app login, the runner driven slice by slice with an
// injected clock as Graphile Worker would call it: retries and the failure
// hook on every path that ends a job failed (AC-104, AC-121, AC-124), the
// snapshot and its confirm (AC-109), coalescing, once keys, later starts and
// kinds outside the job limit (AC-110, AC-111, AC-125, AC-126).
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import * as z from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { runWrite } from '../engine/write.ts';
import { rescope } from '../testing.ts';
import { syntheticId } from './kinds/dev-simulate.ts';
import { jobKinds } from './kinds/index.ts';
import { defineKind, type AnyKind, type ItemOutcome } from './registry.ts';
import { SNAPSHOT_PAGE } from './runner.ts';
import { cancelJob, confirmJob, getJob, startJob, startTestJob } from './service.ts';
import { ensureTestTables, fakeClock, jobTestKit, refusalOf } from './test-kit.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-jobs-m2-tests' });
const { team, runnerFor, queueRows, jobEvents, itemStates, jobRow, drive } = jobTestKit(db, ownerUrl);

beforeAll(async () => {
  await ensureTestTables(ownerUrl);
});
afterAll(async () => {
  await db.close();
});

/** Jobs whose `onFailed` throws the next time it runs (once each). */
const hookThrowsOnce = new Set<string>();

/**
 * A member kind for the endings (AC-124): its step marks items done (one
 * effect row each), returns `failed` when its batch holds `failAt`, or throws
 * on every try with `throwAlways`; its `onFailed` writes a hook row and a
 * change of its own, as the system.
 */
const ending = defineKind({
  kind: 'test.ending',
  lane: 'light',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({ failAt: z.number().int().optional(), throwAlways: z.boolean().optional() }),
  cancellable: true,
  maxAttempts: 3,
  batchSize: 10,
  sample: {},
  async step(context, { job, items = [] }) {
    if (job.params.throwAlways === true) throw new Error('This batch always fails.');
    const failAt = job.params.failAt ?? 0;
    const hit = items.some((item) => item.position === failAt);
    const handled = hit ? items.filter((item) => item.position < failAt) : items;
    for (const item of handled) {
      await context.tx.execute(
        sql`insert into test_job_effects (workspace_id, job_id, item_id) values (${context.scope.workspaceId}, ${job.id}, ${item.itemId})`,
      );
    }
    return {
      finished: false,
      items: handled.map((item) => ({ position: item.position, state: 'done' as const })),
      ...(hit ? { failed: { code: 'FORBIDDEN', message: 'You can no longer make this change.' } } : {}),
    };
  },
  async onFailed(context, job) {
    if (hookThrowsOnce.delete(job.id)) throw new Error('The hook failed on purpose.');
    await context.tx.execute(sql`
      insert into test_job_hooks (workspace_id, job_id, code, has_params, actor)
      values (${context.scope.workspaceId}, ${job.id}, ${job.error.code}, ${job.params !== undefined}, ${context.scope.actor.type})
    `);
    // A change of its own, stored through the outbox like any write's.
    context.record({ definitions: [{ attributeIds: [] }] });
  },
});

/**
 * A member kind that snapshots `test_job_targets` (AC-109): the targets that
 * existed at `asOf` and weren't deleted, by id; each batch reads its targets
 * again under lock and skips one deleted since with a reason.
 */
const touch = defineKind({
  kind: 'test.touch',
  lane: 'heavy',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({ asOf: z.iso.datetime({ offset: true }) }),
  cancellable: true,
  maxAttempts: 8,
  batchSize: 3,
  sample: { asOf: '2026-10-12T00:00:00.000Z' },
  async snapshot(tx, params, after, limit) {
    const result = await tx.execute<{ id: string }>(sql`
      select id from test_job_targets
      where created_at <= ${params.asOf}::timestamptz and deleted_at is null
        and (${after ?? null}::uuid is null or id > ${after ?? null}::uuid)
      order by id limit ${limit}
    `);
    return result.rows.map((row) => row.id);
  },
  async step(context, { job, items = [] }) {
    const live = await context.tx.execute<{ id: string }>(sql`
      select id from test_job_targets
      where id = any(${`{${items.map((item) => item.itemId).join(',')}}`}::uuid[]) and deleted_at is null
      for update
    `);
    const here = new Set(live.rows.map((row) => row.id));
    const outcome: ItemOutcome[] = [];
    for (const item of items) {
      if (!here.has(item.itemId)) {
        outcome.push({
          position: item.position,
          state: 'skipped' as const,
          code: 'NOT_FOUND',
          message: 'The record was deleted.',
        });
        continue;
      }
      await context.tx.execute(
        sql`insert into test_job_effects (workspace_id, job_id, item_id) values (${context.scope.workspaceId}, ${job.id}, ${item.itemId})`,
      );
      outcome.push({ position: item.position, state: 'done' as const });
    }
    return { finished: false, items: outcome };
  },
});

/** A member kind started by writes (AC-110, AC-126): a one second window, outside the job limit, so a key always. */
const coalesced = defineKind({
  kind: 'test.coalesced',
  lane: 'light',
  actor: 'member',
  mode: 'items',
  params: z.strictObject({ tag: z.string().optional() }),
  cancellable: true,
  maxAttempts: 5,
  batchSize: 100,
  startDelayMs: 1_000,
  countsTowardLimit: false,
  sample: {},
  step: (_context, { items = [] }) =>
    Promise.resolve({
      finished: false,
      items: items.map((item) => ({ position: item.position, state: 'done' as const })),
    }),
});

/** A system cursor kind started once a day (a once key). */
const daily = defineKind({
  kind: 'test.daily',
  lane: 'heavy',
  actor: 'system',
  mode: 'cursor',
  params: z.strictObject({}),
  cancellable: false,
  maxAttempts: 8,
  batchSize: 1,
  sample: {},
  step: () => Promise.resolve({ finished: true, counts: { done: 1 } }),
});

const kinds: readonly AnyKind[] = [ending, touch, coalesced, daily] as AnyKind[];
const registry = jobKinds({ environment: 'local', extra: kinds });

const hookRows = (jobId: string) =>
  testQuery<{ code: string; has_params: boolean; actor: string }>(
    ownerUrl,
    'select code, has_params, actor from test_job_hooks where job_id = $1',
    [jobId],
  );

const effects = (jobId: string) =>
  testQuery<{ item_id: string; n: number }>(
    ownerUrl,
    'select item_id, count(*)::int as n from test_job_effects where job_id = $1 group by 1',
    [jobId],
  );

const definitionEvents = async (workspaceId: string) =>
  (
    await testQuery<{ n: number }>(
      ownerUrl,
      "select count(*)::int as n from outbox where workspace_id = $1 and kind = 'definitions'",
      [workspaceId],
    )
  )[0]?.n ?? 0;

/** Starts a `test.ending` job as `scope` with `count` items. */
async function startEnding(scope: Parameters<typeof runWrite>[0], params: Record<string, unknown>, count = 30) {
  const items = Array.from({ length: count }, () => newId());
  const { result } = await runWrite(
    scope,
    (context) => startJob(context, registry, { kind: 'test.ending', params, items }),
    [outboxHook()],
  );
  return result.jobId;
}

describe('retries and the failure hook (AC-104, AC-121, AC-124)', () => {
  it('ends a job at once when its step returns failed: the batch’s items and counts commit with it, the hook runs as the system, no retry', async () => {
    const t = await team();
    const jobId = await startEnding(t.member, { failAt: 15 });
    const run = runnerFor(registry);
    const baseline = await definitionEvents(t.workspaceId);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId })).toBe('failed');
    expect(await getJob(t.member, registry, jobId)).toMatchObject({
      status: 'failed',
      done: 14,
      error: { code: 'FORBIDDEN', message: 'You can no longer make this change.' },
      cancellable: false,
    });
    expect(await itemStates(t.workspaceId, jobId)).toEqual([
      { state: 'done', n: 14 },
      { state: 'pending', n: 16 },
    ]);
    expect(await effects(jobId)).toHaveLength(14);
    expect(await hookRows(jobId)).toEqual([{ code: 'FORBIDDEN', has_params: true, actor: 'system' }]);
    expect(await definitionEvents(t.workspaceId)).toBe(baseline + 1);
    expect((await jobRow(jobId))?.attempts).toBe(0);
    // Ended for good: a later queue row finds it finished.
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId })).toBe('finished-already');
  });

  it('retries a throwing batch with growing waits, then ends it JOB_FAILED with the hook, the progress kept', async () => {
    const t = await team();
    const jobId = await startEnding(t.member, { throwAlways: true });
    const run = runnerFor(registry);
    const baseline = await definitionEvents(t.workspaceId);
    const outcomes = await drive(run, t.workspaceId, jobId);
    expect(outcomes).toEqual(['threw', 'threw', 'failed']);
    expect(await getJob(t.member, registry, jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'JOB_FAILED', message: 'This job stopped after repeated errors. What it finished is kept.' },
    });
    expect(await hookRows(jobId)).toEqual([{ code: 'JOB_FAILED', has_params: true, actor: 'system' }]);
    expect(await definitionEvents(t.workspaceId)).toBe(baseline + 1);
    // The failed tries were logged with the job id, never a message.
    const failed = run.lines.filter((line) => line.message === 'job.batch.failed');
    expect(failed.map((line) => line.fields.attempt)).toEqual([1, 2, 3]);
    expect(JSON.stringify(run.lines)).not.toContain('always fails');
  });

  it('shows the next try while a batch waits to retry, and a batch that commits sets the count back', async () => {
    const t = await team();
    const clock = fakeClock();
    const simulate = jobKinds({ environment: 'local', sleep: clock.sleep });
    const job = await startTestJob(t.owner, simulate, {
      id: newId(),
      items: 20,
      batchSize: 10,
      batchMillis: 0,
      failAtPosition: 15,
    });
    const run = runnerFor(simulate, clock);
    await expect(run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).rejects.toThrow();
    const waiting = await getJob(t.owner, simulate, job.id);
    expect(waiting).toMatchObject({ status: 'running', done: 10 });
    const row = await jobRow(job.id);
    // Graphile's own wait for the first retry: exp(1) seconds.
    expect(waiting.retryAt).toBe(row?.run_at.toISOString());
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('succeeded');
    const done = await getJob(t.owner, simulate, job.id);
    expect(done).toMatchObject({ status: 'succeeded', done: 20 });
    expect(done.retryAt).toBeUndefined();
    expect((await jobRow(job.id))?.attempts).toBe(0);
  });

  it('runs the hook for ACTOR_REMOVED and JOB_INVALID (no params then), and never for a cancel or WORKSPACE_GONE', async () => {
    const t = await team();
    const removed = await startEnding(t.member, {});
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${t.memberId}`),
    );
    const run = runnerFor(registry);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: removed })).toBe('failed');
    expect(await hookRows(removed)).toEqual([{ code: 'ACTOR_REMOVED', has_params: true, actor: 'system' }]);

    const invalid = await startEnding(t.admin, {});
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update jobs set params = '{"bogus":1}'::jsonb where id = ${invalid}`),
    );
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: invalid })).toBe('failed');
    expect(await hookRows(invalid)).toEqual([{ code: 'JOB_INVALID', has_params: false, actor: 'system' }]);

    const cancelled = await startEnding(t.admin, {});
    await cancelJob(t.admin, registry, cancelled);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: cancelled })).toBe('finished-already');
    expect(await hookRows(cancelled)).toEqual([]);

    const other = await team();
    const gone = await startEnding(other.member, {});
    await db.withWorkspace(other.workspaceId, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    expect(await run.runner.runSlice({ workspaceId: other.workspaceId, jobId: gone })).toBe('cancelled');
    expect(await hookRows(gone)).toEqual([]);
  });

  it('leaves the job unfinished when the hook throws, then ends it with the hook on the retry, on every path', async () => {
    const t = await team();
    const run = runnerFor(registry);

    // A step's failed outcome: the failing batch (and its ending) rolls back whole.
    const stepped = await startEnding(t.member, { failAt: 15 });
    hookThrowsOnce.add(stepped);
    await expect(run.runner.runSlice({ workspaceId: t.workspaceId, jobId: stepped })).rejects.toThrow('on purpose');
    expect(await getJob(t.member, registry, stepped)).toMatchObject({ status: 'running', done: 10 });
    expect(await hookRows(stepped)).toEqual([]);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: stepped })).toBe('failed');
    expect(await getJob(t.member, registry, stepped)).toMatchObject({ status: 'failed', done: 14 });
    expect(await hookRows(stepped)).toHaveLength(1);
    expect(run.lines.some((line) => line.message === 'job.onFailed.failed' && line.fields.jobId === stepped)).toBe(
      true,
    );

    // Attempts used up: the ending is tried again, never the batch.
    const tried = await startEnding(t.member, { throwAlways: true });
    hookThrowsOnce.add(tried);
    const outcomes = await drive(run, t.workspaceId, tried);
    expect(outcomes).toEqual(['threw', 'threw', 'threw', 'failed']);
    expect(await hookRows(tried)).toEqual([{ code: 'JOB_FAILED', has_params: true, actor: 'system' }]);
    expect(run.lines.filter((line) => line.message === 'job.batch.failed' && line.fields.jobId === tried)).toHaveLength(
      3,
    );

    // ACTOR_REMOVED.
    const leaver = t.as(t.ids[0] ?? '', 'member');
    const orphan = await startEnding(leaver, {});
    hookThrowsOnce.add(orphan);
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${t.memberId}`),
    );
    await expect(run.runner.runSlice({ workspaceId: t.workspaceId, jobId: orphan })).rejects.toThrow('on purpose');
    expect((await jobRow(orphan))?.status).toBe('running');
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: orphan })).toBe('failed');
    expect(await hookRows(orphan)).toEqual([{ code: 'ACTOR_REMOVED', has_params: true, actor: 'system' }]);
  });
});

describe('snapshot and confirm (AC-109)', () => {
  it('snapshots in the background, waits ready with the exact count, and runs exactly those items once confirmed', async () => {
    const t = await team();
    const clock = fakeClock();
    const simulate = jobKinds({ environment: 'local', sleep: clock.sleep });
    const count = SNAPSHOT_PAGE * 2 + 2_000;
    const started = await startTestJob(
      t.owner,
      simulate,
      { id: newId(), items: count, batchSize: 1_000, batchMillis: 0, confirm: true },
      [outboxHook()],
    );
    expect(started).toMatchObject({ status: 'preparing', done: 0, cancellable: true });
    expect(started.total).toBeUndefined();
    const run = runnerFor(simulate, clock);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: started.id })).toBe('ready');
    const ready = await getJob(t.owner, simulate, started.id);
    expect(ready).toMatchObject({ status: 'ready', total: count, done: 0 });
    expect(Date.parse(ready.expiresAt ?? '')).toBe(clock.now() + 60 * 60_000);
    // One queue row, at the expiry: if nobody confirms, it ends the job.
    const [expiry] = await queueRows(started.id);
    expect(expiry?.run_at.toISOString()).toBe(ready.expiresAt);
    // The snapshot's ids, in order, each once.
    const [ids] = await testQuery<{ n: number; first: string; last: string }>(
      ownerUrl,
      `select count(distinct item_id)::int as n, (array_agg(item_id order by position))[1] as first,
         (array_agg(item_id order by position desc))[1] as last from job_items where job_id = $1`,
      [started.id],
    );
    expect(ids).toEqual({ n: count, first: syntheticId(1), last: syntheticId(count) });
    // While it waits, the slice it may be woken for does nothing.
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: started.id })).toBe('waiting');

    const confirmed = await confirmJob(t.owner, simulate, started.id, [outboxHook()]);
    expect(confirmed).toMatchObject({ status: 'queued', total: count });
    expect(confirmed.expiresAt).toBeUndefined();
    const queued = await queueRows(started.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.run_at.getTime()).toBeLessThan(Date.now() + 5_000);
    expect((await drive(run, t.workspaceId, started.id)).at(-1)).toBe('succeeded');
    expect(await getJob(t.owner, simulate, started.id)).toMatchObject({
      status: 'succeeded',
      done: count,
      total: count,
    });
    expect(await refusalOf(confirmJob(t.owner, simulate, started.id))).toMatchObject({ code: 'JOB_FINISHED' });
  });

  it('cancels an unconfirmed job JOB_EXPIRED after its hour, and refuses a confirm too early, too late or for another', async () => {
    const t = await team(['member', 'admin', 'member']);
    const clock = fakeClock();
    const simulate = jobKinds({ environment: 'local', sleep: clock.sleep });
    const run = runnerFor(simulate, clock);
    const start = () =>
      startTestJob(t.owner, simulate, { id: newId(), items: 50, batchMillis: 0, confirm: true }, [outboxHook()]);

    const early = await start();
    expect(await refusalOf(confirmJob(t.owner, simulate, early.id))).toMatchObject({ code: 'JOB_NOT_READY' });

    const left = await start();
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: left.id })).toBe('ready');
    // Another member can't see it, so can't confirm it either.
    expect(await refusalOf(confirmJob(t.as(t.ids[2] ?? '', 'member'), simulate, left.id))).toMatchObject({
      code: 'NOT_FOUND',
    });
    clock.advance(60 * 60_000 + 1_000);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: left.id })).toBe('cancelled');
    expect(await getJob(t.owner, simulate, left.id)).toMatchObject({
      status: 'cancelled',
      error: { code: 'JOB_EXPIRED' },
    });
    expect(await refusalOf(confirmJob(t.owner, simulate, left.id))).toMatchObject({ code: 'JOB_FINISHED' });

    // Past its hour but its queue row not yet run: the confirm says so.
    const late = await start();
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: late.id })).toBe('ready');
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update jobs set expires_at = now() - interval '1 second' where id = ${late.id}`),
    );
    expect(await refusalOf(confirmJob(t.owner, simulate, late.id))).toMatchObject({ code: 'JOB_EXPIRED' });

    // Cancelled while it waits: at once, and its expiry row then finds it finished.
    const dropped = await start();
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: dropped.id })).toBe('ready');
    expect(await cancelJob(t.owner, simulate, dropped.id)).toMatchObject({ status: 'cancelled' });
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: dropped.id })).toBe('finished-already');
  });

  it('works on exactly the snapshotted ids: none made after the start, and one deleted since is skipped with a reason', async () => {
    const t = await team();
    const before = Array.from({ length: 7 }, () => newId());
    const insertTargets = async (ids: readonly string[]) => {
      for (const id of ids) {
        await testQuery(ownerUrl, 'insert into test_job_targets (workspace_id, id) values ($1, $2)', [
          t.workspaceId,
          id,
        ]);
      }
    };
    await insertTargets(before);
    const [now] = await testQuery<{ at: string }>(
      ownerUrl,
      `select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`,
    );
    const { result } = await runWrite(t.member, (context) =>
      startJob(context, registry, { kind: 'test.touch', params: { asOf: now?.at }, snapshot: true }),
    );
    // Made after the start: never in the job.
    const after = [newId(), newId()];
    await insertTargets(after);
    const run = runnerFor(registry);
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: result.jobId })).toBe('handed-over');
    expect(await getJob(t.member, registry, result.jobId)).toMatchObject({ status: 'queued', total: 7 });
    // Deleted after the snapshot: checked again in its batch.
    const deleted = [...before].sort()[3] ?? '';
    await testQuery(ownerUrl, 'update test_job_targets set deleted_at = now() where id = $1', [deleted]);
    expect((await drive(run, t.workspaceId, result.jobId)).at(-1)).toBe('succeeded');
    const job = await getJob(t.member, registry, result.jobId);
    expect(job).toMatchObject({ status: 'succeeded', total: 7, done: 6, skipped: 1, refused: 0 });
    const touched = await effects(result.jobId);
    expect(touched.map((row) => row.item_id).sort()).toEqual(before.filter((id) => id !== deleted).sort());
    expect(touched.every((row) => row.n === 1)).toBe(true);
    const [skipped] = await testQuery<{ item_id: string; code: string; message: string }>(
      ownerUrl,
      "select item_id, code, message from job_items where job_id = $1 and state = 'skipped'",
      [result.jobId],
    );
    expect(skipped).toEqual({ item_id: deleted, code: 'NOT_FOUND', message: 'The record was deleted.' });
  });

  it('ends a snapshot that grows past the item limit JOB_TOO_LARGE, and refuses a snapshot for a kind without one', async () => {
    const t = await team();
    const simulate = jobKinds({ environment: 'local' });
    const tight = rescope(t.owner, { limits: { jobItems: 5 } });
    const job = await startTestJob(tight, simulate, { id: newId(), items: 6, batchMillis: 0, confirm: true });
    // The slice enters the starter again (with the workspace's limits): lowered here through the runner's door.
    const run = runnerFor(simulate, fakeClock(), {
      enterAsActor: () => Promise.resolve(tight),
    });
    expect(await run.runner.runSlice({ workspaceId: t.workspaceId, jobId: job.id })).toBe('failed');
    expect(await getJob(t.owner, simulate, job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'JOB_TOO_LARGE' },
    });
    await expect(
      runWrite(t.member, (context) => startJob(context, registry, { kind: 'test.ending', params: {}, confirm: true })),
    ).rejects.toThrow('takes no snapshot');
  });
});

describe('coalescing, once keys and later starts (AC-110, AC-111, AC-125, AC-126)', () => {
  const startCoalesced = (scope: Parameters<typeof runWrite>[0], items: readonly string[], extra: object = {}) =>
    runWrite(
      scope,
      (context) =>
        startJob(context, registry, { kind: 'test.coalesced', params: {}, items, dedupeKey: 'attr-1', ...extra }),
      [outboxHook()],
    ).then(({ result }) => result);

  it('adds a burst of starts with one key to the one waiting job, after its start delay', async () => {
    const t = await team();
    const [a = '', b = '', c = '', d = ''] = Array.from({ length: 4 }, () => newId());
    const first = await startCoalesced(t.member, [a, b]);
    const second = await startCoalesced(t.member, [b, c]);
    const third = await startCoalesced(t.member, [d]);
    expect(first.merged).toBe(false);
    expect([second, third]).toEqual([
      { jobId: first.jobId, merged: true },
      { jobId: first.jobId, merged: true },
    ]);
    const job = await getJob(t.member, registry, first.jobId);
    expect(job).toMatchObject({ status: 'queued', total: 4 });
    const [items] = await testQuery<{ ids: string[] }>(
      ownerUrl,
      'select array_agg(item_id::text order by position) as ids from job_items where job_id = $1',
      [first.jobId],
    );
    expect(items?.ids).toEqual([a, b, c, d]);
    // The start delay: it runs a second after the first start, and the queue row says the same.
    const row = await jobRow(first.jobId);
    expect(Date.parse(job.createdAt) + 1_000).toBe(row?.run_at.getTime());
    const queued = await queueRows(first.jobId);
    expect(queued.map((q) => q.run_at.getTime())).toEqual([row?.run_at.getTime()]);
    // The key is kept per starter: nobody else's items ever run as this member.
    expect(row?.dedupe_key).toBe(`member:${t.memberId}:attr-1`);

    // Once its first slice ran, a new start makes a new job.
    expect(await runnerFor(registry).runner.runSlice({ workspaceId: t.workspaceId, jobId: first.jobId })).toBe(
      'succeeded',
    );
    const later = await startCoalesced(t.member, [a]);
    expect(later.merged).toBe(false);
    expect(later.jobId).not.toBe(first.jobId);
  });

  it('keeps one waiting job per key when two starts race, and another member’s key apart', async () => {
    const t = await team(['member', 'admin', 'member']);
    const ids = Array.from({ length: 4 }, () => newId());
    const [one, two] = await Promise.all([
      startCoalesced(t.member, ids.slice(0, 2)),
      startCoalesced(t.member, ids.slice(2)),
    ]);
    expect(one.jobId).toBe(two.jobId);
    expect([one.merged, two.merged].sort()).toEqual([false, true]);
    expect((await getJob(t.member, registry, one.jobId)).total).toBe(4);
    const theirs = await startCoalesced(t.as(t.ids[2] ?? '', 'member'), [newId()]);
    expect(theirs.merged).toBe(false);
    expect(theirs.jobId).not.toBe(one.jobId);
    // The key must say the params too: joining with others is a programming error.
    await expect(startCoalesced(t.member, [newId()], { params: { tag: 'other' } })).rejects.toThrow('other params');
  });

  it('leaves a countsTowardLimit: false kind out of the 20 job limit, and needs its key', async () => {
    const t = await team();
    const simulate = jobKinds({ environment: 'local', extra: kinds });
    const tight = rescope(t.member, { limits: { unfinishedJobs: 1 } });
    await startCoalesced(tight, [newId()]);
    // The uncounted waiting job doesn't take the one slot.
    await runWrite(tight, (context) =>
      startJob(context, simulate, { kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
    );
    expect(
      await refusalOf(
        runWrite(tight, (context) =>
          startJob(context, simulate, { kind: 'dev.simulate', params: { batchMillis: 0 }, items: [newId()] }),
        ),
      ),
    ).toMatchObject({ code: 'LIMIT_REACHED' });
    // Never LIMIT_REACHED for it, even with the slot taken.
    const other = await startCoalesced(tight, [newId()], { dedupeKey: 'attr-2' });
    expect(other.merged).toBe(false);
    await expect(
      runWrite(tight, (context) =>
        startJob(context, simulate, { kind: 'test.coalesced', params: {}, items: [newId()] }),
      ),
    ).rejects.toThrow('dedupeKey');
  });

  it('starts a system kind once per once key, from a member’s write, and refuses a once key on a member kind', async () => {
    const t = await team();
    const once = (scope: Parameters<typeof runWrite>[0], onceKey: string) =>
      runWrite(scope, (context) => startJob(context, registry, { kind: 'test.daily', params: {}, onceKey })).then(
        ({ result }) => result,
      );
    const first = await once(systemScope(db, t.workspaceId), 'maintenance:2026-10-12');
    const again = await once(t.member, 'maintenance:2026-10-12');
    expect(again).toEqual({ jobId: first.jobId, merged: false });
    const next = await once(systemScope(db, t.workspaceId), 'maintenance:2026-10-13');
    expect(next.jobId).not.toBe(first.jobId);
    expect((await jobRow(first.jobId))?.once_key).toBe('maintenance:2026-10-12');
    await expect(
      runWrite(t.member, (context) =>
        startJob(context, registry, { kind: 'test.ending', params: {}, onceKey: 'x', items: [newId()] }),
      ),
    ).rejects.toThrow('onceKey');
  });

  it('holds a job started for later until its time: the job and its queue row both say when', async () => {
    const t = await team();
    const runAt = new Date(Date.now() + 10 * 60_000);
    const { result } = await runWrite(
      t.member,
      (context) => startJob(context, registry, { kind: 'test.ending', params: {}, items: [newId()], runAt }),
      [outboxHook()],
    );
    expect((await jobRow(result.jobId))?.run_at.getTime()).toBe(runAt.getTime());
    expect((await queueRows(result.jobId)).map((row) => row.run_at.getTime())).toEqual([runAt.getTime()]);
    expect(await getJob(t.member, registry, result.jobId)).toMatchObject({ status: 'queued' });
    // Its events: the start's, under its starter.
    expect((await jobEvents(t.workspaceId)).map((event) => event.item_ids)).toEqual([[result.jobId]]);
  });
});
