// Automations' tables and functions (parity #53, migration 0142), against a real Postgres: the two tables are tenant
// tables nothing outside their workspace reads, an event runs once, a notice is one per member per run, the queue
// function queues the transaction's own workspace once, and the sweep names workspaces to the worker alone.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-automations-db-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A workspace with its owner, made the way the app makes one. */
async function workspace(name: string) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, ${name}, ${`${name}-${workspaceId}`}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${name}, ${`${name}@example.com`}, 'owner', 'system', 'system')`,
    );
  });
  return { workspaceId, memberId };
}

/** An enabled task due automation, which needs no object. */
async function dueAutomation(w: { workspaceId: string; memberId: string }, enabled = true) {
  const id = randomUUID();
  await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute(sql`
      insert into automations (workspace_id, id, trigger_kind, trigger, actions, enabled, run_as_member_id,
        created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
      values (${w.workspaceId}, ${id}, 'task_due', '{"kind":"task_due"}'::jsonb,
        '[{"kind":"notify","who":{"kind":"owner"}}]'::jsonb, ${enabled}, ${w.memberId},
        'member', ${w.memberId}, ${w.memberId}, 'member', ${w.memberId}, ${w.memberId})
    `),
  );
  return id;
}

describe('automations and their runs', () => {
  it('are read by their own workspace only, with no filter written', async () => {
    const a = await workspace('auto-a');
    const b = await workspace('auto-b');
    const id = await dueAutomation(a);
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`
        insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, event_key)
        values (${a.workspaceId}, ${id}, 'task', ${randomUUID()}, 'due:2026-10-31')
      `),
    );
    const seen = async (workspaceId: string, table: 'automations' | 'automation_runs') =>
      (await db.withWorkspace(workspaceId, (tx) => tx.execute(sql.raw(`select 1 from ${table}`)))).rowCount;
    expect(await seen(a.workspaceId, 'automations')).toBe(1);
    expect(await seen(a.workspaceId, 'automation_runs')).toBe(1);
    expect(await seen(b.workspaceId, 'automations')).toBe(0);
    expect(await seen(b.workspaceId, 'automation_runs')).toBe(0);
    // Nor can b write a run against a's automation: the foreign key carries the workspace.
    await expect(
      db.withWorkspace(b.workspaceId, (tx) =>
        tx.execute(sql`
          insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, event_key)
          values (${b.workspaceId}, ${id}, 'task', ${randomUUID()}, 'due:2026-10-31')
        `),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('keep one run for an automation, a subject and an event, however often it is offered', async () => {
    const w = await workspace('auto-once');
    const id = await dueAutomation(w);
    const subject = randomUUID();
    const insert = (key: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`
          insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, event_key)
          values (${w.workspaceId}, ${id}, 'task', ${subject}, ${key})
          on conflict (workspace_id, automation_id, subject_id, event_key) do nothing
        `),
      );
    expect((await insert('due:2026-10-31')).rowCount).toBe(1);
    expect((await insert('due:2026-10-31')).rowCount).toBe(0);
    expect((await insert('due:2026-11-01')).rowCount).toBe(1);
  });

  it('refuse an automation with no actions, more than three, or a trigger of the wrong shape', async () => {
    const w = await workspace('auto-shape');
    const insert = (trigger: string, kind: string, actions: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`
          insert into automations (workspace_id, trigger_kind, trigger, actions, run_as_member_id,
            created_by_type, updated_by_type)
          values (${w.workspaceId}, ${kind}, ${trigger}::jsonb, ${actions}::jsonb, ${w.memberId}, 'system', 'system')
        `),
      );
    const notify = '{"kind":"notify","who":{"kind":"owner"}}';
    await expect(insert('{"kind":"task_due"}', 'task_due', '[]')).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      insert('{"kind":"task_due"}', 'task_due', `[${notify},${notify},${notify},${notify}]`),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    // A record trigger names its object.
    await expect(insert('{"kind":"record_created"}', 'record_created', `[${notify}]`)).rejects.toMatchObject({
      cause: { code: '23514' },
    });
    expect((await insert('{"kind":"task_due"}', 'task_due', `[${notify}]`)).rowCount).toBe(1);
  });

  it('give a member one notice per run, and a notice needs its automation and run', async () => {
    const w = await workspace('auto-notice');
    const id = await dueAutomation(w);
    const run = randomUUID();
    const notify = () =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`
          insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, automation_id, automation_run_id)
          values (${w.workspaceId}, ${w.memberId}, 'automation', 'automation', ${id}, ${id}, ${run})
        `),
      );
    await notify();
    await expect(notify()).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`
          insert into notifications (workspace_id, member_id, kind, actor_type, actor_id)
          values (${w.workspaceId}, ${w.memberId}, 'automation', 'automation', ${id})
        `),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    // Deleting the automation takes its notices with it.
    await owner.query('delete from automations where workspace_id = $1 and id = $2', [w.workspaceId, id]);
    const left = await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`select 1 from notifications`));
    expect(left.rowCount).toBe(0);
  });
});

describe('crm_enqueue_automation', () => {
  const jobsFor = async (workspaceId: string) =>
    (
      await owner.query<{ payload: { workspaceId: string }; attempts: number; max_attempts: number }>(
        `select payload, attempts, max_attempts from graphile_worker._private_jobs j
         join graphile_worker._private_tasks t on t.id = j.task_id
         where t.identifier = 'crm_automation' and j.key = $1`,
        [`crm-automation:${workspaceId}`],
      )
    ).rows;

  it('queues the transaction’s own workspace once however often it is called, with the ids only', async () => {
    const w = await workspace('auto-queue');
    for (let n = 0; n < 3; n += 1) {
      const queued = await db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute<{ queued: boolean }>(sql`select crm_enqueue_automation() as queued`),
      );
      expect(queued.rows[0]?.queued).toBe(true);
    }
    const jobs = await jobsFor(w.workspaceId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({ workspaceId: w.workspaceId });
    expect(jobs[0]?.max_attempts).toBe(5);
  });
});

describe('crm_automation_due_workspaces', () => {
  it('names, to the worker alone, the live workspaces with an enabled task due automation', async () => {
    const withOne = await workspace('due-on');
    const withOff = await workspace('due-off');
    const without = await workspace('due-none');
    const deleted = await workspace('due-deleted');
    await dueAutomation(withOne);
    await dueAutomation(withOff, false);
    await dueAutomation(deleted);
    await owner.query('update workspaces set deleted_at = now() where id = $1', [deleted.workspaceId]);

    const worker = new pg.Client({ connectionString: workerUrl });
    await worker.connect();
    try {
      const page = await worker.query<{ id: string }>(
        'select id from crm_automation_due_workspaces(null, 500) as w(id)',
      );
      const ids = page.rows.map((row) => row.id);
      expect(ids).toEqual([...ids].sort());
      expect(ids).toContain(withOne.workspaceId);
      for (const other of [withOff, without, deleted]) expect(ids).not.toContain(other.workspaceId);
      const after = await worker.query<{ id: string }>('select id from crm_automation_due_workspaces($1, 1) as w(id)', [
        '00000000-0000-0000-0000-000000000000',
      ]);
      expect(after.rows.length).toBeLessThanOrEqual(1);
      // The tables themselves show the worker nothing.
      expect((await worker.query('select id from automations')).rowCount).toBe(0);
    } finally {
      await worker.end();
    }
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      await expect(app.query('select * from public.crm_automation_due_workspaces(null, 10)')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await app.end();
    }
  });
});
