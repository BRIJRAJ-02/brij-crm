// tasks.* at the API (spec 0019, milestone 1): a task made on a record and
// read back by id and in the record's list, a replay, the refusals' codes,
// statuses and fields, and a cursor the server didn't make. Real session,
// real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, refusal } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

async function withRecord() {
  const m = await memberWithWorkspace(app);
  const record = await m.client.records.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: newId(),
    values: { [m.attribute('name')]: { firstName: 'Ada' } },
    mutationId: newId(),
  });
  return { m, recordId: record.id };
}

describe('tasks.*', () => {
  it('creates a task on a record, reads it by id and in the record’s list, and replays a lost answer', async () => {
    const { m, recordId } = await withRecord();
    const input = { workspace: m.slug, id: newId(), title: 'Call back', recordIds: [recordId], mutationId: newId() };
    const task = await m.client.tasks.create(input);
    expect(task).toMatchObject({ title: 'Call back', isDone: false, recordCount: 1, canChange: true });
    expect(task.records[0]).toMatchObject({ recordId, name: 'Ada' });
    expect(await m.client.tasks.create({ ...input, mutationId: newId() })).toEqual(task);
    expect(await m.client.tasks.get({ workspace: m.slug, ids: [task.id] })).toEqual([task]);
    const page = await m.client.tasks.list({ workspace: m.slug, scope: { recordId }, status: 'open' });
    expect(page).toEqual({ items: [task], total: { count: 1, atLeast: false } });
    const done = await m.client.tasks.update({ workspace: m.slug, taskId: task.id, isDone: true, mutationId: newId() });
    expect(done.isDone).toBe(true);
    expect((await m.client.tasks.list({ workspace: m.slug, scope: { recordId }, status: 'done' })).items).toEqual([
      done,
    ]);
  });

  it('answers the refusals with their codes, statuses and fields', async () => {
    const { m, recordId } = await withRecord();
    expect(
      await refusal(() =>
        m.client.tasks.create({
          workspace: m.slug,
          id: newId(),
          title: 'A',
          recordIds: [newId()],
          mutationId: newId(),
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', status: 404, message: 'That record does not exist.' });
    expect(
      await refusal(() =>
        m.client.tasks.update({ workspace: m.slug, taskId: newId(), title: 'A', mutationId: newId() }),
      ),
    ).toEqual({ code: 'NOT_FOUND', status: 404, message: 'That task does not exist.' });
    const blank = await failure(() =>
      m.client.tasks.create({ workspace: m.slug, id: newId(), title: '   ', mutationId: newId() }),
    );
    expect(blank).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    const tampered = await failure(() =>
      m.client.tasks.list({ workspace: m.slug, scope: { recordId }, status: 'open', cursor: 'bm9wZQ' }),
    );
    expect(tampered).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(tampered.data).toEqual({
      issues: [{ path: ['cursor'], message: 'That task cursor is not valid here. Start again from the top.' }],
    });
    // A task id is the workspace's own: another workspace may use the same one.
    const id = newId();
    await m.client.tasks.create({ workspace: m.slug, id, title: 'A', mutationId: newId() });
    const other = await memberWithWorkspace(app);
    expect(
      (await other.client.tasks.create({ workspace: other.slug, id, title: 'B', mutationId: newId() })).title,
    ).toBe('B');
  });

  it('lists My tasks by filter and status, and refuses a scope it doesn’t know (AC-436)', async () => {
    const { m, recordId } = await withRecord();
    const me = (await m.client.access.mine({ workspace: m.slug })).memberId;
    const mine = await m.client.tasks.create({
      workspace: m.slug,
      id: newId(),
      title: 'Mine',
      assigneeMemberId: me,
      recordIds: [recordId],
      mutationId: newId(),
    });
    const loose = await m.client.tasks.create({ workspace: m.slug, id: newId(), title: 'Loose', mutationId: newId() });
    const list = (mine: 'assigned' | 'created' | 'all', status: 'open' | 'done' = 'open') =>
      m.client.tasks.list({ workspace: m.slug, scope: { mine }, status });
    expect((await list('assigned')).items.map((task) => task.id)).toEqual([mine.id]);
    expect((await list('created')).items.map((task) => task.id)).toEqual([mine.id, loose.id]);
    expect((await list('all')).items).toHaveLength(2);
    await m.client.tasks.update({ workspace: m.slug, taskId: mine.id, isDone: true, mutationId: newId() });
    expect((await list('assigned', 'done')).items.map((task) => task.id)).toEqual([mine.id]);
    const unknown = await failure(() =>
      m.client.tasks.list({
        workspace: m.slug,
        scope: { mine: 'everyone' } as unknown as { mine: 'all' },
        status: 'open',
      }),
    );
    expect(unknown).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
  });
});
