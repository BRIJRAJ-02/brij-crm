// Following a record (collaboration), against a real Postgres as the app role: the follows a write implies, one
// notice per follower per burst that names counts only, never the actor's own, the switch that turns them off, and
// access applied when the inbox is read. `summarizeActivity` is pure and tested first.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mentionToken } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { createComment } from '../comments/comments.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { listNotifications, setNotificationSettings } from '../notifications/inbox.ts';
import { saveNote } from '../notes/notes.ts';
import { addRecord, editRecord } from '../records/records.ts';
import { createTask, updateTask } from '../tasks/tasks.ts';
import { testScope } from '../testing.ts';
import { getFollow, setFollow, summarizeActivity } from './follows.ts';

describe('summarizeActivity', () => {
  it('counts each record’s changed fields once, and leaves out a record the write created', () => {
    const value = (ownerId: string, attributeId: string) => ({
      ownerKind: 'record' as const,
      objectId: 'o',
      ownerId,
      attributeId,
      versionId: 'v',
    });
    expect(
      summarizeActivity({
        createdRecords: [{ recordId: 'new', objectId: 'o' }],
        values: [value('a', 'f1'), value('a', 'f1'), value('a', 'f2'), value('new', 'f1')],
        activity: [
          { recordId: 'a', kind: 'comment' },
          { recordId: 'b', kind: 'task_done' },
          { recordId: 'b', kind: 'note' },
        ],
      }),
    ).toEqual([
      { recordId: 'a', fields: ['f1', 'f2'], notes: 0, comments: 1, tasks: 0 },
      { recordId: 'b', fields: [], notes: 1, comments: 0, tasks: 1 },
    ]);
  });
});

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-follow-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
/** A workspace whose owner Ada works with Bea and Cy, both members. */
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Follows',
    slug: `follows-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const run = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const addMember = async (name: string) => {
    const id = newId();
    await run(sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
      values (${workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@example.com`}, 'member',
        'system', 'system')`);
    return id;
  };
  const bea = await addMember('Bea');
  const cy = await addMember('Cy');
  const [people] = await run<{ id: string }>(sql`select id::text as id from objects where standard_key = 'people'`);
  if (people === undefined) throw new Error('No People object.');
  const attributes = await run<{ id: string; api_slug: string }>(
    sql`select id::text as id, api_slug from attributes where object_id = ${people.id}::uuid`,
  );
  const attribute = (slug: string) => {
    const found = attributes.find((each) => each.api_slug === slug);
    if (found === undefined) throw new Error(`No ${slug}.`);
    return found.id;
  };
  const ada = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const as = (memberId: string, hidden?: string) =>
    testScope({
      db,
      workspaceId,
      actor: { type: 'member', id: memberId },
      role: 'member',
      ...(hidden === undefined
        ? {}
        : {
            rules: {
              levels: [
                {
                  subject: { type: 'role', role: 'member' },
                  target: { type: 'attribute', objectId: people.id, attributeId: hidden },
                  level: 'hidden',
                },
              ],
              records: [],
            },
          }),
    });
  const person = async (scope = ada) =>
    (
      await addRecord(scope, {
        objectId: people.id,
        id: newId(),
        values: { [attribute('name')]: { firstName: 'Grace' } },
      })
    ).record.id;
  const inbox = async (scope: ReturnType<typeof as>) =>
    (await listNotifications(scope, { status: 'inbox' })).items.filter((item) => item.kind === 'record_activity');
  return { workspaceId, adaId: created.memberId, bea, cy, ada, as, attribute, person, inbox, run, peopleId: people.id };
}

describe('following a record', () => {
  it('follows what you create, and one notice per burst names how many fields someone else changed', async () => {
    const w = await world();
    const id = await w.person();
    expect(await getFollow(w.ada, { recordId: id })).toEqual({ following: true });
    expect(await getFollow(w.as(w.bea), { recordId: id })).toEqual({ following: false });
    const bea = w.as(w.bea);
    await editRecord(bea, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    await editRecord(bea, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CEO' } } });
    await editRecord(bea, { recordId: id, values: { [w.attribute('name')]: { value: { firstName: 'Ada' } } } });
    const [notice, ...rest] = await w.inbox(w.ada);
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({
      kind: 'record_activity',
      actor: { type: 'member', id: w.bea },
      record: { recordId: id },
      activity: { fields: 2, notes: 0, comments: 0, tasks: 0 },
      excerpt: '',
    });
    // The stored notice names attributes by id and counts, never a value; it is in app only.
    const [stored] = await w.run<{ activity: unknown; emailed: boolean }>(
      sql`select activity, emailed_at is not null as emailed from notifications where kind = 'record_activity'`,
    );
    expect(JSON.stringify(stored?.activity)).not.toContain('CEO');
    expect(stored?.emailed).toBe(true);
    // Bea doesn't follow it, and Ada's own change tells nobody.
    await editRecord(w.ada, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CFO' } } });
    expect(await w.inbox(bea)).toEqual([]);
  });

  it('counts a comment, a note and a task done, and a new actor starts a notice of their own', async () => {
    const w = await world();
    const id = await w.person();
    const bea = w.as(w.bea);
    await createComment(bea, { id: newId(), recordId: id, body: 'Called her.' });
    await saveNote(bea, { id: newId(), recordId: id, title: 'Call' });
    const task = await createTask(w.ada, { id: newId(), title: 'Follow up', recordIds: [id] });
    await updateTask(bea, { taskId: task.id, isDone: true });
    const fromBea = (await w.inbox(w.ada)).filter((item) => item.actor.id === w.bea);
    expect(fromBea.map((item) => item.activity)).toEqual([{ fields: 0, notes: 1, comments: 1, tasks: 1 }]);
    const cy = w.as(w.cy);
    await editRecord(cy, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    expect((await w.inbox(w.ada)).map((item) => item.actor.id)).toEqual([w.cy, w.bea]);
  });

  it('follows for an owner made and an assignee given a task, and an unfollow stands', async () => {
    const w = await world();
    const id = await w.person();
    await editRecord(w.ada, {
      recordId: id,
      values: { [w.attribute('owner')]: { value: { type: 'member', id: w.bea } } },
    });
    expect(await getFollow(w.as(w.bea), { recordId: id })).toEqual({ following: true });
    await createTask(w.ada, { id: newId(), title: 'Call', recordIds: [id], assigneeMemberId: w.cy });
    expect(await getFollow(w.as(w.cy), { recordId: id })).toEqual({ following: true });
    expect(await setFollow(w.as(w.cy), { recordId: id, following: false })).toEqual({ following: false });
    await editRecord(w.as(w.bea), { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    expect(await w.inbox(w.as(w.cy))).toEqual([]);
  });

  it('tells nobody who turned the notices off', async () => {
    const w = await world();
    const id = await w.person();
    await setNotificationSettings(w.ada, { followedRecords: false });
    await editRecord(w.as(w.bea), { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    expect(await w.inbox(w.ada)).toEqual([]);
  });

  it('counts only the fields the reader may see, and shows nothing when all of them are hidden', async () => {
    const w = await world();
    const id = await w.person(w.as(w.bea));
    const cy = w.as(w.cy);
    await editRecord(cy, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    expect((await w.inbox(w.as(w.bea))).map((item) => item.activity?.fields)).toEqual([1]);
    expect(await w.inbox(w.as(w.bea, w.attribute('job_title')))).toEqual([]);
  });

  it('refuses a record the caller cannot read, as one that does not exist, and writes nothing', async () => {
    const w = await world();
    const missing = await getFollow(w.ada, { recordId: newId() }).catch((error: unknown) => error);
    expect(missing).toMatchObject({ refusals: [{ code: 'NOT_FOUND' }] });
    // A real record on an object hidden from Bea answers the same, for a read and a follow alike.
    const id = await w.person();
    const hidden = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.bea },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: w.peopleId },
            level: 'none',
          },
        ],
        records: [],
      },
    });
    const read = await getFollow(hidden, { recordId: id }).catch((error: unknown) => error);
    const set = await setFollow(hidden, { recordId: id, following: true }).catch((error: unknown) => error);
    expect(read).toMatchObject({ message: (missing as Error).message, refusals: [{ code: 'NOT_FOUND' }] });
    expect(set).toMatchObject({ message: (missing as Error).message, refusals: [{ code: 'NOT_FOUND' }] });
    const rows = await w.run<{ n: number }>(
      sql`select count(*)::int as n from record_follows where member_id = ${w.bea}::uuid`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('tells a mentioned follower once, by the mention, and a merge never moves the notice', async () => {
    const w = await world();
    const id = await w.person();
    const bea = w.as(w.bea);
    await createComment(bea, { id: newId(), recordId: id, body: `Over to ${mentionToken(w.adaId)}` });
    expect(await w.inbox(w.ada)).toEqual([]);
    await editRecord(bea, { recordId: id, values: { [w.attribute('job_title')]: { value: 'CTO' } } });
    const [first] = await w.inbox(w.ada);
    await editRecord(bea, { recordId: id, values: { [w.attribute('name')]: { value: { firstName: 'Ada' } } } });
    const [merged, ...rest] = await w.inbox(w.ada);
    expect(rest).toEqual([]);
    expect(merged?.activity?.fields).toBe(2);
    expect(merged?.createdAt).toBe(first?.createdAt);
  });
});
