// The queue's guard tests (spec 0008, AC-102, AC-115): Graphile Worker's
// tables are the one place outside row level security, so the app can't read
// or change them and reaches them only through `crm_enqueue_job`, which builds
// the queue row itself (ids only) for a runnable job of the caller's own
// workspace. `crm_queue` and `crm_worker` hold exactly the rights listed for
// the pinned Graphile 0.18.0, so an upgrade that renames a table fails here
// first.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import { QUEUE_ROLE_RIGHTS, QUEUE_SCHEMA } from './migrations.ts';
import { openQueueConnection } from './queue.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-queue-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A workspace with its owner member, made inside `withWorkspace` as the app makes them. */
async function workspaceWithMember(name: string) {
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

/** A job row in `status`, as the app writes one. */
async function jobIn(
  workspaceId: string,
  memberId: string,
  status: string,
  lane: 'heavy' | 'light' = 'heavy',
  id: string = randomUUID(),
): Promise<string> {
  const finished = ['succeeded', 'failed', 'cancelled'].includes(status);
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(sql`
      insert into jobs (workspace_id, id, kind, lane, status, params, priority, created_by_type, created_by_id,
        created_by_member_id, finished_at)
      values (${workspaceId}, ${id}, 'dev.simulate', ${lane}, ${status}, '{}'::jsonb, 0, 'member', ${memberId},
        ${memberId}, ${finished ? sql`now()` : null})
    `),
  );
  return id;
}

/** The queue rows of a job (by its workspace and id, as the payload names them), as the owner sees them. */
async function queueRows(workspaceId: string, jobId: string) {
  const result = await owner.query<{
    key: string;
    task: string;
    queue: string | null;
    payload: unknown;
    priority: number;
    max_attempts: number;
  }>(
    `select v.key, task_identifier as task, queue_name as queue, j.payload, j.priority, j.max_attempts
     from ${QUEUE_SCHEMA}.jobs v join ${QUEUE_SCHEMA}._private_jobs j on j.id = v.id
     where j.payload->>'workspaceId' = $1 and j.payload->>'jobId' = $2`,
    [workspaceId, jobId],
  );
  return result.rows;
}

const enqueue = (workspaceId: string, jobId: string) =>
  db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ queued: boolean }>(sql`select crm_enqueue_job(${jobId}::uuid) as queued`);
    return result.rows[0]?.queued;
  });

describe('crm_enqueue_job', () => {
  it('queues a runnable job of the caller’s workspace, ids only, on its lane, under its key', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-heavy');
    const heavy = await jobIn(workspaceId, memberId, 'queued');
    const light = await jobIn(workspaceId, memberId, 'running', 'light');
    expect(await enqueue(workspaceId, heavy)).toBe(true);
    expect(await enqueue(workspaceId, light)).toBe(true);
    expect(await queueRows(workspaceId, heavy)).toEqual([
      {
        key: `crm-job:${workspaceId}:${heavy}`,
        task: 'crm_job_heavy',
        queue: `heavy:${workspaceId}`,
        payload: { workspaceId, jobId: heavy },
        priority: 0,
        max_attempts: 25,
      },
    ]);
    expect(await queueRows(workspaceId, light)).toEqual([
      {
        key: `crm-job:${workspaceId}:${light}`,
        task: 'crm_job_light',
        queue: null,
        payload: { workspaceId, jobId: light },
        priority: 0,
        max_attempts: 25,
      },
    ]);
  });

  it('replaces a waiting row rather than adding a second one', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-replace');
    const job = await jobIn(workspaceId, memberId, 'queued');
    await enqueue(workspaceId, job);
    await enqueue(workspaceId, job);
    expect(await queueRows(workspaceId, job)).toHaveLength(1);
  });

  it('keeps two workspaces’ jobs with the same id apart: each keeps its own row', async () => {
    const a = await workspaceWithMember('queue-same-a');
    const b = await workspaceWithMember('queue-same-b');
    const id = randomUUID();
    await jobIn(a.workspaceId, a.memberId, 'queued', 'heavy', id);
    await jobIn(b.workspaceId, b.memberId, 'queued', 'heavy', id);
    expect(await enqueue(a.workspaceId, id)).toBe(true);
    expect(await enqueue(b.workspaceId, id)).toBe(true);
    expect(await queueRows(a.workspaceId, id)).toHaveLength(1);
    expect(await queueRows(b.workspaceId, id)).toHaveLength(1);
  });

  it('refuses another workspace’s job, a finished one, and one outside any workspace', async () => {
    const a = await workspaceWithMember('queue-a');
    const b = await workspaceWithMember('queue-b');
    const theirs = await jobIn(b.workspaceId, b.memberId, 'queued');
    expect(await enqueue(a.workspaceId, theirs)).toBe(false);
    for (const status of ['succeeded', 'failed', 'cancelled', 'ready']) {
      const job = await jobIn(a.workspaceId, a.memberId, status);
      expect(await enqueue(a.workspaceId, job), status).toBe(false);
      expect(await queueRows(a.workspaceId, job), status).toEqual([]);
    }
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const outside = await app.query<{ queued: boolean }>('select crm_enqueue_job($1) as queued', [theirs]);
      expect(outside.rows).toEqual([{ queued: false }]);
    } finally {
      await app.end();
    }
    expect(await queueRows(b.workspaceId, theirs)).toEqual([]);
  });
});

describe('crm_enqueue_calendar_sync (spec 0024)', () => {
  /** A connection in `status`, as the app writes one. */
  const connectionIn = async (workspaceId: string, memberId: string, status: string, email = 'ada@example.com') => {
    const id = randomUUID();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`
        insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${workspaceId}, ${id}, ${memberId}, 'google', ${email}, ${status}, '\\x00'::bytea,
          'member', ${memberId}, ${memberId}, 'member', ${memberId}, ${memberId})
      `),
    );
    return id;
  };
  const queueSync = (workspaceId: string, connectionId: string) =>
    db.withWorkspace(workspaceId, async (tx) => {
      const result = await tx.execute<{ queued: boolean }>(
        sql`select crm_enqueue_calendar_sync(${connectionId}::uuid) as queued`,
      );
      return result.rows[0]?.queued;
    });
  const syncRows = (connectionId: string) =>
    owner
      .query<{ key: string; task: string; queue: string; payload: unknown; max_attempts: number }>(
        `select v.key, task_identifier as task, queue_name as queue, j.payload, j.max_attempts
         from ${QUEUE_SCHEMA}.jobs v join ${QUEUE_SCHEMA}._private_jobs j on j.id = v.id
         where j.payload->>'connectionId' = $1`,
        [connectionId],
      )
      .then((result) => result.rows);

  it('queues a connection of the caller’s workspace, ids only, one row per connection on its own queue', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('calendar-queue');
    const connectionId = await connectionIn(workspaceId, memberId, 'syncing');
    expect(await queueSync(workspaceId, connectionId)).toBe(true);
    expect(await queueSync(workspaceId, connectionId)).toBe(true);
    expect(await syncRows(connectionId)).toEqual([
      {
        key: `crm-calendar:${workspaceId}:${connectionId}`,
        task: 'crm_calendar_sync',
        queue: `calendar:${workspaceId}:${connectionId}`,
        payload: { workspaceId, connectionId },
        max_attempts: 25,
      },
    ]);
  });

  it('refuses another workspace’s connection, a stopped one, and one outside any workspace', async () => {
    const a = await workspaceWithMember('calendar-queue-a');
    const b = await workspaceWithMember('calendar-queue-b');
    const theirs = await connectionIn(b.workspaceId, b.memberId, 'connected');
    expect(await queueSync(a.workspaceId, theirs)).toBe(false);
    for (const status of ['expired', 'revoked', 'failed']) {
      const stopped = await connectionIn(a.workspaceId, a.memberId, status, `${status}@example.com`);
      expect(await queueSync(a.workspaceId, stopped), status).toBe(false);
      expect(await syncRows(stopped), status).toEqual([]);
    }
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const outside = await app.query<{ queued: boolean }>('select crm_enqueue_calendar_sync($1) as queued', [theirs]);
      expect(outside.rows).toEqual([{ queued: false }]);
      // The app reads no queue row itself.
      await expect(app.query(`select * from ${QUEUE_SCHEMA}._private_jobs`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
    expect(await syncRows(theirs)).toEqual([]);
  });

  it('lets crm_queue read three columns of a connection and never its tokens', async () => {
    const columns = await owner.query<{ column: string }>(`
      select att.attname as column from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_queue'::regrole and att.attrelid = 'public.calendar_connections'::regclass
        and a.privilege_type = 'SELECT'
      order by 1
    `);
    expect(columns.rows.map((row) => row.column)).toEqual(['id', 'status', 'workspace_id']);
  });
});

describe('crm_enqueue_email (the emails lane)', () => {
  /** An email row in `status`, as core's queueEmail writes one. */
  const emailIn = async (workspaceId: string, memberId: string, status: string) => {
    const id = randomUUID();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`
        insert into emails (workspace_id, id, kind, key, to_member_id, params, status, sent_at, created_by_type)
        values (${workspaceId}, ${id}, 'mention', ${`mention:${id}`}, ${memberId}, '{}'::jsonb, ${status}::email_status,
          ${status === 'sent' ? sql`now()` : null}, 'system')
      `),
    );
    return id;
  };
  const queueEmail = (workspaceId: string, emailId: string) =>
    db.withWorkspace(workspaceId, async (tx) => {
      const result = await tx.execute<{ queued: boolean }>(sql`select crm_enqueue_email(${emailId}::uuid) as queued`);
      return result.rows[0]?.queued;
    });
  const emailRows = (emailId: string) =>
    owner
      .query<{ key: string; task: string; queue: string | null; payload: unknown; max_attempts: number }>(
        `select v.key, task_identifier as task, queue_name as queue, j.payload, j.max_attempts
         from ${QUEUE_SCHEMA}.jobs v join ${QUEUE_SCHEMA}._private_jobs j on j.id = v.id
         where j.payload->>'emailId' = $1`,
        [emailId],
      )
      .then((result) => result.rows);

  it('queues a queued email of the caller’s workspace, ids only, one row per email', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('email-queue');
    const emailId = await emailIn(workspaceId, memberId, 'queued');
    expect(await queueEmail(workspaceId, emailId)).toBe(true);
    expect(await queueEmail(workspaceId, emailId)).toBe(true);
    expect(await emailRows(emailId)).toEqual([
      {
        key: `crm-email:${workspaceId}:${emailId}`,
        task: 'crm_email',
        queue: `email:${workspaceId}`,
        payload: { workspaceId, emailId },
        max_attempts: 11,
      },
    ]);
  });

  it('refuses another workspace’s email, a finished one, and one outside any workspace', async () => {
    const a = await workspaceWithMember('email-queue-a');
    const b = await workspaceWithMember('email-queue-b');
    const theirs = await emailIn(b.workspaceId, b.memberId, 'queued');
    expect(await queueEmail(a.workspaceId, theirs)).toBe(false);
    for (const status of ['sent', 'skipped', 'failed']) {
      const finished = await emailIn(a.workspaceId, a.memberId, status);
      expect(await queueEmail(a.workspaceId, finished), status).toBe(false);
      expect(await emailRows(finished), status).toEqual([]);
    }
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const outside = await app.query<{ queued: boolean }>('select crm_enqueue_email($1) as queued', [theirs]);
      expect(outside.rows).toEqual([{ queued: false }]);
    } finally {
      await app.end();
    }
    expect(await emailRows(theirs)).toEqual([]);
  });

  it('lets crm_queue read three columns of an email and never its params or address', async () => {
    const columns = await owner.query<{ column: string }>(`
      select att.attname as column from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_queue'::regrole and att.attrelid = 'public.emails'::regclass
        and a.privilege_type = 'SELECT'
      order by 1
    `);
    expect(columns.rows.map((row) => row.column)).toEqual(['id', 'status', 'workspace_id']);
  });
});

describe('queue keys against Graphile 0.18.0 (spec 0008, Queue keys)', () => {
  /** A job's queue rows with what decides whether Graphile runs them. */
  const rows = (jobId: string) =>
    owner
      .query<{ id: string; key: string | null; locked: boolean; run_at: Date; attempts: number; max_attempts: number }>(
        `select j.id::text as id, j.key, j.locked_at is not null as locked, j.run_at, j.attempts, j.max_attempts
         from ${QUEUE_SCHEMA}._private_jobs j where j.payload->>'jobId' = $1 order by j.id`,
        [jobId],
      )
      .then((result) => result.rows);
  const lockAs = (id: string, worker: string, age = '0 seconds') =>
    owner.query(
      `update ${QUEUE_SCHEMA}._private_jobs set locked_by = $1, locked_at = now() - $2::interval where id = $3::bigint`,
      [worker, age, id],
    );
  const enqueueAt = (workspaceId: string, jobId: string, at: string) =>
    db.withWorkspace(workspaceId, (tx) => tx.execute(sql`select crm_enqueue_job(${jobId}::uuid, ${at}::timestamptz)`));

  it('hands over while the current row is locked: one available row at the new time, the old one deleted when its call returns', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-hand-over');
    const job = await jobIn(workspaceId, memberId, 'running');
    await enqueue(workspaceId, job);
    const [held] = await rows(job);
    if (held === undefined) throw new Error('No queue row.');
    await lockAs(held.id, 'worker-hand-over');
    const next = new Date(Date.now() + 60_000).toISOString();
    await enqueueAt(workspaceId, job, next);
    const during = await rows(job);
    expect(during).toHaveLength(2);
    // add_jobs cleared the held row's key and used up its attempts; the new row carries the key and the time.
    expect(during[0]).toMatchObject({ id: held.id, key: null, locked: true });
    expect(during[0]?.attempts).toBe(during[0]?.max_attempts);
    expect(during[1]).toMatchObject({ key: `crm-job:${workspaceId}:${job}`, locked: false, attempts: 0 });
    expect(during[1]?.run_at.toISOString()).toBe(next);
    // The call returns: Graphile's runner deletes the held row, as it completes any (by id, on the worker login).
    const worker = new pg.Client({ connectionString: workerUrl });
    await worker.connect();
    try {
      await worker.query(`delete from ${QUEUE_SCHEMA}._private_jobs where id = $1::bigint`, [held.id]);
    } finally {
      await worker.end();
    }
    expect((await rows(job)).map((row) => row.key)).toEqual([`crm-job:${workspaceId}:${job}`]);
  });

  it('leaves a dead row after a hand over whose process died: freed by the stale release, it never runs again', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-dead');
    const job = await jobIn(workspaceId, memberId, 'running');
    await enqueue(workspaceId, job);
    const [held] = await rows(job);
    if (held === undefined) throw new Error('No queue row.');
    const deadWorker = `dead-${randomUUID()}`;
    await lockAs(held.id, deadWorker, '10 minutes');
    await enqueue(workspaceId, job);
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      expect(await queue.releaseStaleLocks()).toBeGreaterThanOrEqual(1);
    } finally {
      await queue.close();
    }
    const after = await rows(job);
    expect(after.map((row) => ({ key: row.key, locked: row.locked }))).toEqual([
      { key: null, locked: false },
      { key: `crm-job:${workspaceId}:${job}`, locked: false },
    ]);
    // Its attempts are used up, so Graphile never hands it out; the backlog doesn't count it either.
    expect(after[0]?.attempts).toBe(after[0]?.max_attempts);
  });

  it('names the jobs that still have a row and deletes the dead rows, for the daily cleanup (AC-112, AC-121)', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-cleanup');
    const other = await workspaceWithMember('queue-cleanup-other');
    const waiting = await jobIn(workspaceId, memberId, 'queued');
    const held = await jobIn(workspaceId, memberId, 'running');
    const killed = await jobIn(workspaceId, memberId, 'running');
    const none = await jobIn(workspaceId, memberId, 'queued');
    // The same id in another workspace, queued there: it never answers for this workspace's job.
    const twin = await jobIn(other.workspaceId, other.memberId, 'queued', 'heavy', none);
    for (const job of [waiting, held, killed]) await enqueue(workspaceId, job);
    await enqueue(other.workspaceId, twin);
    const [heldRow] = await rows(held);
    if (heldRow === undefined) throw new Error('No queue row.');
    await lockAs(heldRow.id, `live-${randomUUID()}`);
    // A hand over killed mid call: the old row dead (no key, attempts used up, freed), a new one waiting.
    const [killedRow] = await rows(killed);
    if (killedRow === undefined) throw new Error('No queue row.');
    await lockAs(killedRow.id, `dead-${randomUUID()}`, '10 minutes');
    await enqueue(workspaceId, killed);
    await owner.query(
      `update ${QUEUE_SCHEMA}._private_jobs set locked_by = null, locked_at = null where id = $1::bigint`,
      [killedRow.id],
    );
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      expect([...(await queue.rows(workspaceId, [waiting, held, killed, none]))].sort()).toEqual(
        [waiting, held, killed].sort(),
      );
      expect(await queue.rows(workspaceId, [])).toEqual([]);
      expect(await queue.deleteDead()).toBeGreaterThanOrEqual(1);
      // The dead row went; the waiting, the locked and the new rows stay.
      expect((await rows(killed)).map((row) => row.key)).toEqual([`crm-job:${workspaceId}:${killed}`]);
      expect(await rows(held)).toHaveLength(1);
      expect(await rows(waiting)).toHaveLength(1);
      expect(await queue.deleteDead()).toBe(0);
    } finally {
      await queue.close();
      await owner.query(`delete from ${QUEUE_SCHEMA}._private_jobs where id = $1::bigint`, [heldRow.id]);
    }
  });
});

describe('what only the worker may do for the daily cleanup (spec 0008, milestone 3)', () => {
  it('lists the workspaces not deleted and prunes the outbox on the worker login', async () => {
    const a = await workspaceWithMember('queue-sweep-a');
    const b = await workspaceWithMember('queue-sweep-b');
    await owner.query('update workspaces set deleted_at = now() where id = $1', [b.workspaceId]);
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      const all: string[] = [];
      for (let after: string | undefined; ;) {
        const page = await queue.workspaceIds(after, 2);
        all.push(...page);
        after = page.at(-1);
        if (page.length < 2) break;
      }
      expect(all).toContain(a.workspaceId);
      expect(all).not.toContain(b.workspaceId);
      expect(all).toEqual([...all].sort());
      expect(await queue.pruneOutbox()).toBeGreaterThanOrEqual(0);
    } finally {
      await queue.close();
    }
  });
});

describe('the daily digest’s members (spec 0038, AC-1178)', () => {
  it('names members whose digest is on and whose day reached 08:00 without one, ids only, on the worker login', async () => {
    const a = await workspaceWithMember('queue-digest-a');
    const b = await workspaceWithMember('queue-digest-b');
    const c = await workspaceWithMember('queue-digest-c');
    // A zone where it is past 08:00 now, and one where it isn't: 14 hours apart at most, so one of two works.
    const hour = new Date().getUTCHours();
    const pastEight = hour >= 8 ? 'UTC' : 'Pacific/Kiritimati';
    const beforeEight = hour < 8 ? 'UTC' : 'Pacific/Pago_Pago';
    const add = (workspaceId: string, memberId: string, zone: string, sentToday: boolean) =>
      db.withWorkspace(workspaceId, (tx) =>
        tx.execute(sql`
          insert into notification_settings (workspace_id, member_id, digest, time_zone, digest_sent_on)
          values (${workspaceId}, ${memberId}, true, ${zone},
            ${sentToday ? sql`(now() at time zone ${zone})::date` : sql`null`})
        `),
      );
    await add(a.workspaceId, a.memberId, pastEight, false);
    await add(b.workspaceId, b.memberId, pastEight, true);
    await add(c.workspaceId, c.memberId, beforeEight, false);
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      const due = await queue.digestsDue(undefined, 500);
      const ids = due.map((row) => row.memberId);
      const zoneHour = Number(
        new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: beforeEight }).format(
          new Date(),
        ),
      );
      expect(ids).toContain(a.memberId);
      expect(ids).not.toContain(b.memberId);
      if (zoneHour < 8) expect(ids).not.toContain(c.memberId);
      const after = await queue.digestsDue({ workspaceId: a.workspaceId, memberId: a.memberId }, 500);
      expect(after.map((row) => row.memberId)).not.toContain(a.memberId);
    } finally {
      await queue.close();
    }
  });
});

describe('the calendar health sweep (spec 0037, AC-1310, AC-1311)', () => {
  /** One connection of the member's in `status`, as a connect leaves it. */
  async function connection(workspaceId: string, memberId: string, status: string) {
    const id = randomUUID();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`
        insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${workspaceId}, ${id}, ${memberId}, 'google', ${`${id}@example.com`}, ${status}::calendar_status,
          '\\x00'::bytea, 'member', ${memberId}, ${memberId}, 'member', ${memberId}, ${memberId})
      `),
    );
    return id;
  }
  const episodeOf = async (workspaceId: string, id: string) =>
    (
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute<{ broken: string | null; notified: string | null; reminded: string | null }>(sql`
          select health_broken_at::text as broken, health_notified_at::text as notified,
            health_reminded_at::text as reminded
          from calendar_connections where id = ${id}::uuid
        `),
      )
    ).rows[0];
  const set = (workspaceId: string, id: string, assignments: ReturnType<typeof sql>) =>
    db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`update calendar_connections set ${assignments} where id = ${id}::uuid`),
    );

  it('opens an episode on a break, keeps it through failed then expired, and closes it on connected', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('health-episode');
    const id = await connection(workspaceId, memberId, 'connected');
    expect(await episodeOf(workspaceId, id)).toEqual({ broken: null, notified: null, reminded: null });
    await set(workspaceId, id, sql`status = 'failed'`);
    const opened = await episodeOf(workspaceId, id);
    expect(opened?.broken).not.toBeNull();
    await set(workspaceId, id, sql`health_notified_at = now()`);
    // Failed then expired is one episode: its start and its email stay.
    await set(workspaceId, id, sql`status = 'expired'`);
    expect(await episodeOf(workspaceId, id)).toMatchObject({
      broken: opened?.broken,
      notified: expect.any(String) as string,
    });
    // A failed connection retrying goes through syncing: still the same episode until it is connected.
    await set(workspaceId, id, sql`status = 'failed'`);
    await set(workspaceId, id, sql`status = 'syncing'`);
    expect((await episodeOf(workspaceId, id))?.broken).toBe(opened?.broken);
    await set(workspaceId, id, sql`status = 'connected'`);
    expect(await episodeOf(workspaceId, id)).toEqual({ broken: null, notified: null, reminded: null });
    await set(workspaceId, id, sql`status = 'expired'`);
    const again = await episodeOf(workspaceId, id);
    expect(again).toMatchObject({ notified: null, reminded: null });
    expect(again?.broken).not.toBeNull();
    expect(again?.broken).not.toBe(opened?.broken);
    // A new grant (expired to syncing) ends the episode even before its first sync works.
    await set(workspaceId, id, sql`health_notified_at = now()`);
    await set(workspaceId, id, sql`status = 'syncing'`);
    expect(await episodeOf(workspaceId, id)).toEqual({ broken: null, notified: null, reminded: null });
  });

  it('names a first email, then nothing, then the reminder 7 days on, then nothing, on the worker login', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('health-sweep');
    const healthy = await connection(workspaceId, memberId, 'connected');
    const broken = await connection(workspaceId, memberId, 'connected');
    await set(workspaceId, broken, sql`status = 'expired'`);
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    const mine = async () => (await queue.calendarHealthDue(200)).due.filter((row) => row.workspaceId === workspaceId);
    try {
      const sweep = await queue.calendarHealthDue(200);
      // Every other test's connections count too, so only lower bounds hold for the counts.
      expect(sweep.checked).toBeGreaterThanOrEqual(2);
      expect(sweep.newlyBroken).toBeGreaterThanOrEqual(1);
      const [first, ...rest] = await mine();
      expect(rest).toEqual([]);
      expect(first).toMatchObject({ connectionId: broken, reminder: false, fresh: true });
      expect(Date.parse(first?.episode ?? '')).not.toBeNaN();
      expect((await mine()).map((row) => row.connectionId)).not.toContain(healthy);
      await set(workspaceId, broken, sql`health_notified_at = now()`);
      expect(await mine()).toEqual([]);
      await set(workspaceId, broken, sql`health_notified_at = now() - interval '7 days 1 minute'`);
      expect(await mine()).toEqual([expect.objectContaining({ connectionId: broken, reminder: true, fresh: false })]);
      await set(workspaceId, broken, sql`health_reminded_at = now()`);
      expect(await mine()).toEqual([]);
      // A deleted workspace's connections are nobody's to tell.
      await set(workspaceId, broken, sql`status = 'connected'`);
      await set(workspaceId, broken, sql`status = 'failed'`);
      expect(await mine()).toHaveLength(1);
      await owner.query('update workspaces set deleted_at = now() where id = $1', [workspaceId]);
      expect(await mine()).toEqual([]);
    } finally {
      await queue.close();
    }
  });
});

describe('the check before the worker sleeps (spec 0008, milestone 3, AC-117)', () => {
  it('says whether a row is locked, when the next one is due, and whether an outbox row waits, on one clock', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-sleep');
    const job = await jobIn(workspaceId, memberId, 'queued');
    const runAt = new Date(Date.now() + 10 * 60_000);
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`select crm_enqueue_job(${job}::uuid, ${runAt.toISOString()}::timestamptz)`),
    );
    const objectId = randomUUID();
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(
        sql`insert into objects (workspace_id, id, api_slug, singular_name, plural_name, icon, hue, position, created_by_type, updated_by_type) values (${workspaceId}, ${objectId}, 'things', 'Thing', 'Things', 'box', 'gray', 0, 'system', 'system')`,
      );
      await tx.execute(
        sql`insert into outbox (workspace_id, seq, kind, object_id) values (${workspaceId}, 1, 'records', ${objectId})`,
      );
    });
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      const first = await queue.sleepCheck({ outbox: true, tasks: ['crm_job_heavy'] });
      expect(first.unpublished).toBe(true);
      expect(first.nextRunAt?.getTime()).toBeLessThanOrEqual(runAt.getTime());
      expect(Math.abs(first.now.getTime() - Date.now())).toBeLessThan(60_000);
      // A worker without a relay never publishes, so it never waits on the outbox.
      expect((await queue.sleepCheck({ outbox: false, tasks: ['crm_job_heavy'] })).unpublished).toBe(false);
      await owner.query(
        `update ${QUEUE_SCHEMA}._private_jobs set locked_by = 'sleep-test', locked_at = now() where key = $1`,
        [`crm-job:${workspaceId}:${job}`],
      );
      expect((await queue.sleepCheck({ outbox: false, tasks: ['crm_job_heavy'] })).locked).toBe(true);
      // Only the tasks this worker runs count: a row of a task nobody here takes never keeps it awake.
      const task = `test_sleep_${randomUUID().replaceAll('-', '')}`;
      const later = new Date(Date.now() + 20 * 60_000);
      await owner.query(`select ${QUEUE_SCHEMA}.add_job($1, '{}'::json, run_at => $2::timestamptz)`, [
        task,
        later.toISOString(),
      ]);
      expect((await queue.sleepCheck({ outbox: false, tasks: [task] })).nextRunAt?.toISOString()).toBe(
        later.toISOString(),
      );
      expect((await queue.sleepCheck({ outbox: false, tasks: [`${task}_none`] })).nextRunAt).toBeUndefined();
      await owner.query(
        `delete from ${QUEUE_SCHEMA}._private_jobs where task_id in (select id from ${QUEUE_SCHEMA}._private_tasks where identifier = $1)`,
        [task],
      );
    } finally {
      await queue.close();
      await owner.query(`delete from ${QUEUE_SCHEMA}._private_jobs where key = $1`, [`crm-job:${workspaceId}:${job}`]);
      await owner.query('delete from outbox where workspace_id = $1', [workspaceId]);
    }
  });
});

describe('the queue tables', () => {
  it('are closed to the app: no select, insert, update or delete, nor the schema', async () => {
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      for (const statement of [
        `select * from ${QUEUE_SCHEMA}._private_jobs`,
        `select * from ${QUEUE_SCHEMA}.jobs`,
        `update ${QUEUE_SCHEMA}._private_jobs set run_at = now()`,
        `delete from ${QUEUE_SCHEMA}._private_jobs`,
        `select ${QUEUE_SCHEMA}.add_job('crm_job_heavy')`,
        `select ${QUEUE_SCHEMA}.force_unlock_workers(array['x'])`,
      ]) {
        await expect(app.query(statement), statement).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await app.end();
    }
    const reach = await owner.query<{ usage: boolean }>(
      `select has_schema_privilege('crm_app', '${QUEUE_SCHEMA}', 'USAGE') as usage`,
    );
    expect(reach.rows).toEqual([{ usage: false }]);
  });

  it('give crm_queue exactly what add_job needs in 0.18.0', async () => {
    const tables = await owner.query<{ table: string; privileges: string }>(`
      select c.relname as table, string_agg(p.privilege, ',' order by p.privilege) as privileges
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%' and has_table_privilege('crm_queue', c.oid, p.privilege)
      group by 1 order by 1
    `);
    const expected = Object.entries(QUEUE_ROLE_RIGHTS.tables)
      .map(([table, rights]) => ({ table, privileges: [...rights].sort().join(',') }))
      .sort((x, y) => (x.table < y.table ? -1 : 1));
    // The five columns of `jobs` the function reads, and Graphile's three tables.
    const columns = await owner.query<{ column: string }>(`
      select att.attname as column from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_queue'::regrole and att.attrelid = 'public.jobs'::regclass and a.privilege_type = 'SELECT'
      order by 1
    `);
    expect(tables.rows).toEqual(expected);
    expect(columns.rows.map((row) => row.column)).toEqual(['id', 'lane', 'priority', 'status', 'workspace_id']);
    const functions = await owner.query<{ name: string }>(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = '${QUEUE_SCHEMA}' and has_function_privilege('crm_queue', p.oid, 'EXECUTE') order by 1
    `);
    expect(functions.rows.map((row) => row.name)).toEqual([...QUEUE_ROLE_RIGHTS.functions]);
    const sequences = await owner.query(`
      select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.relkind = 'S' and a.grantee = 'crm_queue'::regrole
    `);
    expect(sequences.rowCount).toBe(0);
    // Graphile turns row level security on for its tables with no policy (only the owner reads them); the one
    // policy added lets crm_worker and crm_queue through, their grants above deciding what each may do.
    const policies = await owner.query<{ table: string; roles: string; check: string }>(`
      select tablename as table, array_to_string(roles, ',') as roles, coalesce(qual, '') || '/' || coalesce(with_check, '') as check
      from pg_policies where schemaname = '${QUEUE_SCHEMA}' order by 1
    `);
    expect(policies.rows).toEqual(
      ['_private_job_queues', '_private_jobs', '_private_known_crontabs', '_private_tasks'].map((table) => ({
        table,
        roles: 'crm_queue,crm_worker',
        check: 'true/true',
      })),
    );
    const memberOf = await owner.query(`select 1 from pg_auth_members where member = 'crm_queue'::regrole`);
    expect(memberOf.rowCount).toBe(0);
  });

  it('give crm_worker every right on the schema but create, and nothing more than the app elsewhere', async () => {
    const missing = await owner.query<{ name: string }>(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = '${QUEUE_SCHEMA}' and (
        (c.relkind = 'r' and c.relname <> 'migrations' and not (has_table_privilege('crm_worker', c.oid, 'SELECT')
          and has_table_privilege('crm_worker', c.oid, 'INSERT') and has_table_privilege('crm_worker', c.oid, 'UPDATE')
          and has_table_privilege('crm_worker', c.oid, 'DELETE')))
        or ((c.relkind = 'v' or c.relname = 'migrations') and not has_table_privilege('crm_worker', c.oid, 'SELECT')))
      union all
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = '${QUEUE_SCHEMA}' and not has_function_privilege('crm_worker', p.oid, 'EXECUTE')
    `);
    expect(missing.rows).toEqual([]);
    // Graphile's migrations table: read at start, never written (only the owner migrates).
    const migrations = await owner.query<{ write: boolean }>(
      `select has_table_privilege('crm_worker', '${QUEUE_SCHEMA}.migrations', 'INSERT')
         or has_table_privilege('crm_worker', '${QUEUE_SCHEMA}.migrations', 'UPDATE')
         or has_table_privilege('crm_worker', '${QUEUE_SCHEMA}.migrations', 'DELETE') as write`,
    );
    expect(migrations.rows).toEqual([{ write: false }]);
    const schema = await owner.query<{ usage: boolean; create: boolean }>(
      `select has_schema_privilege('crm_worker', '${QUEUE_SCHEMA}', 'USAGE') as usage,
         has_schema_privilege('crm_worker', '${QUEUE_SCHEMA}', 'CREATE') as create`,
    );
    expect(schema.rows).toEqual([{ usage: true, create: false }]);
    // Outside the queue, the worker's table rights are exactly the app's.
    const beyond = await owner.query<{ name: string }>(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', '${QUEUE_SCHEMA}')
        and n.nspname not like 'pg\\_toast%'
        and has_table_privilege('crm_worker', c.oid, p.privilege) <> has_table_privilege('crm_app', c.oid, p.privilege)
    `);
    expect(beyond.rows).toEqual([]);
    const roles = await owner.query<{ role: string; login: boolean; bypass: boolean; groups: string }>(`
      select r.rolname as role, r.rolcanlogin as login, r.rolbypassrls as bypass,
        coalesce((select string_agg(g.rolname, ',' order by g.rolname) from pg_auth_members m
          join pg_roles g on g.oid = m.roleid where m.member = r.oid), '') as groups
      from pg_roles r where r.rolname in ('crm_worker', 'crm_queue') order by 1
    `);
    expect(roles.rows).toEqual([
      { role: 'crm_queue', login: false, bypass: false, groups: '' },
      { role: 'crm_worker', login: false, bypass: false, groups: 'crm_app' },
    ]);
  });

  it('let the worker login read and change the queue, as Graphile’s runners do', async () => {
    const worker = new pg.Client({ connectionString: workerUrl });
    await worker.connect();
    try {
      await worker.query(`select count(*) from ${QUEUE_SCHEMA}._private_jobs`);
      await worker.query(`select ${QUEUE_SCHEMA}.force_unlock_workers(array['nobody'])`);
      // And it can't create there.
      await expect(worker.query(`create table ${QUEUE_SCHEMA}.stray (id int)`)).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await worker.end();
    }
  });
});

describe('the stale lock release', () => {
  it('frees a worker whose every lock is old, and leaves a worker with a newer lock alone', async () => {
    const { workspaceId, memberId } = await workspaceWithMember('queue-stale');
    const dead = await jobIn(workspaceId, memberId, 'queued');
    const aliveOld = await jobIn(workspaceId, memberId, 'queued');
    const aliveNew = await jobIn(workspaceId, memberId, 'queued');
    for (const job of [dead, aliveOld, aliveNew]) await enqueue(workspaceId, job);
    const lock = (jobId: string, worker: string, age: string) =>
      owner.query(
        `update ${QUEUE_SCHEMA}._private_jobs set locked_by = $1, locked_at = now() - $2::interval
         where payload->>'jobId' = $3`,
        [worker, age, jobId],
      );
    const deadWorker = `dead-${randomUUID()}`;
    const liveWorker = `live-${randomUUID()}`;
    await lock(dead, deadWorker, '10 minutes');
    await lock(aliveOld, liveWorker, '10 minutes');
    await lock(aliveNew, liveWorker, '5 seconds');
    const queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-queue-tests', max: 1 });
    try {
      expect(await queue.releaseStaleLocks()).toBeGreaterThanOrEqual(1);
      const held = await owner.query<{ job: string; locked: boolean }>(
        `select payload->>'jobId' as job, locked_at is not null as locked from ${QUEUE_SCHEMA}._private_jobs
         where payload->>'jobId' = any($1) order by 1`,
        [[dead, aliveOld, aliveNew]],
      );
      const locked = Object.fromEntries(held.rows.map((row) => [row.job, row.locked]));
      expect(locked).toEqual({ [dead]: false, [aliveOld]: true, [aliveNew]: true });
      const backlog = await queue.backlog();
      expect(backlog.waiting).toBeGreaterThanOrEqual(1);
    } finally {
      await queue.close();
    }
  });
});
