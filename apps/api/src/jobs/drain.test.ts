// The job drain (spec 0045), against its own test database on the worker
// login: a turn with nothing due ends at once without starting the runners; a
// due booking email runs and the turn ends idle with no queue row left; a
// second turn in the same instance answers busy; a slow task outlasting the
// budget ends the turn on its budget, the task finishing first; and the
// after request trigger runs one turn for a burst of wakes, plus one more.
import type { QueueRows } from '@crm/core';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { composeJobTasks, type JobTasks } from './compose.ts';
import { createDrainWake, createJobDrain, type DrainReport, type JobDrain } from './drain.ts';
import type { JobsLog } from './graphile.ts';
import { BOOKING_MAIL_TASK } from './booking-mail.ts';

const { appUrl, ownerUrl, workerUrl } = inject('drainDatabase');
const quiet: JobsLog = { info: () => undefined, warn: () => undefined, error: () => undefined };
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-drain-tests', maxConnections: 3 });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await testQuery(ownerUrl, 'delete from graphile_worker._private_jobs');
});

/** The worker's own tasks, with booking emails sent to `send` instead. */
function tasksWith(send: (payload: unknown) => Promise<void>, queue: QueueRows): JobTasks {
  const tasks = composeJobTasks({
    env: { APP_ENV: 'local', MAIL_FROM: 'Timefix <sign-in@crm.localhost>', calendar: undefined },
    db,
    onStored: () => undefined,
    queue,
  });
  return { ...tasks, bookingMail: send };
}

function drainWith(send: (payload: unknown) => Promise<void>): JobDrain {
  return createJobDrain({
    directUrl: workerUrl,
    compose: (queue) => tasksWith(send, queue),
    log: quiet,
    pollMs: 100,
  });
}

async function queueBookingMail(marker: string): Promise<void> {
  await testQuery(ownerUrl, `select graphile_worker.add_job($1, json_build_object('marker', $2::text))`, [
    BOOKING_MAIL_TASK,
    marker,
  ]);
}

async function queueRows(): Promise<number> {
  const rows = await testQuery<{ count: number }>(
    ownerUrl,
    'select count(*)::int as count from graphile_worker._private_jobs',
  );
  return rows[0]?.count ?? -1;
}

describe('the job drain', () => {
  it('ends at once when nothing it runs is due, without starting the runners', async () => {
    const sent: unknown[] = [];
    const report = await drainWith((payload) => {
      sent.push(payload);
      return Promise.resolve();
    }).run({ budgetMs: 10_000 });
    expect(report.outcome).toBe('nothing');
    expect(report.ms).toBeLessThan(5_000);
    expect(sent).toEqual([]);
  });

  it('runs a due booking email and ends idle, leaving no queue row', async () => {
    await queueBookingMail('first');
    const sent: unknown[] = [];
    const report = await drainWith((payload) => {
      sent.push(payload);
      return Promise.resolve();
    }).run({ budgetMs: 15_000 });
    expect(report.outcome).toBe('idle');
    expect(sent).toEqual([{ marker: 'first' }]);
    expect(await queueRows()).toBe(0);
  });

  it('answers busy for a second turn while one runs in the same instance', async () => {
    await queueBookingMail('slow');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drain = drainWith(() => held);
    const first = drain.run({ budgetMs: 15_000 });
    expect(drain.running()).toBe(true);
    expect(await drain.run({ budgetMs: 15_000 })).toEqual({ outcome: 'busy', ms: 0 });
    release();
    expect((await first).outcome).toBe('idle');
    expect(drain.running()).toBe(false);
  });

  it('ends on its budget while a task still runs, and the task finishes before the turn returns', async () => {
    await queueBookingMail('long');
    let finished = false;
    const report = await drainWith(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      finished = true;
    }).run({ budgetMs: 1_000 });
    expect(report.outcome).toBe('budget');
    expect(finished).toBe(true);
    expect(report.ms).toBeGreaterThanOrEqual(2_000);
    expect(await queueRows()).toBe(0);
  });

  it('runs the scheduled turn for at least its minimum, even with nothing due', async () => {
    const report = await drainWith(() => Promise.resolve()).run({ budgetMs: 10_000, minimumMs: 1_000 });
    expect(report.outcome).toBe('idle');
    expect(report.ms).toBeGreaterThanOrEqual(1_000);
  });
});

describe('the after request trigger', () => {
  it('waits out the cooldown before its next turn, and runs no second turn without enough budget left', async () => {
    let clock = 0;
    const starts: number[] = [];
    const drain: JobDrain = {
      run: () => {
        starts.push(clock);
        clock += 18_000;
        return Promise.resolve({ outcome: 'idle', ms: 18_000 });
      },
      running: () => false,
    };
    const kept: Promise<unknown>[] = [];
    const wake = createDrainWake({
      drain,
      keepAlive: (work) => kept.push(work),
      budgetMs: 20_000,
      cooldownMs: 20,
      log: quiet,
      now: () => clock,
    });
    wake();
    wake();
    await kept[0];
    // The second wake asked for one more, but only 2 seconds of the 20 were left.
    expect(starts).toEqual([0]);
  });

  it('runs one turn for a burst of wakes, then one more, kept alive by the platform', async () => {
    const turns: string[] = [];
    let finish: (report: DrainReport) => void = () => undefined;
    const drain: JobDrain = {
      run: () => {
        turns.push('turn');
        return turns.length === 1
          ? new Promise<DrainReport>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({ outcome: 'nothing', ms: 1 });
      },
      running: () => false,
    };
    const kept: Promise<unknown>[] = [];
    const wake = createDrainWake({
      drain,
      keepAlive: (work) => kept.push(work),
      budgetMs: 20_000,
      cooldownMs: 0,
      log: quiet,
    });
    wake();
    wake();
    wake();
    expect(kept).toHaveLength(1);
    finish({ outcome: 'idle', ms: 5 });
    await kept[0];
    expect(turns).toEqual(['turn', 'turn']);
    wake();
    expect(kept).toHaveLength(2);
    await kept[1];
    expect(turns).toHaveLength(3);
  });

  it('logs a failed turn and never rejects what it hands the platform', async () => {
    const errors: string[] = [];
    const drain: JobDrain = { run: () => Promise.reject(new Error('down')), running: () => false };
    const kept: Promise<unknown>[] = [];
    const wake = createDrainWake({
      drain,
      keepAlive: (work) => kept.push(work),
      budgetMs: 20_000,
      cooldownMs: 0,
      log: { ...quiet, error: (message) => errors.push(message) },
    });
    wake();
    await expect(kept[0]).resolves.toBeUndefined();
    expect(errors).toEqual(['jobs.drain.failed']);
  });
});
