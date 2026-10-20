// Spec 0019, milestone 1, step 3, against a real Postgres as the app role:
// creating and changing tasks, their outbox rows, replays, the record's task
// list and its cursors, the task rule and the change rule with injected
// rules, the timeline's task entries, and the record lock a link takes.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AccessRules } from '../access/policy.ts';
import { getActivity } from '../engine/activity.ts';
import { deleteRecord, eraseRecord } from '../engine/deletion.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord, setValues } from '../engine/records.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { readTaskFacts } from './facts.ts';
import { archiveObject } from '../objects/objects.ts';
import { createTask, deleteTask, getTasks, listTasks, POSITION_RENUMBER, restoreTask, updateTask } from './tasks.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-tasks-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Tasks',
    slug: `tasks-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => ids[slug] ?? '';
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    return id;
  };
  const bea = await addMember('bea');
  const cal = await addMember('cal');
  const companies = created.objects.companies ?? '';
  const people = created.objects.people ?? '';
  const company = async (name: string) =>
    (await createRecord(scope, { objectId: companies, values: { [attribute('companies.name')]: name } })).recordId;
  const person = async (firstName: string) =>
    (await createRecord(scope, { objectId: people, values: { [attribute('people.name')]: { firstName } } })).recordId;
  const as = (memberId: string, rules?: AccessRules) =>
    rescope(scope, { actor: { type: 'member', id: memberId }, role: 'member', ...(rules ? { rules } : {}) });
  const level = (objectId: string, value: string): AccessRules => ({
    levels: [{ subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId }, level: value }],
    records: [],
  });
  const outbox = async () =>
    (
      await db.withWorkspace(created.workspaceId, (tx) =>
        tx.execute<{ item_ids: string[]; record_ids: string[]; mutation_id: string | null }>(
          sql`select item_ids::text[] as item_ids, record_ids::text[] as record_ids, mutation_id::text as mutation_id from outbox where kind = 'tasks' order by seq`,
        ),
      )
    ).rows;
  const ownedCompany = async (name: string, memberId: string) =>
    (
      await createRecord(scope, {
        objectId: companies,
        values: {
          [attribute('companies.name')]: name,
          [attribute('companies.owner')]: { type: 'member', id: memberId },
        },
      })
    ).recordId;
  /** A record rule: members see only the companies they own (spec 0009's `own`). */
  const ownCompanies: AccessRules = {
    levels: [],
    records: [
      {
        subject: { type: 'role', role: 'member' },
        objectId: companies,
        kind: 'own',
        attributeId: attribute('companies.owner'),
      },
    ],
  };
  return {
    scope,
    ownerId: created.memberId,
    bea,
    cal,
    companies,
    people,
    company,
    person,
    as,
    level,
    outbox,
    ownedCompany,
    ownCompanies,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (isInputError(error)) return { code: 'INPUT_INVALID', ...error.inputProblem };
    throw error;
  }
  throw new Error('It was let through.');
}

const hooks = (mutationId = newId()) => [outboxHook({ mutationId })];

/** A promise opened from outside: `done` settles once `open()` is called. */
function latch(): { readonly done: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { done, open };
}

describe('createTask (AC-432, AC-448, AC-449)', () => {
  it('makes a task with its links in order, and one outbox row naming it and its records', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const mutationId = newId();
    const id = newId();
    const view = await createTask(
      w.scope,
      { id, title: '  Send the proposal  ', dueOn: '2026-10-20', assigneeMemberId: w.ownerId, recordIds: [acme, ada] },
      hooks(mutationId),
    );
    expect(view).toMatchObject({
      id,
      title: 'Send the proposal',
      isDone: false,
      dueOn: '2026-10-20',
      assigneeMemberId: w.ownerId,
      recordCount: 2,
      canChange: true,
      createdBy: { type: 'member', id: w.ownerId },
    });
    expect(view.records.map((record) => record.recordId)).toEqual([acme, ada]);
    expect(view.records[0]?.name).toBe('Acme');
    expect(await w.outbox()).toEqual([{ item_ids: [id], record_ids: [acme, ada].sort(), mutation_id: mutationId }]);
  });

  it('returns the same task for a replay and writes nothing twice; another member’s id is ID_TAKEN', async () => {
    const w = await workspace();
    const id = newId();
    const first = await createTask(w.scope, { id, title: 'Call back' }, hooks());
    const again = await createTask(w.scope, { id, title: 'Call back' }, hooks());
    expect(again).toEqual(first);
    expect(await w.outbox()).toHaveLength(1);
    expect(await refusalOf(createTask(w.as(w.bea), { id, title: 'Mine' }, hooks()))).toMatchObject({
      code: 'ID_TAKEN',
    });
    expect(await w.outbox()).toHaveLength(1);
  });

  it('refuses an assignee who is not an active member, a missing record, a 21st link and a bad title', async () => {
    const w = await workspace();
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: 'A', assigneeMemberId: newId() }))).toEqual({
      code: 'NOT_FOUND',
      message: "That member isn't in this workspace.",
    });
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: 'A', recordIds: [newId()] }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
    const many = Array.from({ length: 21 }, () => newId());
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: 'A', recordIds: many }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: '   ' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'title',
    });
    expect(await w.outbox()).toEqual([]);
  });

  it('refuses a link to a record whose object the writer may only read, and writes nothing (AC-447)', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const reader = w.as(w.bea, w.level(w.companies, 'read'));
    expect(await refusalOf(createTask(reader, { id: newId(), title: 'A', recordIds: [acme] }, hooks()))).toEqual({
      code: 'FORBIDDEN',
      message: "You can't link a task to a record you can't change.",
    });
    expect(
      await refusalOf(
        createTask(w.as(w.bea, w.level(w.companies, 'none')), { id: newId(), title: 'A', recordIds: [acme] }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await w.outbox()).toEqual([]);
    // A record in the trash can't be linked either.
    await deleteRecord(w.scope, { recordId: acme });
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: 'A', recordIds: [acme] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("doesn't wait for an edit of a linked record, but waits for its removal (the key share lock)", async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const other = createDatabase({ url: appUrl, applicationName: 'crm-tasks-lock' });
    try {
      // An edit holds the record row (no key update): the create goes ahead.
      const held = latch();
      const isLocked = latch();
      const editing = other.withWorkspace(w.scope.workspaceId, async (tx) => {
        await tx.execute(sql`update records set revision = revision + 1 where id = ${acme}::uuid`);
        isLocked.open();
        await held.done;
      });
      await isLocked.done;
      const made = await createTask(w.scope, { id: newId(), title: 'While editing', recordIds: [acme] });
      expect(made.recordCount).toBe(1);
      held.open();
      await editing;

      // A removal holds it for update: the create waits until it is gone.
      const heldDelete = latch();
      const isDeleteLocked = latch();
      const removing = other.withWorkspace(w.scope.workspaceId, async (tx) => {
        await tx.execute(sql`select id from records where id = ${acme}::uuid for update`);
        isDeleteLocked.open();
        await heldDelete.done;
      });
      await isDeleteLocked.done;
      let settled = false;
      const waiting = createTask(w.scope, { id: newId(), title: 'While removing', recordIds: [acme] }).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      heldDelete.open();
      await removing;
      await waiting;
    } finally {
      await other.close();
    }
  });
});

describe('updateTask (AC-433, AC-434, AC-447, AC-448)', () => {
  it('ticks a task done with who and when, unticks it, and stores nothing for no change', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, { id: newId(), title: 'Tick', recordIds: [acme] }, hooks());
    const done = await updateTask(w.as(w.bea), { taskId: task.id, isDone: true }, hooks());
    expect(done).toMatchObject({ isDone: true, doneBy: { type: 'member', id: w.bea } });
    expect(done.doneAt).toBeDefined();
    const same = await updateTask(w.as(w.bea), { taskId: task.id, isDone: true, title: 'Tick' }, hooks());
    expect(same.doneAt).toBe(done.doneAt);
    const open = await updateTask(w.scope, { taskId: task.id, isDone: false }, hooks());
    expect(open.isDone).toBe(false);
    expect(open.doneAt).toBeUndefined();
    expect(open.doneBy).toBeUndefined();
    expect(await w.outbox()).toHaveLength(3);
  });

  it('sets and clears the due date and the assignee, and names every record linked before or after', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const task = await createTask(w.scope, { id: newId(), title: 'Links', recordIds: [acme] }, hooks());
    const changed = await updateTask(
      w.scope,
      { taskId: task.id, dueOn: '2026-11-01', assigneeMemberId: w.bea, addRecordIds: [ada], removeRecordIds: [acme] },
      hooks(),
    );
    expect(changed).toMatchObject({ dueOn: '2026-11-01', assigneeMemberId: w.bea, recordCount: 1 });
    expect(changed.records.map((record) => record.recordId)).toEqual([ada]);
    const cleared = await updateTask(w.scope, { taskId: task.id, dueOn: null, assigneeMemberId: null }, hooks());
    expect(cleared.dueOn).toBeUndefined();
    expect(cleared.assigneeMemberId).toBeUndefined();
    const rows = await w.outbox();
    expect(rows[1]).toMatchObject({ item_ids: [task.id], record_ids: [acme, ada].sort() });
  });

  it('refuses a member outside the change rule, and lets anyone change a task with no links', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const linked = await createTask(w.scope, { id: newId(), title: 'Owner’s', recordIds: [acme] });
    const reader = w.as(w.bea, w.level(w.companies, 'read'));
    const [seen] = await getTasks(reader, { ids: [linked.id] });
    expect(seen?.canChange).toBe(false);
    expect(await refusalOf(updateTask(reader, { taskId: linked.id, title: 'Mine now' }, hooks()))).toEqual({
      code: 'FORBIDDEN',
      message: 'You can view this task but not change it.',
    });
    const loose = await createTask(w.scope, { id: newId(), title: 'Loose' });
    expect((await updateTask(reader, { taskId: loose.id, title: 'Anyone' })).title).toBe('Anyone');
    // The assignee may change it whatever their level.
    const assigned = await createTask(w.scope, {
      id: newId(),
      title: 'Bea’s',
      recordIds: [acme],
      assigneeMemberId: w.bea,
    });
    expect((await updateTask(reader, { taskId: assigned.id, isDone: true })).isDone).toBe(true);
  });

  it('never removes a link the writer can’t see, and counts it toward the 20', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const task = await createTask(w.scope, {
      id: newId(),
      title: 'Mixed',
      recordIds: [acme, ada],
      assigneeMemberId: w.bea,
    });
    const blind = w.as(w.bea, w.level(w.people, 'none'));
    const [seen] = await getTasks(blind, { ids: [task.id] });
    expect(seen?.records.map((record) => record.recordId)).toEqual([acme]);
    const after = await updateTask(blind, { taskId: task.id, removeRecordIds: [acme, ada] });
    expect(after.records).toEqual([]);
    const [asOwner] = await getTasks(w.scope, { ids: [task.id] });
    expect(asOwner?.records.map((record) => record.recordId)).toEqual([ada]);
    // 19 more visible links fill the task (the hidden one counts), so a 21st is refused.
    const companies = await Promise.all(Array.from({ length: 19 }, (_, n) => w.company(`C${String(n)}`)));
    await updateTask(blind, { taskId: task.id, addRecordIds: companies });
    const extra = await w.company('One too many');
    expect(await refusalOf(updateTask(blind, { taskId: task.id, addRecordIds: [extra] }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
  });
});

describe('the security review (spec 0019)', () => {
  it('answers re-linking a hidden record as an unknown record, never as already linked', async () => {
    const w = await workspace();
    const ada = await w.person('Ada');
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, {
      id: newId(),
      title: 'Mixed',
      recordIds: [acme, ada],
      assigneeMemberId: w.bea,
    });
    const blind = w.as(w.bea, w.level(w.people, 'none'));
    expect(await refusalOf(updateTask(blind, { taskId: task.id, addRecordIds: [ada] }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
    expect(await refusalOf(updateTask(blind, { taskId: task.id, addRecordIds: [newId()] }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
  });

  it('keeps tasks from an API key whose data level doesn’t reach them, links or none', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const loose = await createTask(w.scope, { id: newId(), title: 'No links' });
    const key = (scopes: readonly string[]) => rescope(w.scope, { actor: { type: 'api_key', id: newId() }, scopes });
    const none = key([]);
    expect(await getTasks(none, { ids: [loose.id] })).toEqual([]);
    expect(await refusalOf(listTasks(none, { scope: { recordId: acme }, status: 'open' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(createTask(none, { id: newId(), title: 'Mine' }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(updateTask(none, { taskId: loose.id, title: 'Mine' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const reader = key(['data.read']);
    expect(await getTasks(reader, { ids: [loose.id] })).toHaveLength(1);
    expect(await refusalOf(updateTask(reader, { taskId: loose.id, title: 'Mine' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const writer = key(['data.write']);
    expect((await updateTask(writer, { taskId: loose.id, title: 'Keyed' })).title).toBe('Keyed');
  });

  it('lets a record linked to a task be erased: the link goes, the task stays', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, { id: newId(), title: 'Survives', recordIds: [acme] });
    await eraseRecord(w.scope, { recordId: acme });
    const [left] = await getTasks(w.scope, { ids: [task.id] });
    expect(left?.recordCount).toBe(0);
  });

  it('closes a task’s link places up before they could overflow', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const task = await createTask(w.scope, { id: newId(), title: 'Long lived', recordIds: [acme] });
    await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute(sql`update task_records set position = ${POSITION_RENUMBER} where task_id = ${task.id}::uuid`),
    );
    const after = await updateTask(w.scope, { taskId: task.id, addRecordIds: [ada] });
    expect(after.records.map((record) => record.recordId)).toEqual([acme, ada]);
    const places = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ position: number }>(
        sql`select position from task_records where task_id = ${task.id}::uuid order by position`,
      ),
    );
    expect(places.rows.map((row) => row.position)).toEqual([0, 1]);
  });
});

describe('the task rule (AC-447)', () => {
  it('shows a task whose every link is in the trash to its assignee and creator only', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, {
      id: newId(),
      title: 'Orphan',
      recordIds: [acme],
      assigneeMemberId: w.bea,
    });
    await deleteRecord(w.scope, { recordId: acme });
    expect((await getTasks(w.scope, { ids: [task.id] })).map((view) => view.recordCount)).toEqual([0]);
    expect(await getTasks(w.as(w.bea), { ids: [task.id] })).toHaveLength(1);
    expect(await getTasks(w.as(w.cal), { ids: [task.id] })).toEqual([]);
    expect(await refusalOf(updateTask(w.as(w.cal), { taskId: task.id, title: 'Hm' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reads facts for the relay: people, links and the trash', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, { id: newId(), title: 'Facts', recordIds: [acme], assigneeMemberId: w.bea });
    await deleteRecord(w.scope, { recordId: acme });
    const facts = await db.withWorkspace(w.scope.workspaceId, (tx) => readTaskFacts(tx, [task.id, 'nope']));
    expect({ ...facts }).toEqual({
      [task.id]: {
        creatorMemberId: w.ownerId,
        assigneeMemberIds: [w.bea],
        records: [{ objectId: w.companies, recordId: acme, trashed: true }],
      },
    });
  });
});

describe('listTasks (AC-435)', () => {
  async function seeded() {
    const w = await workspace();
    const acme = await w.company('Acme');
    const make = (title: string, dueOn?: string) =>
      createTask(w.scope, { id: newId(), title, recordIds: [acme], ...(dueOn === undefined ? {} : { dueOn }) });
    const late = await make('Late', '2026-11-05');
    const none1 = await make('No date 1');
    const soon = await make('Soon', '2026-10-01');
    const none2 = await make('No date 2');
    const mid = await make('Mid', '2026-10-15');
    return { w, acme, late, none1, soon, none2, mid };
  }

  it('orders open tasks by due date, no date last, then oldest first, and pages with no repeat or gap', async () => {
    const { w, acme, late, none1, soon, none2, mid } = await seeded();
    const first = await listTasks(w.scope, { scope: { recordId: acme }, status: 'open', limit: 2 });
    expect(first.total).toEqual({ count: 5, atLeast: false });
    const ids = [...first.items.map((item) => item.id)];
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page = await listTasks(w.scope, { scope: { recordId: acme }, status: 'open', limit: 2, cursor });
      expect(page.total).toBeUndefined();
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(ids).toEqual([soon.id, mid.id, late.id, none1.id, none2.id]);
  });

  it('lists done tasks newest done first', async () => {
    const { w, acme, late, soon } = await seeded();
    await updateTask(w.scope, { taskId: late.id, isDone: true });
    await updateTask(w.scope, { taskId: soon.id, isDone: true });
    const done = await listTasks(w.scope, { scope: { recordId: acme }, status: 'done' });
    expect(done.items.map((item) => item.id)).toEqual([soon.id, late.id]);
    expect(done.total).toEqual({ count: 2, atLeast: false });
    const open = await listTasks(w.scope, { scope: { recordId: acme }, status: 'open' });
    expect(open.total?.count).toBe(3);
  });

  it('refuses a cursor it didn’t make on cursor, and a hidden or trashed record as NOT_FOUND', async () => {
    const { w, acme } = await seeded();
    const tampered = Buffer.from(
      JSON.stringify({ status: 'open', dueOn: null, createdAt: "x'; --", id: newId() }),
    ).toString('base64url');
    const cursorOf = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    // Moments and days of the right shape that Postgres can't read: refused on cursor, never a 500.
    const outOfRange = [
      cursorOf({ status: 'open', dueOn: null, createdAt: '2026-13-45T00:00:00.000000Z', id: newId() }),
      cursorOf({ status: 'open', dueOn: '0000-01-01', createdAt: '2026-10-01T00:00:00.000000Z', id: newId() }),
      cursorOf({ status: 'open', dueOn: null, createdAt: '0000-01-01T00:00:00.000000Z', id: newId() }),
    ];
    for (const cursor of ['nope', tampered, ...outOfRange]) {
      expect(await refusalOf(listTasks(w.scope, { scope: { recordId: acme }, status: 'open', cursor }))).toMatchObject({
        code: 'INPUT_INVALID',
        field: 'cursor',
      });
    }
    const first = await listTasks(w.scope, { scope: { recordId: acme }, status: 'open', limit: 1 });
    expect(
      await refusalOf(
        listTasks(w.scope, { scope: { recordId: acme }, status: 'done', cursor: first.nextCursor ?? '' }),
      ),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'cursor' });
    expect(
      await refusalOf(
        listTasks(w.as(w.bea, w.level(w.companies, 'none')), { scope: { recordId: acme }, status: 'open' }),
      ),
    ).toEqual({ code: 'NOT_FOUND', message: 'That record does not exist.' });
    await deleteRecord(w.scope, { recordId: acme });
    expect(await refusalOf(listTasks(w.scope, { scope: { recordId: acme }, status: 'open' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('listTasks for My tasks (AC-436, AC-447)', () => {
  const ids = (page: { readonly items: readonly { readonly id: string }[] }) => page.items.map((item) => item.id);

  it('lists the tasks assigned to me, created by me, or every task I may see, in due order', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const bea = w.as(w.bea);
    const mineLate = await createTask(w.scope, {
      id: newId(),
      title: 'Mine late',
      dueOn: '2026-11-01',
      assigneeMemberId: w.ownerId,
    });
    const mineSoon = await createTask(w.scope, {
      id: newId(),
      title: 'Mine soon',
      dueOn: '2026-10-01',
      assigneeMemberId: w.ownerId,
      recordIds: [acme],
    });
    const forBea = await createTask(w.scope, {
      id: newId(),
      title: 'For Bea',
      assigneeMemberId: w.bea,
      recordIds: [acme],
    });
    const beasOwn = await createTask(bea, { id: newId(), title: 'Bea’s own', assigneeMemberId: w.ownerId });
    const unassigned = await createTask(bea, { id: newId(), title: 'Nobody’s' });

    const assigned = await listTasks(w.scope, { scope: { mine: 'assigned' }, status: 'open' });
    expect(ids(assigned)).toEqual([mineSoon.id, mineLate.id, beasOwn.id]);
    expect(assigned.total).toBeUndefined();
    expect(ids(await listTasks(w.scope, { scope: { mine: 'created' }, status: 'open' }))).toEqual([
      mineSoon.id,
      mineLate.id,
      forBea.id,
    ]);
    expect(ids(await listTasks(w.scope, { scope: { mine: 'all' }, status: 'open' }))).toEqual([
      mineSoon.id,
      mineLate.id,
      forBea.id,
      beasOwn.id,
      unassigned.id,
    ]);
    expect(ids(await listTasks(bea, { scope: { mine: 'assigned' }, status: 'open' }))).toEqual([forBea.id]);

    await updateTask(w.scope, { taskId: mineLate.id, isDone: true });
    await updateTask(w.scope, { taskId: beasOwn.id, isDone: true });
    const done = await listTasks(w.scope, { scope: { mine: 'assigned' }, status: 'done' });
    expect(ids(done)).toEqual([beasOwn.id, mineLate.id]);
    expect(ids(await listTasks(w.scope, { scope: { mine: 'assigned' }, status: 'open' }))).toEqual([mineSoon.id]);
  });

  it('pages each filter with no repeat or gap, and refuses a cursor of the other status', async () => {
    const w = await workspace();
    const made: string[] = [];
    for (const dueOn of ['2026-10-03', undefined, '2026-10-01', undefined, '2026-10-02']) {
      made.push(
        (
          await createTask(w.scope, {
            id: newId(),
            title: 'Page',
            assigneeMemberId: w.ownerId,
            ...(dueOn === undefined ? {} : { dueOn }),
          })
        ).id,
      );
    }
    for (const mine of ['assigned', 'created', 'all'] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listTasks(w.scope, {
          scope: { mine },
          status: 'open',
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        seen.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      expect(seen).toEqual([made[2], made[4], made[0], made[1], made[3]]);
    }
    const first = await listTasks(w.scope, { scope: { mine: 'all' }, status: 'open', limit: 1 });
    expect(
      await refusalOf(listTasks(w.scope, { scope: { mine: 'all' }, status: 'done', cursor: first.nextCursor ?? '' })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'cursor' });
  });

  it('leaves out of All tasks what the task rule hides, from lists and counts alike (denied actor)', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const hidden = await createTask(w.scope, { id: newId(), title: 'On a company', recordIds: [acme] });
    const both = await createTask(w.scope, { id: newId(), title: 'On both', recordIds: [acme, ada] });
    const free = await createTask(w.scope, { id: newId(), title: 'On nothing' });
    const theirs = await createTask(w.scope, {
      id: newId(),
      title: 'Assigned to Cal',
      recordIds: [acme],
      assigneeMemberId: w.cal,
    });
    const trashedOnly = await createTask(w.scope, { id: newId(), title: 'Trashed link', recordIds: [ada] });
    const bo = await w.person('Bo');
    const boTask = await createTask(w.scope, { id: newId(), title: 'Bo', recordIds: [bo] });
    await deleteRecord(w.scope, { recordId: bo });

    // Bea can't see Companies: only tasks with no links, or a visible live link.
    const bea = w.as(w.bea, w.level(w.companies, 'none'));
    const page = await listTasks(bea, { scope: { mine: 'all' }, status: 'open' });
    expect(ids(page)).toEqual([both.id, free.id, trashedOnly.id]);

    expect(page.items.find((item) => item.id === both.id)?.records.map((record) => record.recordId)).toEqual([ada]);
    expect(ids(page)).not.toContain(hidden.id);
    // Cal is the assignee: his task shows whatever its links.
    const cal = w.as(w.cal, w.level(w.companies, 'none'));
    expect(ids(await listTasks(cal, { scope: { mine: 'all' }, status: 'open' }))).toContain(theirs.id);
    expect(ids(await listTasks(cal, { scope: { mine: 'assigned' }, status: 'open' }))).toEqual([theirs.id]);
    // Even under the open policy, a task whose only link is in the trash shows only to its assignee and creator.
    expect(ids(await listTasks(w.as(w.bea), { scope: { mine: 'all' }, status: 'open' }))).not.toContain(boTask.id);
    expect(ids(await listTasks(w.scope, { scope: { mine: 'all' }, status: 'open' }))).toContain(boTask.id);
  });

  it('gives an API key at none no task at all, and one at read only All tasks', async () => {
    const w = await workspace();
    await createTask(w.scope, { id: newId(), title: 'Free', assigneeMemberId: w.ownerId });
    const key = (level: 'none' | 'read') =>
      rescope(w.scope, { actor: { type: 'api_key', id: newId() }, scopes: level === 'read' ? ['data.read'] : [] });
    expect(await listTasks(key('none'), { scope: { mine: 'all' }, status: 'open' })).toEqual({ items: [] });
    expect((await listTasks(key('read'), { scope: { mine: 'assigned' }, status: 'open' })).items).toEqual([]);
  });
});

describe('the security review (spec 0019, milestones 2 to 4)', () => {
  it('applies an injected record rule in All tasks: a task shows by a linked record the member may see, and only that one', async () => {
    const w = await workspace();
    const mine = await w.ownedCompany('Mine', w.bea);
    const theirs = await w.ownedCompany('Theirs', w.ownerId);
    const onTheirs = await createTask(w.scope, { id: newId(), title: 'On theirs', recordIds: [theirs] });
    const onBoth = await createTask(w.scope, { id: newId(), title: 'On both', recordIds: [theirs, mine] });
    const bea = w.as(w.bea, w.ownCompanies);
    const page = await listTasks(bea, { scope: { mine: 'all' }, status: 'open' });
    expect(page.items.map((item) => item.id)).toEqual([onBoth.id]);
    expect(page.items[0]?.records.map((record) => record.recordId)).toEqual([mine]);
    expect(await getTasks(bea, { ids: [onTheirs.id] })).toEqual([]);
    expect(await refusalOf(listTasks(bea, { scope: { recordId: theirs }, status: 'open' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Her edit of the task she can see keeps the link she can't.
    await updateTask(bea, { taskId: onBoth.id, title: 'Renamed' });
    expect((await getTasks(w.scope, { ids: [onBoth.id] }))[0]?.records.map((record) => record.recordId)).toEqual([
      theirs,
      mine,
    ]);
  });

  it('treats a record on an archived object as not live: its task shows only to its assignee and creator', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, {
      id: newId(),
      title: 'Archived link',
      recordIds: [acme],
      assigneeMemberId: w.bea,
    });
    await archiveObject(w.scope, { objectId: w.companies });
    expect(await getTasks(w.as(w.cal), { ids: [task.id] })).toEqual([]);
    expect(
      (await listTasks(w.as(w.cal), { scope: { mine: 'all' }, status: 'open' })).items.map((item) => item.id),
    ).not.toContain(task.id);
    expect((await getTasks(w.as(w.bea), { ids: [task.id] }))[0]?.recordCount).toBe(0);
    const facts = await db.withWorkspace(w.scope.workspaceId, (tx) => readTaskFacts(tx, [task.id]));
    expect(facts[task.id]?.records).toEqual([{ objectId: w.companies, recordId: acme, trashed: true }]);
  });

  it('keeps a deleted task’s facts, so its delete event reaches those who saw it', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, { id: newId(), title: 'Gone', recordIds: [acme], assigneeMemberId: w.bea });
    await deleteTask(w.scope, { taskId: task.id });
    const facts = await db.withWorkspace(w.scope.workspaceId, (tx) => readTaskFacts(tx, [task.id]));
    expect(facts[task.id]).toEqual({
      creatorMemberId: w.ownerId,
      assigneeMemberIds: [w.bea],
      records: [{ objectId: w.companies, recordId: acme }],
    });
  });

  it('refuses NUL in a title as invalid input, never a database error', async () => {
    const w = await workspace();
    expect(await refusalOf(createTask(w.scope, { id: newId(), title: 'Call\u0000back' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'title',
    });
  });
});

describe('deleting and restoring a task (AC-445, AC-447, AC-448)', () => {
  it('hides a deleted task from every read at once and brings it back exactly as it was', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, {
      id: newId(),
      title: 'Ship it',
      recordIds: [acme],
      assigneeMemberId: w.ownerId,
    });
    await deleteTask(w.scope, { taskId: task.id }, hooks());
    expect(await getTasks(w.scope, { ids: [task.id] })).toEqual([]);
    expect((await listTasks(w.scope, { scope: { recordId: acme }, status: 'open' })).total?.count).toBe(0);
    expect((await listTasks(w.scope, { scope: { mine: 'assigned' }, status: 'open' })).items).toEqual([]);
    expect(await refusalOf(updateTask(w.scope, { taskId: task.id, title: 'x' }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(deleteTask(w.scope, { taskId: task.id }))).toMatchObject({ code: 'NOT_FOUND' });
    const back = await restoreTask(w.scope, { taskId: task.id }, hooks());
    expect({ ...back, updatedAt: task.updatedAt }).toEqual(task);
    expect((await w.outbox()).slice(-2).map((row) => row.record_ids)).toEqual([[acme], [acme]]);
  });

  it('lets only someone inside the change rule delete or restore, and stores nothing refused', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const task = await createTask(w.scope, { id: newId(), title: 'Mine', recordIds: [acme] });
    const before = (await w.outbox()).length;
    const reader = w.as(w.bea, w.level(w.companies, 'read'));
    expect(await refusalOf(deleteTask(reader, { taskId: task.id }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(deleteTask(w.as(w.bea, w.level(w.companies, 'none')), { taskId: task.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await w.outbox()).toHaveLength(before);
  });
});

describe('the timeline’s task entries (AC-438)', () => {
  const taskEntries = async (scope: EngineScope, recordId: string) =>
    (await getActivity(scope, { recordId })).entries
      .filter((entry) => entry.kind === 'task')
      .map((entry) => ({ itemId: entry.itemId, isDone: entry.isDone, title: entry.title, actor: entry.actor?.id }));

  it('shows "added a task" when linked and "completed a task" when done, and drops both on unlink', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    const ada = await w.person('Ada');
    const task = await createTask(w.scope, { id: newId(), title: 'Follow up', recordIds: [acme] });
    await updateTask(w.as(w.bea), { taskId: task.id, addRecordIds: [ada] });
    await updateTask(w.as(w.bea), { taskId: task.id, isDone: true });
    expect(await taskEntries(w.scope, acme)).toEqual([
      { itemId: task.id, isDone: true, title: 'Follow up', actor: w.bea },
      { itemId: task.id, isDone: false, title: 'Follow up', actor: w.ownerId },
    ]);
    expect(await taskEntries(w.scope, ada)).toEqual([
      { itemId: task.id, isDone: true, title: 'Follow up', actor: w.bea },
      { itemId: task.id, isDone: false, title: 'Follow up', actor: w.bea },
    ]);
    await updateTask(w.scope, { taskId: task.id, removeRecordIds: [ada] });
    expect(await taskEntries(w.scope, ada)).toEqual([]);
    // Edits to the record's own values still read alongside (the merge).
    await setValues(w.scope, { recordId: acme, values: {} });
    expect(await taskEntries(w.scope, acme)).toHaveLength(2);
  });

  it('pages task entries with the rest of the timeline, with no repeat or gap', async () => {
    const w = await workspace();
    const acme = await w.company('Acme');
    for (let n = 0; n < 7; n += 1)
      await createTask(w.scope, { id: newId(), title: `T${String(n)}`, recordIds: [acme] });
    const whole = (await getActivity(w.scope, { recordId: acme })).entries.map((entry) => entry.id);
    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await getActivity(w.scope, {
        recordId: acme,
        limit: 3,
        ...(cursor === undefined ? {} : { cursor }),
      });
      paged.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(paged).toEqual(whole);
    expect(whole.filter((id) => id.startsWith('task:'))).toHaveLength(7);
  });
});

describe('access walk helpers', () => {
  it('answers getTasks with only visible tasks, in the order asked', async () => {
    const w = await workspace();
    const a = await createTask(w.scope, { id: newId(), title: 'A' });
    const b = await createTask(w.scope, { id: newId(), title: 'B' });
    expect((await getTasks(w.scope, { ids: [b.id, newId(), 'bad', a.id] })).map((view) => view.title)).toEqual([
      'B',
      'A',
    ]);
  });
});
