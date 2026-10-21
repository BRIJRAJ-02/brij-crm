// The daily cleanup against a real Postgres (spec 0008, milestone 3, AC-112,
// AC-121, AC-122): the fan out starts one `maintenance.daily` per workspace
// a day, whatever runs it again; the job purges what has been in the trash
// past 30 days and keeps the rest, ends jobs left waiting for a confirm, drops
// the items of finished jobs but the refused ones, deletes jobs finished more
// than 30 days ago, ends an email still queued after a day and deletes emails
// older than 30 days, and queues again only a job that lost its queue row.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { PRUNE_BATCH, createDatabase, openQueueConnection, type QueueConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { systemScope } from '../access/door.ts';
import { deleteRecord } from '../engine/deletion.ts';
import { newId } from '../engine/ids.ts';
import { createImport, stageImportRows } from '../imports/service.ts';
import { deleteNote, saveNote } from '../notes/notes.ts';
import { createTask, deleteTask } from '../tasks/tasks.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import type { EngineScope } from '../engine/scope.ts';
import { maintenanceKey, runDailyCleanup, type DailySweep } from './daily.ts';
import { jobKinds } from './kinds/index.ts';
import { MAINTENANCE_DAILY, maintenanceDaily } from './kinds/maintenance-daily.ts';
import { kindContractProblems, type AnyKind } from './registry.ts';
import { getJob } from './service.ts';
import { fakeClock, jobTestKit } from '../../test/jobs-kit.ts';

const { appUrl, ownerUrl, workerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-maintenance-tests' });
let queue: QueueConnection;

beforeAll(() => {
  queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-maintenance-tests-queue', max: 2 });
});
afterAll(async () => {
  await queue.close();
  await db.close();
});

const registry = () => jobKinds({ environment: 'local', queue });
const { team, runnerFor, queueRows, jobEvents, drive } = jobTestKit(db, ownerUrl);
const quiet = { info: () => undefined, error: () => undefined };

/** A sweep over the given workspaces only (the shared test database holds every file's), counting its calls. */
function sweepOf(workspaceIds: readonly string[], pruned: readonly number[] = [0]) {
  const calls = { prune: 0, dead: 0, pages: 0 };
  const sorted = [...workspaceIds].sort();
  const sweep: DailySweep = {
    pruneOutbox: () => Promise.resolve(pruned[Math.min(calls.prune++, pruned.length - 1)] ?? 0),
    deleteDead: () => {
      calls.dead += 1;
      return Promise.resolve(0);
    },
    workspaceIds: (after, max) => {
      calls.pages += 1;
      return Promise.resolve(sorted.filter((id) => after === undefined || id > after).slice(0, max));
    },
    workspacesToPurge: () => Promise.resolve([]),
  };
  return { sweep, calls };
}

/** The fan out for `day` over `workspaceIds`, as the worker wires it. */
function fanOut(day: string, workspaceIds: readonly string[], options: { after?: string; budgetMs?: number } = {}) {
  const { sweep, calls } = sweepOf(workspaceIds);
  return runDailyCleanup(
    {
      registry: registry(),
      systemScope: (workspaceId) => systemScope(db, workspaceId),
      hooks: () => [outboxHook()],
      sweep,
      log: quiet,
    },
    { day, ...options },
  ).then((report) => ({ report, calls }));
}

/** The workspace's cleanup jobs: their id, day and status. */
const cleanups = (workspaceId: string) =>
  testQuery<{ id: string; once_key: string; status: string; priority: number; created_by_type: string }>(
    ownerUrl,
    `select id, once_key, status::text, priority, created_by_type::text from jobs
     where workspace_id = $1 and kind = $2 order by created_at, id`,
    [workspaceId, MAINTENANCE_DAILY],
  );

/** Runs the workspace's cleanup for `day` to its end, as the worker would, and answers its job. */
async function cleanUp(workspaceId: string, day: string) {
  await fanOut(day, [workspaceId]);
  const job = (await cleanups(workspaceId)).find((row) => row.once_key === maintenanceKey(day));
  if (job === undefined) throw new Error('No cleanup was started.');
  const run = runnerFor(registry(), fakeClock());
  const outcomes = await drive(run, workspaceId, job.id);
  return { jobId: job.id, outcomes };
}

/** A person in the workspace, made as a member makes one. */
async function person(scope: EngineScope, firstName: string): Promise<string> {
  const [people] = await testQuery<{ object: string; attribute: string }>(
    ownerUrl,
    `select o.id as object, a.id as attribute from objects o join attributes a on a.object_id = o.id
     where o.workspace_id = $1 and o.api_slug = 'people' and a.api_slug = 'name'`,
    [scope.workspaceId],
  );
  if (people === undefined) throw new Error('The workspace has no People.');
  const { recordId } = await createRecord(scope, {
    objectId: people.object,
    values: { [people.attribute]: { firstName } },
  });
  return recordId;
}

/** A job row as the app would have left it, with `fields` overriding the defaults (SQL expressions). */
async function jobRow(workspaceId: string, memberId: string, fields: Record<string, string>): Promise<string> {
  const id = randomUUID();
  const row: Record<string, string> = {
    workspace_id: `'${workspaceId}'`,
    id: `'${id}'`,
    kind: "'dev.simulate'",
    lane: "'heavy'",
    status: "'queued'",
    params: `'{"batchMillis":0}'`,
    priority: '0',
    created_by_type: "'member'",
    created_by_id: `'${memberId}'`,
    created_by_member_id: `'${memberId}'`,
    ...fields,
  };
  await testQuery(
    ownerUrl,
    `insert into jobs (${Object.keys(row).join(', ')}) values (${Object.values(row).join(', ')})`,
  );
  return id;
}

/** Items for a job, one per state given, at positions 1, 2, … */
async function itemsFor(workspaceId: string, jobId: string, states: readonly string[]): Promise<void> {
  for (const [index, state] of states.entries()) {
    await testQuery(
      ownerUrl,
      `insert into job_items (workspace_id, job_id, position, item_id, state, code)
       values ($1, $2, $3, $4, $5::job_item_state, $6)`,
      [workspaceId, jobId, index + 1, randomUUID(), state, state === 'refused' ? 'SIMULATED_REFUSAL' : null],
    );
  }
}

const itemStatesOf = (workspaceId: string, jobId: string) =>
  testQuery<{ state: string }>(
    ownerUrl,
    'select state::text from job_items where workspace_id = $1 and job_id = $2 order by position',
    [workspaceId, jobId],
  ).then((rows) => rows.map((row) => row.state));

const jobExists = async (jobId: string) =>
  (await testQuery(ownerUrl, 'select 1 from jobs where id = $1', [jobId])).length === 1;

describe('the fan out (AC-112)', () => {
  it('starts one cleanup per workspace a day as the system, however often it runs', async () => {
    const a = await team([]);
    const b = await team([]);
    const day = '2026-10-15';
    const first = await fanOut(day, [a.workspaceId, b.workspaceId]);
    expect(first.report).toMatchObject({ workspaces: 2, failed: 0 });
    // Run again the same day (a retry, a second worker, a restart): nothing new.
    await fanOut(day, [a.workspaceId, b.workspaceId]);
    for (const t of [a, b]) {
      const jobs = await cleanups(t.workspaceId);
      expect(jobs).toEqual([
        {
          id: expect.any(String) as string,
          once_key: `maintenance:${day}`,
          status: 'queued',
          priority: 10,
          created_by_type: 'system',
        },
      ]);
      // Queued, ids only on the queue, and its event stored under no starter.
      const [job] = jobs;
      if (job === undefined) throw new Error('No cleanup.');
      expect(await queueRows(job.id)).toHaveLength(1);
      const [payload] = await testQuery<{ payload: unknown }>(
        ownerUrl,
        'select payload from graphile_worker._private_jobs where key = $1',
        [`crm-job:${t.workspaceId}:${job.id}`],
      );
      expect(payload?.payload).toEqual({ workspaceId: t.workspaceId, jobId: job.id });
      expect((await jobEvents(t.workspaceId)).at(-1)).toEqual({ item_ids: [job.id], actor_member_id: null });
    }
    // The next day gets its own.
    await fanOut('2026-10-16', [a.workspaceId]);
    expect((await cleanups(a.workspaceId)).map((job) => job.once_key)).toEqual([
      'maintenance:2026-10-15',
      'maintenance:2026-10-16',
    ]);
  });

  it('prunes the outbox until a batch comes back short, deletes dead rows once, and hands on what its budget leaves', async () => {
    const { sweep, calls } = sweepOf([], [PRUNE_BATCH, PRUNE_BATCH, 3]);
    const deps = {
      registry: registry(),
      systemScope: (workspaceId: string) => systemScope(db, workspaceId),
      hooks: () => [outboxHook()],
      sweep,
      log: quiet,
    };
    expect(await runDailyCleanup(deps, { day: '2026-10-15' })).toEqual({
      pruned: 2 * PRUNE_BATCH + 3,
      dead: 0,
      workspaces: 0,
      failed: 0,
    });
    expect(calls).toEqual({ prune: 3, dead: 1, pages: 1 });
    // Out of time at the first workspace: where to pick up, and the continuation skips the outbox and dead rows.
    const a = await team([]);
    const b = await team([]);
    const [low, high] = [a.workspaceId, b.workspaceId].sort();
    if (low === undefined || high === undefined) throw new Error('Two workspaces were made.');
    const early = await fanOut('2026-10-17', [low, high], { budgetMs: 0 });
    expect(early.report).toMatchObject({ workspaces: 0, next: '00000000-0000-0000-0000-000000000000' });
    const rest = await fanOut('2026-10-17', [low, high], { after: early.report.next ?? '' });
    expect(rest.report).toMatchObject({ workspaces: 2, pruned: 0 });
    expect(rest.calls).toMatchObject({ prune: 0, dead: 0 });
    const half = await fanOut('2026-10-18', [low, high], { after: low });
    expect(half.report.workspaces).toBe(1);
    expect((await cleanups(low)).map((job) => job.once_key)).not.toContain('maintenance:2026-10-18');
    expect((await cleanups(high)).map((job) => job.once_key)).toContain('maintenance:2026-10-18');
  });

  it('passes the shared kind contract: strict params, no secrets, the system’s, never cancelled', () => {
    expect(kindContractProblems(maintenanceDaily() as AnyKind)).toEqual([]);
    const kind = registry().get(MAINTENANCE_DAILY);
    expect(kind).toMatchObject({ actor: 'system', lane: 'heavy', cancellable: false, mode: 'cursor' });
    // Registered everywhere, production included.
    expect(jobKinds({ environment: 'production' }).get(MAINTENANCE_DAILY)).toBeDefined();
  });
});

describe('maintenance.daily (AC-112, AC-121)', () => {
  it('purges records and entries trashed more than 30 days ago, and keeps those trashed for less', async () => {
    const t = await team([]);
    const old = await person(t.owner, 'Old');
    const recent = await person(t.owner, 'Recent');
    const live = await person(t.owner, 'Live');
    for (const recordId of [old, recent]) await deleteRecord(t.owner, { recordId });
    await testQuery(ownerUrl, `update records set deleted_at = now() - interval '31 days' where id = $1`, [old]);
    await testQuery(ownerUrl, `update records set deleted_at = now() - interval '29 days' where id = $1`, [recent]);
    const { jobId, outcomes } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(outcomes.at(-1)).toBe('succeeded');
    const left = await testQuery<{ id: string }>(ownerUrl, 'select id from records where id = any($1)', [
      [old, recent, live],
    ]);
    expect(left.map((row) => row.id).sort()).toEqual([recent, live].sort());
    const job = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    expect(job).toMatchObject({ status: 'succeeded', startedBy: { type: 'system' }, cancellable: false });
    expect(job.done).toBeGreaterThanOrEqual(1);
    expect(job.result).toMatchObject({ cleanup: { records: 1, expired: 0, jobs: 0, requeued: 0 } });
  });

  it('removes notes and tasks deleted more than 30 days ago, a task with its links, and keeps newer ones (spec 0019)', async () => {
    const t = await team([]);
    const acme = await person(t.owner, 'Acme');
    const make = async (title: string) => {
      const note = (await saveNote(t.owner, { id: newId(), recordId: acme, title })).note.id;
      const task = (await createTask(t.owner, { id: newId(), title, recordIds: [acme] })).id;
      await deleteNote(t.owner, { noteId: note });
      await deleteTask(t.owner, { taskId: task });
      return { note, task };
    };
    const old = await make('Old');
    const recent = await make('Recent');
    for (const [table, id] of [
      ['notes', old.note],
      ['tasks', old.task],
    ] as const) {
      await testQuery(ownerUrl, `update ${table} set deleted_at = now() - interval '31 days' where id = $1`, [id]);
    }
    const { jobId, outcomes } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(outcomes.at(-1)).toBe('succeeded');
    const notesLeft = await testQuery<{ id: string }>(ownerUrl, 'select id from notes where id = any($1)', [
      [old.note, recent.note],
    ]);
    expect(notesLeft.map((row) => row.id)).toEqual([recent.note]);
    const tasksLeft = await testQuery<{ id: string }>(ownerUrl, 'select id from tasks where id = any($1)', [
      [old.task, recent.task],
    ]);
    expect(tasksLeft.map((row) => row.id)).toEqual([recent.task]);
    const links = await testQuery<{ task_id: string }>(
      ownerUrl,
      'select task_id from task_records where task_id = $1',
      [old.task],
    );
    expect(links).toEqual([]);
    const job = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    expect(job.result).toMatchObject({ cleanup: { notes: 1, tasks: 1 } });
  });

  it('ends an email still queued after a day failed and blanked, and removes emails made more than 30 days ago', async () => {
    const t = await team([]);
    const email = async (key: string, age: string, sent = false) => {
      const [row] = await testQuery<{ id: string }>(
        ownerUrl,
        `insert into emails (workspace_id, kind, key, to_member_id, params, status, sent_at, created_by_type, created_at)
         values ($1, 'mention', $2, $3, '{"excerpt":"hi"}', $4::email_status, $5::timestamptz, 'system', now() - $6::interval)
         returning id::text as id`,
        [t.workspaceId, key, t.ownerId, sent ? 'sent' : 'queued', sent ? new Date().toISOString() : null, age],
      );
      return row?.id ?? '';
    };
    const lost = await email('mention:1:1', '2 days');
    const waiting = await email('mention:2:2', '1 hour');
    await email('mention:3:3', '31 days', true);
    const { jobId, outcomes } = await cleanUp(t.workspaceId, '2026-10-16');
    expect(outcomes.at(-1)).toBe('succeeded');
    const left = await testQuery<{ id: string; status: string; error_code: string | null; params: unknown }>(
      ownerUrl,
      'select id::text as id, status::text, error_code, params from emails where workspace_id = $1 order by created_at',
      [t.workspaceId],
    );
    expect(left).toEqual([
      { id: lost, status: 'failed', error_code: 'queue_lost', params: {} },
      { id: waiting, status: 'queued', error_code: null, params: { excerpt: 'hi' } },
    ]);
    const job = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    expect(job.result).toMatchObject({ cleanup: { emails: 1 } });
  });

  it('drops from each member’s sidebar the records and views that point at nothing any more (spec 0034, AC-940)', async () => {
    const t = await team([]);
    const gone = await person(t.owner, 'Gone');
    const kept = await person(t.owner, 'Kept');
    const trashed = await person(t.owner, 'Trashed');
    await deleteRecord(t.owner, { recordId: gone });
    await deleteRecord(t.owner, { recordId: trashed });
    await testQuery(ownerUrl, `update records set deleted_at = now() - interval '31 days' where id = $1`, [gone]);
    const deletedView = newId();
    const items = [
      { kind: 'record', id: gone, pinned: true },
      { kind: 'view', id: deletedView, pinned: true },
      { kind: 'record', id: kept, pinned: true },
      { kind: 'record', id: trashed, pinned: true },
      { kind: 'page', id: 'forms', hidden: true },
    ];
    // Another workspace's row, naming the same missing view, is another workspace's cleanup's.
    const elsewhere = await team([]);
    const theirs = JSON.stringify([{ kind: 'view', id: deletedView, pinned: true }]);
    await testQuery(
      ownerUrl,
      `insert into member_nav_prefs (workspace_id, member_id, items, created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
       values ($1, $2, $3::jsonb, 'member', $2, $2, 'member', $2, $2)`,
      [t.workspaceId, t.ownerId, JSON.stringify(items)],
    );
    await testQuery(
      ownerUrl,
      `insert into member_nav_prefs (workspace_id, member_id, items, created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
       values ($1, $2, $3::jsonb, 'member', $2, $2, 'member', $2, $2)`,
      [elsewhere.workspaceId, elsewhere.ownerId, theirs],
    );
    const { jobId, outcomes } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(outcomes.at(-1)).toBe('succeeded');
    const [row] = await testQuery<{ items: unknown; version: number }>(
      ownerUrl,
      'select items, version from member_nav_prefs where member_id = $1',
      [t.ownerId],
    );
    // A record in the trash still exists: it comes back with a restore.
    expect(row?.items).toEqual([
      { kind: 'record', id: kept, pinned: true },
      { kind: 'record', id: trashed, pinned: true },
      { kind: 'page', id: 'forms', hidden: true },
    ]);
    expect(row?.version).toBe(2);
    const [other] = await testQuery<{ items: unknown }>(
      ownerUrl,
      'select items from member_nav_prefs where member_id = $1',
      [elsewhere.ownerId],
    );
    expect(other?.items).toEqual(JSON.parse(theirs));
    expect((await getJob(systemScope(db, t.workspaceId), registry(), jobId)).result).toMatchObject({
      cleanup: { records: 1, sidebars: 1 },
    });
  });

  it('removes notifications done more than 90 days ago, and keeps newer done, read and unread ones (spec 0038)', async () => {
    const t = await team([]);
    // One notification a task: a member has one per task assignment.
    const add = async (doneAt: string | null, readAt: string | null) => {
      const task = (await createTask(t.owner, { id: newId(), title: 'Call back' })).id;
      const id = newId();
      await testQuery(
        ownerUrl,
        `insert into notifications (workspace_id, id, member_id, kind, actor_type, task_id, read_at, done_at, created_at)
         values ($1, $2, $3, 'task_assigned', 'system', $4, ${readAt ?? 'null'}, ${doneAt ?? 'null'}, now() - interval '200 days')`,
        [t.workspaceId, id, t.ownerId, task],
      );
      return id;
    };
    const old = await add("now() - interval '91 days'", "now() - interval '91 days'");
    const recent = await add("now() - interval '89 days'", "now() - interval '89 days'");
    const read = await add(null, "now() - interval '120 days'");
    const unread = await add(null, null);
    const { jobId, outcomes } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(outcomes.at(-1)).toBe('succeeded');
    const left = await testQuery<{ id: string }>(ownerUrl, 'select id from notifications where id = any($1)', [
      [old, recent, read, unread],
    ]);
    expect(left.map((row) => row.id).sort()).toEqual([recent, read, unread].sort());
    const job = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    expect(job.result).toMatchObject({ cleanup: { notifications: 1 } });
  });

  it('keeps refused items, deletes the rest of a finished job’s, and deletes jobs finished more than 30 days ago', async () => {
    const t = await team([]);
    const finished = await jobRow(t.workspaceId, t.ownerId, {
      status: "'cancelled'",
      finished_at: "now() - interval '2 days'",
    });
    await itemsFor(t.workspaceId, finished, ['done', 'refused', 'skipped', 'pending', 'refused']);
    const old = await jobRow(t.workspaceId, t.ownerId, {
      status: "'succeeded'",
      finished_at: "now() - interval '31 days'",
    });
    await itemsFor(t.workspaceId, old, ['done', 'refused']);
    const keptOld = await jobRow(t.workspaceId, t.ownerId, {
      status: "'succeeded'",
      finished_at: "now() - interval '29 days'",
    });
    const running = await jobRow(t.workspaceId, t.ownerId, { status: "'running'" });
    await itemsFor(t.workspaceId, running, ['done', 'pending']);
    const { jobId } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(await itemStatesOf(t.workspaceId, finished)).toEqual(['refused', 'refused']);
    expect(await jobExists(old)).toBe(false);
    expect(await itemStatesOf(t.workspaceId, old)).toEqual([]);
    expect(await jobExists(keptOld)).toBe(true);
    // An unfinished job's items are its work: untouched.
    expect(await itemStatesOf(t.workspaceId, running)).toEqual(['done', 'pending']);
    // Three of the cancelled job's, the old job's done one (finished, so cleaned with the rest), then its refused
    // one with the job itself.
    expect((await getJob(systemScope(db, t.workspaceId), registry(), jobId)).result).toMatchObject({
      cleanup: { items: 5, jobs: 1 },
    });
    // A job that finished before that cleanup began was its to clean: the next one leaves it as it is.
    const before = await jobRow(t.workspaceId, t.ownerId, {
      status: "'succeeded'",
      finished_at: "now() - interval '3 days'",
    });
    await itemsFor(t.workspaceId, before, ['done']);
    await cleanUp(t.workspaceId, '2026-10-16');
    expect(await itemStatesOf(t.workspaceId, before)).toEqual(['done']);
  });

  it('ends a job left waiting for its confirm past its hour, with its event', async () => {
    const t = await team([]);
    const waiting = await jobRow(t.workspaceId, t.ownerId, {
      status: "'ready'",
      expires_at: "now() - interval '1 minute'",
    });
    const fresh = await jobRow(t.workspaceId, t.ownerId, {
      status: "'ready'",
      expires_at: "now() + interval '30 minutes'",
    });
    await cleanUp(t.workspaceId, '2026-10-15');
    const [ended] = await testQuery<{ status: string; error_code: string | null; finished: boolean }>(
      ownerUrl,
      'select status::text, error_code, finished_at is not null as finished from jobs where id = $1',
      [waiting],
    );
    expect(ended).toEqual({ status: 'cancelled', error_code: 'JOB_EXPIRED', finished: true });
    const [kept] = await testQuery<{ status: string }>(ownerUrl, 'select status::text from jobs where id = $1', [
      fresh,
    ]);
    expect(kept?.status).toBe('ready');
    expect((await jobEvents(t.workspaceId)).some((event) => event.item_ids.includes(waiting))).toBe(true);
  });

  it('queues again only a due job with no live lease, untouched for an hour, and no queue row', async () => {
    const t = await team([]);
    const due = { run_at: "now() - interval '2 hours'", updated_at: "now() - interval '2 hours'" };
    const lost = await jobRow(t.workspaceId, t.ownerId, due);
    const lostRunning = await jobRow(t.workspaceId, t.ownerId, { ...due, status: "'running'", slices: '1' });
    const waiting = await jobRow(t.workspaceId, t.ownerId, due);
    const leased = await jobRow(t.workspaceId, t.ownerId, {
      ...due,
      status: "'running'",
      lease_owner: "'elsewhere:1'",
      lease_until: "now() + interval '1 minute'",
    });
    const recent = await jobRow(t.workspaceId, t.ownerId, { run_at: "now() - interval '2 hours'" });
    const later = await jobRow(t.workspaceId, t.ownerId, {
      run_at: "now() + interval '1 day'",
      updated_at: "now() - interval '2 hours'",
    });
    // Only `waiting` still has its queue row.
    await db.withWorkspace(t.workspaceId, (tx) => tx.execute(sql`select crm_enqueue_job(${waiting}::uuid)`));
    expect(await queueRows(waiting)).toHaveLength(1);
    const { jobId } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(await queueRows(lost)).toHaveLength(1);
    expect(await queueRows(lostRunning)).toHaveLength(1);
    expect(await queueRows(waiting)).toHaveLength(1);
    for (const untouched of [leased, recent, later]) expect(await queueRows(untouched)).toEqual([]);
    expect((await getJob(systemScope(db, t.workspaceId), registry(), jobId)).result).toMatchObject({
      cleanup: { requeued: 2 },
    });
  });

  it('walks a big finished job’s items in bounded windows, keeping every refused one', async () => {
    const t = await team([]);
    const big = await jobRow(t.workspaceId, t.ownerId, {
      status: "'succeeded'",
      finished_at: "now() - interval '1 day'",
    });
    // 12,001 items, every other one refused: three windows of 5,000 positions and a short fourth.
    await testQuery(
      ownerUrl,
      `insert into job_items (workspace_id, job_id, position, item_id, state, code)
       select $1, $2, g, gen_random_uuid(),
         (case when g % 2 = 0 then 'refused' else 'done' end)::job_item_state,
         case when g % 2 = 0 then 'SIMULATED_REFUSAL' end
       from generate_series(1, 12001) g`,
      [t.workspaceId, big],
    );
    const { jobId } = await cleanUp(t.workspaceId, '2026-10-15');
    const [left] = await testQuery<{ refused: number; other: number }>(
      ownerUrl,
      `select count(*) filter (where state = 'refused')::int as refused, count(*) filter (where state <> 'refused')::int as other
       from job_items where job_id = $1`,
      [big],
    );
    expect(left).toEqual({ refused: 6_000, other: 0 });
    expect((await getJob(systemScope(db, t.workspaceId), registry(), jobId)).result).toMatchObject({
      cleanup: { items: 6_001 },
    });
  });

  it('leaves every other workspace’s trash, old jobs, expired and lost jobs alone (AC-115)', async () => {
    const a = await team([]);
    const b = await team([]);
    const theirs = await person(b.owner, 'Theirs');
    await deleteRecord(b.owner, { recordId: theirs });
    await testQuery(ownerUrl, `update records set deleted_at = now() - interval '31 days' where id = $1`, [theirs]);
    const theirJob = await jobRow(b.workspaceId, b.ownerId, {
      status: "'succeeded'",
      finished_at: "now() - interval '31 days'",
    });
    await itemsFor(b.workspaceId, theirJob, ['done', 'refused']);
    const theirReady = await jobRow(b.workspaceId, b.ownerId, {
      status: "'ready'",
      expires_at: "now() - interval '1 minute'",
    });
    // A job of B's that lost its queue row: only B's own cleanup may queue it again.
    const theirLost = await jobRow(b.workspaceId, b.ownerId, {
      run_at: "now() - interval '2 hours'",
      updated_at: "now() - interval '2 hours'",
    });
    await cleanUp(a.workspaceId, '2026-10-15');
    expect(await queueRows(theirLost)).toEqual([]);
    expect(await testQuery(ownerUrl, 'select 1 from records where id = $1', [theirs])).toHaveLength(1);
    expect(await jobExists(theirJob)).toBe(true);
    expect(await itemStatesOf(b.workspaceId, theirJob)).toEqual(['done', 'refused']);
    const [ready] = await testQuery<{ status: string }>(ownerUrl, 'select status::text from jobs where id = $1', [
      theirReady,
    ]);
    expect(ready?.status).toBe('ready');
  });

  it('removes an import’s rows once its undo closes, and imports never started after 24 hours (spec 0040)', async () => {
    const t = await team([]);
    const [found] = await testQuery<{ people: string; name: string }>(
      ownerUrl,
      `select o.id::text as people, a.id::text as name from objects o
       join attributes a on a.object_id = o.id and a.api_slug = 'name'
       where o.workspace_id = $1 and o.api_slug = 'people'`,
      [t.workspaceId],
    );
    const made = async () => {
      const id = newId();
      await createImport(t.owner, {
        id,
        objectId: found?.people ?? '',
        fileName: 'people.csv',
        rowCount: 2,
        errorRows: 0,
        settings: {
          columns: [{ header: 'Name', target: { attributeId: found?.name ?? '' } }],
          onMatch: 'fill',
          onNoMatch: 'create',
        },
      });
      await stageImportRows(t.owner, {
        importId: id,
        rows: [2, 3].map((rowNumber) => ({ rowNumber, values: { [found?.name ?? '']: { firstName: 'Ada' } } })),
      });
      return id;
    };
    const closed = await made();
    const stale = await made();
    const fresh = await made();
    await testQuery(
      ownerUrl,
      `update imports set status = 'started', undo_until = now() - interval '1 minute' where id = $1`,
      [closed],
    );
    await testQuery(ownerUrl, `update imports set created_at = now() - interval '25 hours' where id = $1`, [stale]);
    const { outcomes } = await cleanUp(t.workspaceId, '2026-10-15');
    expect(outcomes.at(-1)).toBe('succeeded');
    const left = await testQuery<{ id: string; rows: number }>(
      ownerUrl,
      `select i.id::text, (select count(*)::int from import_rows r where r.import_id = i.id) as rows
       from imports i where i.workspace_id = $1 order by i.id`,
      [t.workspaceId],
    );
    expect(left).toEqual(
      [
        { id: closed, rows: 0 },
        { id: fresh, rows: 2 },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it('replays a committed batch to no new effect: each phase only removes what is still due', async () => {
    const t = await team([]);
    const old = await person(t.owner, 'Old');
    await deleteRecord(t.owner, { recordId: old });
    await testQuery(ownerUrl, `update records set deleted_at = now() - interval '31 days' where id = $1`, [old]);
    const { jobId } = await cleanUp(t.workspaceId, '2026-10-15');
    const before = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    // Back to the first phase, as if the batches had never committed, and run it again.
    await testQuery(
      ownerUrl,
      `update jobs set status = 'running', finished_at = null, checkpoint = null where id = $1`,
      [jobId],
    );
    const run = runnerFor(registry(), fakeClock());
    expect((await drive(run, t.workspaceId, jobId)).at(-1)).toBe('succeeded');
    const after = await getJob(systemScope(db, t.workspaceId), registry(), jobId);
    expect(after.done).toBe(before.done);
  });
});
