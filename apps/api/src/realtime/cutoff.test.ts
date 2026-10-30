// The durable cut off (late trap #41) against the test database: who it cuts
// (removed members' users, never an active one), the disconnect when
// Centrifugo refuses the unsubscribe, a try queued again when neither lands,
// tries that keep coming every five minutes at most until the token's hour is
// over and then end, and the task run for real on the light runner, queued
// through the relay's reader and queued again by itself after a failure. Centrifugo's two calls are stand ins that record what
// they were asked; `centrifugo.test.ts` proves them on the real server.
import { randomUUID } from 'node:crypto';
import { createRunner, jobKinds, NO_RULE_SOURCE } from '@crm/core';
import { enterAsActor, removedUserIds, systemScope } from '@crm/core/system';
import {
  createDatabase,
  createOutboxReader,
  openDirectConnection,
  openQueueConnection,
  type Database,
  type QueueConnection,
} from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { backgroundHooks } from '../hooks.ts';
import { startJobRunners, type JobsLog } from '../jobs/graphile.ts';
import type { DisconnectReason } from './centrifugo.ts';
import {
  CUTOFF_DELAY_MS,
  CUTOFF_FALLBACK_FROM,
  CUTOFF_MAX_ATTEMPTS,
  CUTOFF_MAX_WAIT_MS,
  CUTOFF_TASK,
  CUTOFF_WINDOW_MS,
  cutOffTask,
  nextTryAt,
  REMOVED,
  runCutOff,
  type CutOffDeps,
  type CutOffResult,
} from './cutoff.ts';
import { REALTIME_TOKEN_SECONDS } from './tokens.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-cutoff-tests' });
});
afterAll(async () => {
  await db.close();
});

async function workspace(): Promise<string> {
  const id = randomUUID();
  await testQuery(
    ownerUrl,
    `insert into workspaces (id, name, slug, created_by_type, updated_by_type) values ($1, 'Cut off', $2, 'system', 'system')`,
    [id, `cutoff-${id}`],
  );
  return id;
}

/** A member with a user (a new one unless given), as the owner: removed (with when and by whom) or still active. */
async function member(
  workspaceId: string,
  removed: boolean,
  userId: string = randomUUID(),
): Promise<{ memberId: string; userId: string }> {
  const memberId = randomUUID();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, status, left_at, removed_by_type,
       created_by_type, updated_by_type)
     values ($1, $2, $3, 'Ada', $4, $5, $6, $7, 'system', 'system')`,
    [
      workspaceId,
      memberId,
      userId,
      `${memberId}@example.com`,
      removed ? 'removed' : 'active',
      removed ? new Date() : null,
      removed ? 'system' : null,
    ],
  );
  return { memberId, userId };
}

interface Recorded {
  readonly unsubscribed: { channel: string; userIds: readonly string[] }[];
  readonly disconnected: { userId: string; why: DisconnectReason }[];
  readonly lines: { level: string; message: string; fields: Record<string, unknown> }[];
}

/** The task's deps: the real read of who is removed, and Centrifugo stand ins that land or fail as asked. */
function deps(
  options: { unsubscribe?: boolean; disconnect?: boolean; now?: () => number } = {},
): CutOffDeps & Recorded {
  const recorded: Recorded = { unsubscribed: [], disconnected: [], lines: [] };
  const line =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      recorded.lines.push({ level, message, fields });
    };
  return {
    ...recorded,
    removedUserIds: (workspaceId, memberIds) => removedUserIds(systemScope(db, workspaceId), memberIds),
    unsubscribe: (channel, userIds) => {
      recorded.unsubscribed.push({ channel, userIds });
      return options.unsubscribe === false
        ? Promise.reject(new Error('Centrifugo could not be reached.'))
        : Promise.resolve();
    },
    disconnectUser: (userId, why) => {
      recorded.disconnected.push({ userId, why });
      return Promise.resolve(options.disconnect !== false);
    },
    log: { info: line('info'), warn: line('warn'), error: line('error') },
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

const FIRST = { attempt: 1, maxAttempts: CUTOFF_MAX_ATTEMPTS };

/** The next try's payload and time from a `retry`, or a failure naming what came back instead. */
function retried(result: CutOffResult): { payload: Record<string, unknown>; runAt: Date } {
  if (result.outcome !== 'retry') throw new Error(`Expected a retry, got ${result.outcome}.`);
  return result;
}

describe('the durable cut off (late trap #41)', () => {
  it('keys its queue row by the workspace and seq, ids only, its window the token issuer’s own life', () => {
    const workspaceId = randomUUID();
    const ada = randomUUID();
    const at = new Date().toISOString();
    const task = cutOffTask(workspaceId, 7, [ada, ada, 'not-a-member'], at, 1_000);
    expect(task).toEqual({
      identifier: CUTOFF_TASK,
      payload: { workspaceId, memberIds: [ada], at },
      jobKey: `crm-cutoff:${workspaceId}:7`,
      maxAttempts: CUTOFF_MAX_ATTEMPTS,
      runAt: new Date(1_000 + CUTOFF_DELAY_MS),
    });
    expect(CUTOFF_WINDOW_MS).toBe(REALTIME_TOKEN_SECONDS * 1_000);
    // The next try: e^n seconds, capped at five minutes, clamped to the hour's end, and never under a second on.
    const start = Date.parse(at);
    const end = start + CUTOFF_WINDOW_MS;
    expect(nextTryAt(1, at, start).getTime()).toBe(Math.trunc(start + Math.exp(1) * 1_000));
    expect(nextTryAt(9, at, start).getTime()).toBe(start + CUTOFF_MAX_WAIT_MS);
    expect(nextTryAt(9, at, end - 60_000).getTime()).toBe(end);
    expect(nextTryAt(9, at, end - 500).getTime()).toBe(end + 500);
    // A row naming no member queues nothing.
    expect(cutOffTask(workspaceId, 8, ['nobody'], at, 1_000)).toBeUndefined();
  });

  it('unsubscribes the removed members’ users from the workspace’s channel, and leaves one who joined again alone', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const back = await member(workspaceId, false);
    // Removed, then invited again and joined: a new active member row for the same user.
    const left = await member(workspaceId, true);
    await member(workspaceId, false, left.userId);
    const run = deps();
    const payload = {
      workspaceId,
      memberIds: [gone.memberId, back.memberId, left.memberId],
      at: new Date().toISOString(),
    };
    expect(await runCutOff(run, payload, FIRST)).toEqual({ outcome: 'unsubscribed' });
    expect(run.unsubscribed).toEqual([{ channel: `workspace:${workspaceId}`, userIds: [gone.userId] }]);
    expect(run.disconnected).toEqual([]);
    // Again (a retry, the relay's own try before it): the same call, harmless.
    expect(await runCutOff(run, payload, FIRST)).toEqual({ outcome: 'unsubscribed' });
    // Nobody removed is left: nothing to call.
    const none = deps();
    expect(await runCutOff(none, { ...payload, memberIds: [back.memberId, left.memberId] }, FIRST)).toEqual({
      outcome: 'none',
    });
    expect(none.unsubscribed).toEqual([]);
    // The log names the workspace and counts, never a user.
    expect(JSON.stringify(run.lines)).not.toContain(gone.userId);
  });

  it('closes their connections once Centrifugo keeps refusing the unsubscribe, and queues a retry when that fails too', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const payload = { workspaceId, memberIds: [gone.memberId], at: new Date().toISOString() };
    // A first refusal is only tried again: closing drops their tabs in every workspace.
    const early = deps({ unsubscribe: false });
    const again = retried(await runCutOff(early, payload, FIRST));
    expect(again.payload).toEqual({ ...payload, tried: 1 });
    expect(early.disconnected).toEqual([]);
    const fallback = deps({ unsubscribe: false });
    const third = { attempt: CUTOFF_FALLBACK_FROM, maxAttempts: CUTOFF_MAX_ATTEMPTS };
    expect(await runCutOff(fallback, payload, third)).toEqual({ outcome: 'disconnected' });
    expect(fallback.disconnected).toEqual([{ userId: gone.userId, why: REMOVED }]);
    expect(REMOVED.code).toBe(4501);

    const down = deps({ unsubscribe: false, disconnect: false });
    expect(retried(await runCutOff(down, payload, third)).payload).toMatchObject({ tried: CUTOFF_FALLBACK_FROM });
    expect(down.lines.find((line) => line.message === 'realtime.cutoff.retry')).toMatchObject({
      level: 'warn',
      fields: { reason: 'centrifugo', users: 1 },
    });
    // Many users: closed in batches, and a batch with a failure stops the rest until the next try.
    const many = await Promise.all(Array.from({ length: 45 }, () => member(workspaceId, true)));
    const batched = deps({ unsubscribe: false, disconnect: false });
    const crowd = { ...payload, memberIds: many.map((m) => m.memberId) };
    expect((await runCutOff(batched, crowd, third)).outcome).toBe('retry');
    expect(batched.disconnected).toHaveLength(20);
    const all = deps({ unsubscribe: false });
    expect(await runCutOff(all, crowd, third)).toEqual({ outcome: 'disconnected' });
    expect(new Set(all.disconnected.map((d) => d.userId)).size).toBe(45);
    // A disconnect that throws is a refusal too: tried again, not thrown.
    const throwing = { ...deps({ unsubscribe: false }), disconnectUser: () => Promise.reject(new Error('down')) };
    expect((await runCutOff(throwing, payload, third)).outcome).toBe('retry');
    // Tries carried in the payload count: the second queue row's first try is the third, and falls back.
    const carried = deps({ unsubscribe: false });
    expect(await runCutOff(carried, { ...payload, tried: CUTOFF_FALLBACK_FROM - 1 }, FIRST)).toEqual({
      outcome: 'disconnected',
    });
  });

  it('keeps trying past Graphile’s half hour, at most five minutes apart, until the token’s hour is over', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    // Removed and joined again since: never cut, on any try.
    const left = await member(workspaceId, true);
    await member(workspaceId, false, left.userId);
    const start = Date.parse('2026-10-30T10:00:00.000Z');
    const at = new Date(start).toISOString();
    let clock = start + CUTOFF_DELAY_MS;
    const run = deps({ unsubscribe: false, disconnect: false, now: () => clock });
    let payload: unknown = { workspaceId, memberIds: [gone.memberId, left.memberId], at };
    const tries: number[] = [];
    let result: CutOffResult = { outcome: 'none' };
    // Centrifugo refuses the whole hour: run each queued row at its time, as the light runner would.
    for (let guard = 0; guard < 100; guard += 1) {
      tries.push(clock - start);
      result = await runCutOff(run, payload, FIRST);
      if (result.outcome !== 'retry') break;
      expect(result.runAt.getTime() - clock).toBeLessThanOrEqual(CUTOFF_MAX_WAIT_MS);
      payload = result.payload;
      clock = result.runAt.getTime();
    }
    expect(result).toEqual({ outcome: 'lapsed' });
    // Tries past minute 29 (Graphile's own backoff stopped there), none ever more than five minutes apart.
    expect(tries.filter((t) => t > 29 * 60_000 && t < CUTOFF_WINDOW_MS).length).toBeGreaterThanOrEqual(6);
    const gaps = tries.slice(1).map((t, i) => t - (tries[i] ?? 0));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(CUTOFF_MAX_WAIT_MS);
    // The last run lands on the token's hour exactly, and ends there at error: every token issued before the
    // removal has run out, and nothing cut them off.
    expect(tries.at(-1)).toBe(CUTOFF_WINDOW_MS);
    expect(tries.at(-2)).toBeLessThan(CUTOFF_WINDOW_MS);
    expect(run.lines.at(-1)).toMatchObject({ level: 'error', message: 'realtime.cutoff.lapsed' });
    expect(run.lines.filter((line) => line.level === 'error')).toHaveLength(1);
    // Only the removed member's user was ever asked about, the one who came back never.
    const asked = new Set([...run.unsubscribed.flatMap((u) => u.userIds), ...run.disconnected.map((d) => d.userId)]);
    expect([...asked]).toEqual([gone.userId]);
    // Ids and counts only in the log.
    expect(JSON.stringify(run.lines)).not.toContain(gone.userId);
  });

  it('ends once the members’ tokens have run out, at error when its earlier tries failed', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const payload = { workspaceId, memberIds: [gone.memberId], at: new Date(Date.now() - 3_600_000).toISOString() };
    const late = deps();
    expect(await runCutOff(late, payload, FIRST)).toEqual({ outcome: 'lapsed' });
    expect(late.unsubscribed).toEqual([]);
    expect(late.lines.map((line) => line.level)).toEqual(['info']);
    const failing = deps();
    expect(await runCutOff(failing, { ...payload, tried: 3 }, FIRST)).toEqual({ outcome: 'lapsed' });
    expect(failing.lines.map((line) => `${line.level} ${line.message}`)).toEqual(['error realtime.cutoff.lapsed']);
  });

  it('drops a payload that isn’t its own, with nothing to retry', async () => {
    const run = deps();
    expect(await runCutOff(run, { workspaceId: randomUUID(), memberIds: [], at: 'soon' }, FIRST)).toEqual({
      outcome: 'invalid',
    });
    expect(
      await runCutOff(
        run,
        { workspaceId: randomUUID(), memberIds: [randomUUID()], at: new Date().toISOString(), extra: 1 },
        FIRST,
      ),
    ).toEqual({ outcome: 'invalid' });
    // A try count past any the hour holds is not ours either.
    expect(
      await runCutOff(
        run,
        { workspaceId: randomUUID(), memberIds: [randomUUID()], at: new Date().toISOString(), tried: 1_000 },
        FIRST,
      ),
    ).toEqual({ outcome: 'invalid' });
    expect(run.unsubscribed).toEqual([]);
  });
});

describe('the cut off on the light runner', () => {
  let queue: QueueConnection;
  beforeAll(() => {
    queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-cutoff-tests-queue', max: 4 });
  });
  afterAll(async () => {
    await queue.close();
  });
  const quiet: JobsLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

  it('runs a row the relay’s reader queued, queues its next try under the same key after a failure, and leaves no row once it lands', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const task = cutOffTask(workspaceId, 1, [gone.memberId], new Date().toISOString(), Date.now() - CUTOFF_DELAY_MS);
    if (task === undefined) throw new Error('A row naming a member queues a task.');
    // Queued on the relay's own connection (the worker's login), twice: the key keeps one row.
    const reader = createOutboxReader(
      await openDirectConnection({ url: workerUrl, applicationName: 'crm-cutoff-tests-reader', proveListen: false }),
    );
    try {
      await reader.queueTask(task);
      await reader.queueTask(task);
    } finally {
      await reader.close();
    }
    const rows = () =>
      testQuery<{ attempts: number; max_attempts: number; tried: number | null }>(
        ownerUrl,
        `select attempts, max_attempts, (payload->>'tried')::int as tried
           from graphile_worker._private_jobs where key = $1`,
        [task.jobKey],
      );
    // Every row this task ever had (a re-queue gives the running row's key up), for none left behind.
    const all = () =>
      testQuery<{ id: string }>(
        ownerUrl,
        `select id from graphile_worker._private_jobs where task_id = (
           select id from graphile_worker._private_tasks where identifier = $1) and payload->>'workspaceId' = $2`,
        [CUTOFF_TASK, workspaceId],
      );
    expect(await rows()).toEqual([{ attempts: 0, max_attempts: CUTOFF_MAX_ATTEMPTS, tried: null }]);

    // Centrifugo down for the first try: the task queues its next try itself, e^1 seconds on under the same key,
    // with the try counted in the payload, and that one lands.
    const tries: { attempt: number; tried: unknown }[] = [];
    let up = false;
    const run = deps();
    const runners = await startJobRunners({
      queue,
      runner: createRunner({
        db,
        registry: jobKinds({ environment: 'local' }),
        enterAsActor: (input) => enterAsActor({ db, rules: NO_RULE_SOURCE }, input),
        systemScope: (id) => systemScope(db, id),
        hooks: backgroundHooks,
        log: quiet,
      }),
      log: quiet,
      pollInterval: 200,
      cutOff: (payload, attempt) => {
        tries.push({
          attempt: attempt.attempt,
          tried: typeof payload === 'object' && payload !== null && 'tried' in payload ? payload.tried : undefined,
        });
        const landed = up;
        up = true;
        return runCutOff(
          {
            ...run,
            unsubscribe: landed ? run.unsubscribe : () => Promise.reject(new Error('down')),
            disconnectUser: () => Promise.resolve(false),
          },
          payload,
          attempt,
        );
      },
    });
    try {
      await expect.poll(() => tries.length, { timeout: 15_000, interval: 100 }).toBe(1);
      await expect
        .poll(rows, { timeout: 5_000, interval: 100 })
        .toEqual([{ attempts: 0, max_attempts: CUTOFF_MAX_ATTEMPTS, tried: 1 }]);
      await expect.poll(() => tries.length, { timeout: 15_000, interval: 100 }).toBe(2);
      expect(tries).toEqual([
        { attempt: 1, tried: undefined },
        { attempt: 1, tried: 1 },
      ]);
      await expect.poll(async () => (await all()).length, { timeout: 5_000, interval: 100 }).toBe(0);
      expect(run.unsubscribed).toEqual([{ channel: `workspace:${workspaceId}`, userIds: [gone.userId] }]);
    } finally {
      await runners.stop();
    }
  });
});
