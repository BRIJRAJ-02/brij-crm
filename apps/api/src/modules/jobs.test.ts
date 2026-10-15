// jobs.* at the API (spec 0008, AC-114, AC-123): a member sees and cancels
// their own jobs, a holder of jobs.manage every job, and anyone else the same
// 404; the test job starts only for jobs.manage, and production answers
// NOT_FOUND for it. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { jobKinds, newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
let production: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
  // Production's kinds: no test kind.
  ({ app: production } = signInApp({ db, identity }, {}, { jobs: jobKinds({ environment: 'production' }) }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** Someone else, signed in, added to `workspaceId` with `role`, and their client and member id. */
async function joined(workspaceId: string, role: 'admin' | 'member') {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  const memberId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, $5, 'system', 'system')`,
    [workspaceId, memberId, user?.id, email, role],
  );
  return { client: rpcClient(app, cookie), memberId };
}

describe('the worker woken by use (spec 0008, The wake call)', () => {
  it('wakes the worker from every signed in request through the once a minute call, and from a read of an overdue job', async () => {
    let onUse = 0;
    let pokes = 0;
    const { app: counting } = signInApp(
      { db, identity },
      {},
      { wakeOnUse: () => (onUse += 1), wakeRelay: () => (pokes += 1) },
    );
    const m = await memberWithWorkspace(counting);
    const before = onUse;
    await m.client.jobs.list({ workspace: m.slug });
    await m.client.jobs.list({ workspace: m.slug });
    expect(onUse - before).toBe(2);
    // A job queued and due 10 seconds ago that nobody picked up: a read of it wakes the worker, once per read.
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 1, mutationId: newId() });
    const quiet = pokes;
    await m.client.jobs.get({ workspace: m.slug, jobId: job.id });
    expect(pokes).toBe(quiet);
    await testQuery(ownerUrl, `update jobs set run_at = now() - interval '10 seconds' where id = $1`, [job.id]);
    await m.client.jobs.get({ workspace: m.slug, jobId: job.id });
    expect(pokes).toBe(quiet + 1);
    await m.client.jobs.list({ workspace: m.slug });
    expect(pokes).toBe(quiet + 2);
  });
});

describe('jobs.*', () => {
  it('starts a test job for an owner, and lists it with its progress, label and starter', async () => {
    const m = await memberWithWorkspace(app);
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 25, mutationId: newId() });
    expect(job).toMatchObject({ kind: 'dev.simulate', label: 'Test job', status: 'queued', total: 25, done: 0 });
    expect(job.startedBy.type).toBe('member');
    expect((await m.client.jobs.get({ workspace: m.slug, jobId: job.id })).id).toBe(job.id);
    const mine = await m.client.jobs.list({ workspace: m.slug });
    expect(mine.jobs.map((each) => each.id)).toEqual([job.id]);
    expect(mine.nextCursor).toBeUndefined();
  });

  it('shows a member none of another’s jobs (404), and lets an admin see and cancel them', async () => {
    const m = await memberWithWorkspace(app);
    const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 5, mutationId: newId() });
    const member = await joined(m.workspace.id, 'member');
    const notFound = { code: 'NOT_FOUND', status: 404 };
    expect(await refusal(() => member.client.jobs.get({ workspace: m.slug, jobId: job.id }))).toMatchObject(notFound);
    expect(
      await refusal(() => member.client.jobs.cancel({ workspace: m.slug, jobId: job.id, mutationId: newId() })),
    ).toMatchObject(notFound);
    expect((await member.client.jobs.list({ workspace: m.slug })).jobs).toEqual([]);
    expect(await refusal(() => member.client.jobs.list({ workspace: m.slug, scope: 'all' }))).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(
      await refusal(() =>
        member.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 1, mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const admin = await joined(m.workspace.id, 'admin');
    expect((await admin.client.jobs.list({ workspace: m.slug, scope: 'all' })).jobs.map((each) => each.id)).toEqual([
      job.id,
    ]);
    const cancelled = await admin.client.jobs.cancel({ workspace: m.slug, jobId: job.id, mutationId: newId() });
    expect(cancelled.status).toBe('cancelled');
    expect(
      await refusal(() => m.client.jobs.cancel({ workspace: m.slug, jobId: job.id, mutationId: newId() })),
    ).toMatchObject({ code: 'JOB_FINISHED', status: 409 });
    // Someone outside the workspace: the door's 404.
    const outsider = await memberWithWorkspace(app);
    expect(await refusal(() => outsider.client.jobs.get({ workspace: m.slug, jobId: job.id }))).toMatchObject(notFound);
  });

  it('pages 50 at a time, unfinished first', async () => {
    const m = await memberWithWorkspace(app);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const job = await m.client.jobs.startTest({ workspace: m.slug, id: newId(), items: 1, mutationId: newId() });
      ids.push(job.id);
    }
    const [oldest = ''] = ids;
    await m.client.jobs.cancel({ workspace: m.slug, jobId: ids[1] ?? '', mutationId: newId() });
    const first = await m.client.jobs.list({ workspace: m.slug, limit: 2 });
    expect(first.jobs.map((job) => job.id)).toEqual([ids[2], oldest]);
    const second = await m.client.jobs.list({ workspace: m.slug, limit: 2, cursor: first.nextCursor });
    expect(second.jobs.map((job) => job.id)).toEqual([ids[1]]);
    expect(second.nextCursor).toBeUndefined();
    expect(await refusal(() => m.client.jobs.list({ workspace: m.slug, cursor: 'not-a-cursor' }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('answers NOT_FOUND for the test job in production (AC-123)', async () => {
    const m = await memberWithWorkspace(app);
    const client = rpcClient(production, m.cookie);
    expect(
      await refusal(() => client.jobs.startTest({ workspace: m.slug, id: newId(), items: 1, mutationId: newId() })),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
