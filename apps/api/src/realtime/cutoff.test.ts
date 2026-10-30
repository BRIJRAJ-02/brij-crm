// The durable cut off (late trap #41) against the test database: who it cuts
// (removed members' users, never an active one), the disconnect when
// Centrifugo refuses the unsubscribe, a plain throw for Graphile's backoff
// when neither lands, an end once the tokens have run out, and the task run
// for real on the light runner, queued through the relay's reader and tried
// again after a failure. Centrifugo's two calls are stand ins that record what
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
  CUTOFF_TASK,
  cutOffTask,
  REMOVED,
  runCutOff,
  type CutOffDeps,
} from './cutoff.ts';

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
function deps(options: { unsubscribe?: boolean; disconnect?: boolean; now?: number } = {}): CutOffDeps & Recorded {
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
    ...(options.now === undefined ? {} : { now: () => options.now ?? 0 }),
  };
}

const FIRST = { attempt: 1, maxAttempts: CUTOFF_MAX_ATTEMPTS };

describe('the durable cut off (late trap #41)', () => {
  it('keys its queue row by the workspace and seq, ids only, with tries that outlast the token’s hour', () => {
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
    // Graphile waits e^n seconds after the nth failure: the last try comes within the token's hour, and one more
    // would come after it, when there is nothing left to cut.
    const until = (tries: number) =>
      Array.from({ length: tries - 1 }, (_, n) => Math.exp(n + 1)).reduce((sum, wait) => sum + wait, 0);
    expect(until(CUTOFF_MAX_ATTEMPTS)).toBeLessThan(3_600);
    expect(until(CUTOFF_MAX_ATTEMPTS + 1)).toBeGreaterThan(3_600);
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
    expect(await runCutOff(run, payload, FIRST)).toBe('unsubscribed');
    expect(run.unsubscribed).toEqual([{ channel: `workspace:${workspaceId}`, userIds: [gone.userId] }]);
    expect(run.disconnected).toEqual([]);
    // Again (a retry, the relay's own try before it): the same call, harmless.
    expect(await runCutOff(run, payload, FIRST)).toBe('unsubscribed');
    // Nobody removed is left: nothing to call.
    const none = deps();
    expect(await runCutOff(none, { ...payload, memberIds: [back.memberId, left.memberId] }, FIRST)).toBe('none');
    expect(none.unsubscribed).toEqual([]);
    // The log names the workspace and counts, never a user.
    expect(JSON.stringify(run.lines)).not.toContain(gone.userId);
  });

  it('closes their connections once Centrifugo keeps refusing the unsubscribe, and throws plainly when that fails too', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const payload = { workspaceId, memberIds: [gone.memberId], at: new Date().toISOString() };
    // A first refusal is only tried again: closing drops their tabs in every workspace.
    const early = deps({ unsubscribe: false });
    await expect(runCutOff(early, payload, FIRST)).rejects.toThrow();
    expect(early.disconnected).toEqual([]);
    const fallback = deps({ unsubscribe: false });
    const third = { attempt: CUTOFF_FALLBACK_FROM, maxAttempts: CUTOFF_MAX_ATTEMPTS };
    expect(await runCutOff(fallback, payload, third)).toBe('disconnected');
    expect(fallback.disconnected).toEqual([{ userId: gone.userId, why: REMOVED }]);
    expect(REMOVED.code).toBe(4501);

    const down = deps({ unsubscribe: false, disconnect: false });
    await expect(runCutOff(down, payload, third)).rejects.toThrow(
      'Cutting removed members off the live channel failed; the worker log has the workspace id.',
    );
    expect(down.lines.find((line) => line.message === 'realtime.cutoff.retry')).toMatchObject({
      level: 'warn',
      fields: { reason: 'centrifugo', users: 1 },
    });
    // The last try says so at error.
    const last = deps({ unsubscribe: false, disconnect: false });
    await expect(
      runCutOff(last, payload, { attempt: CUTOFF_MAX_ATTEMPTS, maxAttempts: CUTOFF_MAX_ATTEMPTS }),
    ).rejects.toThrow();
    expect(last.lines.map((line) => `${line.level} ${line.message}`)).toContain('error realtime.cutoff.failed');
  });

  it('ends once the members’ tokens have run out, at error when its earlier tries failed', async () => {
    const workspaceId = await workspace();
    const gone = await member(workspaceId, true);
    const payload = { workspaceId, memberIds: [gone.memberId], at: new Date(Date.now() - 3_600_000).toISOString() };
    const late = deps();
    expect(await runCutOff(late, payload, FIRST)).toBe('lapsed');
    expect(late.unsubscribed).toEqual([]);
    expect(late.lines.map((line) => line.level)).toEqual(['info']);
    const failing = deps();
    expect(await runCutOff(failing, payload, { attempt: 4, maxAttempts: CUTOFF_MAX_ATTEMPTS })).toBe('lapsed');
    expect(failing.lines.map((line) => `${line.level} ${line.message}`)).toEqual(['error realtime.cutoff.lapsed']);
  });

  it('drops a payload that isn’t its own, with nothing to retry', async () => {
    const run = deps();
    expect(await runCutOff(run, { workspaceId: randomUUID(), memberIds: [], at: 'soon' }, FIRST)).toBe('invalid');
    expect(
      await runCutOff(
        run,
        { workspaceId: randomUUID(), memberIds: [randomUUID()], at: new Date().toISOString(), extra: 1 },
        FIRST,
      ),
    ).toBe('invalid');
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

  it('runs a row the relay’s reader queued, tries it again after a failure, and leaves no row once it lands', async () => {
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
      testQuery<{ attempts: number; max_attempts: number }>(
        ownerUrl,
        `select attempts, max_attempts from graphile_worker._private_jobs where key = $1`,
        [task.jobKey],
      );
    expect(await rows()).toEqual([{ attempts: 0, max_attempts: CUTOFF_MAX_ATTEMPTS }]);

    // Centrifugo down for the first try: Graphile tries again after e^1 seconds, and the second lands.
    const tries: number[] = [];
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
        tries.push(attempt.attempt);
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
      await expect.poll(() => tries, { timeout: 15_000, interval: 100 }).toEqual([1, 2]);
      await expect.poll(async () => (await rows()).length, { timeout: 5_000, interval: 100 }).toBe(0);
      expect(run.unsubscribed).toEqual([{ channel: `workspace:${workspaceId}`, userIds: [gone.userId] }]);
    } finally {
      await runners.stop();
    }
  });
});
