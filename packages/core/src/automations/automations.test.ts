// Automations (parity #53), against a real Postgres as the app role: the write hook queues one run per event, the
// executor runs it as the member the automation runs as (tasks, a set field, a notice), every action once however often
// a run is repeated, an automation's own writes start nothing, a failing automation switches itself off, a member who
// left switches theirs off at once, and a failure inside the hook never breaks the user's write.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AUTOMATION_FAILURES_MAX, type AutomationDefinition } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterAsAutomation, NO_RULE_SOURCE, systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, setValues } from '../engine/records.ts';
import type { AfterWrite } from '../engine/write.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { createTask, listTasks } from '../tasks/tasks.ts';
import { listNotifications } from '../notifications/inbox.ts';
import { removeMember } from '../members/members.ts';
import { automationHook } from './hook.ts';
import { derivedTaskId, queueDueAutomations, runAutomationQueue, type AutomationRunDeps } from './run.ts';
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  setAutomationEnabled,
} from './service.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-automations-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Auto',
    slug: `auto-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const attr = (slug: string): string => ids[slug] ?? '';
  const options = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; label: string }>(
      sql`select id::text, label from attribute_options where attribute_id = ${attr('deals.stage')}::uuid`,
    ),
  );
  const stage = (label: string): string => options.rows.find((row) => row.label === label)?.id ?? '';
  const hooks = [outboxHook(), automationHook()];
  const deals = created.objects.deals ?? '';
  const deal = async (name: string, hookList = hooks) =>
    (await createRecord(owner, { objectId: deals, values: { [attr('deals.name')]: name } }, hookList)).recordId;
  const deps: AutomationRunDeps = {
    door: { db, rules: NO_RULE_SOURCE },
    systemScope: (workspaceId) => systemScope(db, workspaceId),
    hooks: () => [outboxHook()],
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
  const make = (definition: AutomationDefinition, scope = owner) =>
    createAutomation(scope, { id: newId(), definition });
  const run = () => runAutomationQueue(deps, created.workspaceId);
  const q = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const tasks = () => listTasks(owner, { scope: { mine: 'all' }, status: 'open' }).then((page) => page.items);
  return { ...created, owner, attr, stage, deals, deal, deps, make, run, q, tasks, hooks };
}

const createdDeal = (objectId: string): AutomationDefinition => ({
  trigger: { kind: 'record_created', objectId },
  actions: [{ kind: 'create_task', title: 'Send contract', assignee: { kind: 'owner' }, dueInDays: 3 }],
});

describe('a record created', () => {
  it('queues one run, runs it as Automation, and makes one task linked to the record', async () => {
    const w = await world();
    const automation = await w.make(createdDeal(w.deals));
    const dealId = await w.deal('Acme');
    const queued = await w.q<{ status: string }>(sql`select status from automation_runs`);
    expect(queued).toEqual([{ status: 'queued' }]);

    expect(await w.run()).toEqual({ ran: 1, more: false });
    const tasks = await w.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Send contract' });
    expect(tasks[0]?.records.map((record) => record.recordId)).toEqual([dealId]);
    const { runs } = await listAutomationRuns(w.owner);
    expect(runs).toMatchObject([{ automationId: automation.id, status: 'done', subjectId: dealId }]);
    const [stored] = await w.q<{ created_by_type: string }>(sql`select created_by_type from tasks`);
    expect(stored?.created_by_type).toBe('automation');
  });

  it('never makes a second run or a second task for the same event, even run again', async () => {
    const w = await world();
    await w.make(createdDeal(w.deals));
    await w.deal('Acme');
    await w.run();
    // The same event offered again (a replayed hook) adds no run.
    const [only] = await w.q<{ record: string; automation: string }>(
      sql`select subject_id::text as record, automation_id::text as automation from automation_runs`,
    );
    await w.q(
      sql`insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, event_key)
          values (${w.workspaceId}, ${only?.automation}::uuid, 'record', ${only?.record}::uuid, 'created')
          on conflict (workspace_id, automation_id, subject_id, event_key) do nothing`,
    );
    expect(await w.run()).toEqual({ ran: 0, more: false });
    // A run claimed and lost halfway runs again and finds its task made already.
    await w.q(sql`update automation_runs set status = 'queued', claimed_at = null`);
    await w.run();
    expect(await w.tasks()).toHaveLength(1);
  });

  it('answers when a run a crashed call left running may be put back, and runs it then', async () => {
    const w = await world();
    await w.make(createdDeal(w.deals));
    await w.deal('Acme');
    // A call that crashed after its claim: the run sits `running`, claimed just now.
    await w.q(sql`update automation_runs set status = 'running', claimed_at = now()`);
    const first = await w.run();
    expect(first.ran).toBe(0);
    expect((first.staleAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(4 * 60_000);
    // The call the task queues for that time puts the run back and runs it.
    await w.q(sql`update automation_runs set claimed_at = now() - interval '6 minutes'`);
    expect(await w.run()).toEqual({ ran: 1, more: false });
    expect(await w.tasks()).toHaveLength(1);
  });

  it('makes a task id the same for a run and its place, shaped as a UUID v7', () => {
    const run = newId();
    expect(derivedTaskId(run, 0)).toBe(derivedTaskId(run, 0));
    expect(derivedTaskId(run, 0)).not.toBe(derivedTaskId(run, 1));
    expect(derivedTaskId(run, 0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('queues nothing for a switched off automation, a deleted one, or another object', async () => {
    const w = await world();
    const off = await w.make(createdDeal(w.deals));
    await setAutomationEnabled(w.owner, { automationId: off.id, enabled: false });
    const gone = await w.make(createdDeal(w.deals));
    await deleteAutomation(w.owner, { automationId: gone.id });
    await w.make(createdDeal(w.objects.people ?? ''));
    await w.deal('Acme');
    expect(await w.q(sql`select 1 from automation_runs`)).toHaveLength(0);
    // Each change has its audit row for Settings › History, naming the trigger's object, never the definition.
    expect(
      await w.q(
        sql`select after->>'change' as change, after->>'object' as object from audit_events where action = 'automation.changed' order by at, id`,
      ),
    ).toEqual([
      { change: 'created', object: 'Deals' },
      { change: 'disabled', object: 'Deals' },
      { change: 'created', object: 'Deals' },
      { change: 'deleted', object: 'Deals' },
      { change: 'created', object: 'People' },
    ]);
  });
});

describe('a field changed', () => {
  it('fires once when the stage becomes Won, not for another stage or another field, and not for a stale change', async () => {
    const w = await world();
    await w.make({
      trigger: {
        kind: 'field_changed',
        objectId: w.deals,
        attributeId: w.attr('deals.stage'),
        to: { optionId: w.stage('Won') },
      },
      actions: [{ kind: 'create_task', title: 'Celebrate', assignee: { kind: 'owner' }, dueInDays: 0 }],
    });
    const id = await w.deal('Acme');
    const set = (values: Record<string, { value: unknown }>) => setValues(w.owner, { recordId: id, values }, w.hooks);
    await set({ [w.attr('deals.stage')]: { value: w.stage('In progress') } });
    await set({ [w.attr('deals.name')]: { value: 'Acme 2' } });
    await set({ [w.attr('deals.stage')]: { value: w.stage('Won') } });
    // Won, then Lost before the worker looks: the first change is stale and does nothing.
    await set({ [w.attr('deals.stage')]: { value: w.stage('Lost') } });
    await w.run();
    expect(await w.tasks()).toHaveLength(0);
    await set({ [w.attr('deals.stage')]: { value: w.stage('Won') } });
    await w.run();
    expect(await w.tasks()).toHaveLength(1);
  });

  it('meets conditions on the record: a miss makes no task and no log row', async () => {
    const w = await world();
    await w.make({
      trigger: { kind: 'record_created', objectId: w.deals },
      conditions: {
        conjunction: 'and',
        conditions: [{ attributeId: w.attr('deals.name'), operator: 'contains', value: 'Big' }],
      },
      actions: [{ kind: 'create_task', title: 'Call', assignee: { kind: 'owner' }, dueInDays: 1 }],
    });
    await w.deal('Small');
    await w.deal('Big fish');
    await w.run();
    expect(await w.tasks()).toHaveLength(1);
    expect((await listAutomationRuns(w.owner)).runs).toHaveLength(1);
  });
});

describe('what an automation does', () => {
  it('sets a field, and that write starts no automation', async () => {
    const w = await world();
    await w.make({
      trigger: { kind: 'record_created', objectId: w.deals },
      actions: [{ kind: 'set_field', attributeId: w.attr('deals.stage'), value: w.stage('In progress') }],
    });
    // A second automation watching the stage must stay quiet about the first one's write.
    await w.make({
      trigger: { kind: 'field_changed', objectId: w.deals, attributeId: w.attr('deals.stage') },
      actions: [{ kind: 'create_task', title: 'Stage moved', assignee: { kind: 'owner' }, dueInDays: 0 }],
    });
    const id = await w.deal('Acme');
    await w.run();
    const [stage] = await w.q<{ option_id: string }>(
      sql`select option_id::text from "values" where record_id = ${id}::uuid and attribute_id = ${w.attr('deals.stage')}::uuid and active_until is null`,
    );
    expect(stage?.option_id).toBe(w.stage('In progress'));
    // Writing as the automation with the hook in place queues nothing either.
    const asAutomation = await enterAsAutomation(w.deps.door, {
      workspaceId: w.workspaceId,
      automationId: newId(),
      memberId: w.memberId,
    });
    await setValues(
      asAutomation,
      { recordId: id, values: { [w.attr('deals.stage')]: { value: w.stage('Won') } } },
      w.hooks,
    );
    expect(await w.run()).toMatchObject({ ran: 0 });
    expect(await w.tasks()).toHaveLength(0);
  });

  it('leaves one inbox notice per member per run, naming no text', async () => {
    const w = await world();
    await w.make({
      trigger: { kind: 'record_created', objectId: w.deals },
      actions: [{ kind: 'notify', who: { kind: 'owner' }, message: 'New deal' }],
    });
    await w.deal('Acme');
    await w.run();
    const rows = await w.q<{ kind: string; automation_run_id: string | null }>(
      sql`select kind::text, automation_run_id::text from notifications`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('automation');
  });

  it('notifies for a task that came due, once per due date, and not before it was switched on', async () => {
    const w = await world();
    const today = new Date().toISOString().slice(0, 10);
    const old = await createTask(w.owner, { id: newId(), title: 'Old', dueOn: '2020-01-01' });
    await w.make({
      trigger: { kind: 'task_due' },
      actions: [{ kind: 'notify', who: { kind: 'owner' } }],
    });
    const due = await createTask(w.owner, { id: newId(), title: 'Due', dueOn: today, assigneeMemberId: w.memberId });
    expect(await queueDueAutomations(w.deps, w.workspaceId)).toBe(1);
    expect(await queueDueAutomations(w.deps, w.workspaceId)).toBe(0);
    await w.run();
    const rows = await w.q<{ due_task_id: string }>(sql`select due_task_id::text from notifications`);
    expect(rows).toEqual([{ due_task_id: due.id }]);
    expect(old.id).not.toBe(due.id);
  });
});

describe('the inbox', () => {
  it('shows a due task’s notice to a member who may see the task, and to no one who may not', async () => {
    const w = await world();
    const bea = newId();
    await w.q(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    );
    const dealId = await w.deal('Secret');
    const today = new Date().toISOString().slice(0, 10);
    await w.make({
      trigger: { kind: 'task_due' },
      actions: [{ kind: 'notify', who: { kind: 'member', memberId: bea } }],
    });
    // A task linked to a deal; Bea may not read deals.
    await createTask(w.owner, { id: newId(), title: 'Hidden title', dueOn: today, recordIds: [dealId] });
    await createTask(w.owner, { id: newId(), title: 'Open title', dueOn: today });
    await queueDueAutomations(w.deps, w.workspaceId);
    await w.run();
    const rules = {
      levels: [
        {
          subject: { type: 'role' as const, role: 'member' },
          target: { type: 'object' as const, objectId: w.deals },
          level: 'none',
        },
      ],
      records: [],
    };
    const asBea = rescope(w.owner, { actor: { type: 'member', id: bea }, role: 'member', rules });
    const { items } = await listNotifications(asBea, { status: 'inbox' });
    expect(items.map((item) => item.excerpt)).toEqual(['Open title']);
  });
});

describe('when it goes wrong', () => {
  it(`switches itself off, with its reason, after ${String(AUTOMATION_FAILURES_MAX)} failed runs in a row`, async () => {
    const w = await world();
    const made = await w.make({
      trigger: { kind: 'record_created', objectId: w.deals },
      actions: [{ kind: 'notify', who: { kind: 'member', memberId: w.memberId } }],
    });
    // The recipient leaves after the automation was saved: every run fails.
    const bea = newId();
    await w.q(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    );
    await w.q(
      sql`update automations set actions = ${JSON.stringify([{ kind: 'notify', who: { kind: 'member', memberId: bea } }])}::jsonb`,
    );
    await w.q(sql`update members set status = 'removed', left_at = now() where id = ${bea}::uuid`);
    for (let n = 0; n < AUTOMATION_FAILURES_MAX; n += 1) {
      await w.deal(`Deal ${String(n)}`);
      await w.run();
    }
    const [row] = (await listAutomations(w.owner)).automations;
    expect(row).toMatchObject({
      id: made.id,
      enabled: false,
      disabledReason: 'FAILING',
      failures: AUTOMATION_FAILURES_MAX,
    });
    // Switching it on again clears the count and the reason.
    const again = await setAutomationEnabled(w.owner, { automationId: made.id, enabled: true }).catch(
      (error: unknown) => error,
    );
    expect(again).toBeInstanceOf(Error);
  });

  it('switches off at once when the member it runs as has left, and another admin can take it over', async () => {
    const w = await world();
    const made = await w.make(createdDeal(w.deals));
    const bea = newId();
    await w.q(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'admin', 'system', 'system')`,
    );
    await w.q(sql`update automations set run_as_member_id = ${bea}::uuid`);
    await w.q(sql`update members set status = 'removed', left_at = now() where id = ${bea}::uuid`);
    await w.deal('Acme');
    await w.run();
    expect((await listAutomations(w.owner)).automations[0]).toMatchObject({
      enabled: false,
      disabledReason: 'CREATOR_GONE',
    });
    const back = await setAutomationEnabled(w.owner, { automationId: made.id, enabled: true });
    expect(back).toMatchObject({ enabled: true, runAsMemberId: w.memberId });
    expect(back.disabledReason).toBeUndefined();
  });

  it('switches off with the member it runs as when they are removed, before any run finds it', async () => {
    const w = await world();
    const bea = newId();
    await w.q(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'admin', 'system', 'system')`,
    );
    const theirs = await w.make(createdDeal(w.deals));
    const mine = await w.make(createdDeal(w.deals));
    await w.q(sql`update automations set run_as_member_id = ${bea}::uuid where id = ${theirs.id}::uuid`);
    await removeMember(w.owner, { memberId: bea }, [outboxHook()]);
    const byId = new Map((await listAutomations(w.owner)).automations.map((row) => [row.id, row]));
    expect(byId.get(theirs.id)).toMatchObject({ enabled: false, disabledReason: 'CREATOR_GONE' });
    expect(byId.get(mine.id)).toMatchObject({ enabled: true });
    // Nothing queues for it any more.
    await w.deal('Acme');
    const runs = await w.q<{ n: number }>(
      sql`select count(*)::int as n from automation_runs where automation_id = ${theirs.id}::uuid`,
    );
    expect(runs[0]?.n).toBe(0);
  });

  it('never breaks the write when the hook cannot queue: the record is made and the fault is told', async () => {
    const w = await world();
    await w.make(createdDeal(w.deals));
    // A change the hook cannot read (not ids): its statement fails inside its savepoint, and the write goes on.
    const faults: unknown[] = [];
    const broken: AfterWrite = (change, tx) =>
      automationHook((error) => faults.push(error))(
        { ...change, createdRecords: [{ recordId: 'nope', objectId: 'nope' }] },
        tx,
      );
    const id = (
      await createRecord(w.owner, { objectId: w.deals, values: { [w.attr('deals.name')]: 'Acme' } }, [
        outboxHook(),
        broken,
      ])
    ).recordId;
    expect(id).toBeTruthy();
    expect(faults).toHaveLength(1);
    const [made] = await w.q<{ n: number }>(sql`select count(*)::int as n from records`);
    expect(made?.n).toBeGreaterThan(0);
  });
});

describe('the door', () => {
  it('lets only automations.manage in, and shows nothing of another workspace', async () => {
    const w = await world();
    const other = await world();
    await w.make(createdDeal(w.deals));
    const member = rescope(w.owner, { actor: { type: 'member', id: w.memberId }, role: 'member' });
    await expect(listAutomations(member)).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    expect((await listAutomations(other.owner)).automations).toHaveLength(0);
  });
});
