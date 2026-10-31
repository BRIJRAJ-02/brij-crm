// Running automations (parity #53), the worker's part: the `crm_automation` task claims the workspace's queued runs one
// at a time and runs each as the member its automation runs as, through the access door (`enterAsAutomation`): their
// access as it is now, the actor `automation`, so it can neither do more than that member nor start another
// automation (the write hook ignores an automation's writes). A run is checked before it acts (the automation still
// on, the member still there, the record still readable, a changed cell still at the version that queued it, the
// "becomes" value and the conditions met) and each action is idempotent by itself (a task's id comes from the run's id
// and the action's place; setting a field to the value it has writes nothing; one notice per member per run), so a
// run that crashed halfway is simply claimed and run again. How it ended is written once, with the failure count: five
// failed runs in a row switch the automation off, a member who left switches it off at once, and a run over the
// workspace's hourly cap fails `RATE_LIMITED` without counting. Nothing the record holds is put into anything: a
// title, a message and a value are the definition's own typed settings.
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  AUTOMATION_FAILURES_MAX,
  AUTOMATION_RUNS_PER_HOUR,
  AutomationDefinition,
  type AutomationAction,
  type AutomationWho,
} from '@crm/contracts';
import { addDays, conditionAttributeIds, matchesCondition } from '@crm/contracts/validation';
import { schema } from '@crm/db';
import { enterAsAutomation, type ActorDoorDeps } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { attributeVisible } from '../access/visibility.ts';
import { isRefusal } from '../engine/refusals.ts';
import { getRecords, setRecordValues } from '../engine/records.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { createTask } from '../tasks/tasks.ts';
import { activeMembers } from './members.ts';
import { notifyAutomation } from './notice.ts';

const { automations } = schema;

/** A log line's sink: the api's logger. Ids and codes only. */
export interface AutomationLog {
  info(message: string, fields: Record<string, unknown>): void;
  warn(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** What running needs, all passed in (the worker builds them). */
export interface AutomationRunDeps {
  /** The tenant database and the rule source, as `enterAsActor` takes them. */
  readonly door: ActorDoorDeps;
  /** The system's scope in a workspace: the claim, the bookkeeping and the due sweep. */
  readonly systemScope: (workspaceId: string) => EngineScope;
  /** The write hooks of an action's own write: the outbox's, never the automation hook. */
  readonly hooks: () => readonly AfterWrite[];
  /** Told after a run stored a change event (the worker wakes its relay). */
  readonly onStored?: () => void;
  readonly log: AutomationLog;
  /** The clock; tests pass one they move. */
  readonly now?: () => Date;
}

/** How long a claimed run may stay `running` before another claim takes it again. */
const STALE_MINUTES = 5;

/** The longest one call of the task runs runs before it hands the rest to the next call, in milliseconds. */
const SLICE_MS = 15_000;

/** A run just claimed. */
interface Claimed {
  readonly id: string;
  readonly automationId: string;
  readonly subjectKind: 'record' | 'task';
  readonly subjectId: string;
  readonly objectId: string | null;
  readonly versionId: string | null;
}

/** How a run ended. */
type Outcome =
  | { readonly status: 'done' }
  | { readonly status: 'skipped'; readonly code: string }
  | { readonly status: 'failed'; readonly code: string; readonly off?: 'CREATOR_GONE' };

/** A task's id for an action: stable for the run and the action's place, shaped like a UUID v7 as tasks require. */
export function derivedTaskId(runId: string, index: number): string {
  const digest = createHash('sha256')
    .update(`${runId}:${String(index)}`)
    .digest('hex')
    .slice(0, 32);
  const variant = '89ab'[Number.parseInt(digest.charAt(16), 16) % 4] ?? '8';
  const hex = `${digest.slice(0, 12)}7${digest.slice(13, 16)}${variant}${digest.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Runs the workspace's queued automation runs, oldest first, for up to about 15 seconds. Answers how many it ran and
 * whether more are waiting (the task queues itself again then). Runs left `running` by a worker that died are put
 * back first. Once the queue is empty, a run still `running` (a call that crashed, or one another worker holds)
 * answers `staleAt`, when it may be put back: the task queues a call for then, so a crash is retried by the job
 * itself, not only by the next write or the hourly sweep.
 */
export async function runAutomationQueue(
  deps: AutomationRunDeps,
  workspaceId: string,
): Promise<{ readonly ran: number; readonly more: boolean; readonly staleAt?: Date }> {
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const system = deps.systemScope(workspaceId);
  await inWorkspace(system, (tx) =>
    tx.execute(sql`
      update automation_runs set status = 'queued', claimed_at = null
      where status = 'running' and claimed_at < now() - ${`${String(STALE_MINUTES)} minutes`}::interval
    `),
  );
  let ran = 0;
  while (now().getTime() - started < SLICE_MS) {
    const run = await claim(system);
    if (run === undefined) {
      const staleAt = await nextStale(system);
      return staleAt === undefined ? { ran, more: false } : { ran, more: false, staleAt };
    }
    await runOne(deps, system, run);
    ran += 1;
  }
  return { ran, more: true };
}

/** When the oldest run still `running` may be put back (`automation_runs_running`), or nothing when none is. */
async function nextStale(system: EngineScope): Promise<Date | undefined> {
  const result = await inWorkspace(system, (tx) =>
    tx.execute<{ at: string | null }>(sql`
      select (min(claimed_at) + ${`${String(STALE_MINUTES)} minutes`}::interval + interval '5 seconds')::text as at
      from automation_runs where status = 'running'
    `),
  );
  const at = result.rows[0]?.at ?? null;
  return at === null ? undefined : new Date(at);
}

/** Claims the oldest queued run (skipping any another worker holds), or nothing. */
async function claim(system: EngineScope): Promise<Claimed | undefined> {
  const result = await inWorkspace(system, (tx) =>
    tx.execute<{
      id: string;
      automation_id: string;
      subject_kind: 'record' | 'task';
      subject_id: string;
      object_id: string | null;
      version_id: string | null;
    }>(sql`
      with next as materialized (
        select id from automation_runs where status = 'queued' order by created_at, id limit 1 for update skip locked
      )
      update automation_runs r set status = 'running', claimed_at = now()
      from next
      where r.id = next.id
      returning r.id::text as id, r.automation_id::text as automation_id, r.subject_kind, r.subject_id::text as subject_id,
        r.object_id::text as object_id, r.version_id::text as version_id
    `),
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    automationId: row.automation_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    objectId: row.object_id,
    versionId: row.version_id,
  };
}

/** Runs one claimed run to its end and writes how it ended. Never throws for the run's own failure. */
async function runOne(deps: AutomationRunDeps, system: EngineScope, run: Claimed): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await decide(deps, system, run);
  } catch (error) {
    if (isRefusal(error)) {
      outcome = { status: 'failed', code: error.refusal.code };
    } else {
      outcome = { status: 'failed', code: 'INTERNAL' };
      deps.log.error('automation.run.crashed', {
        runId: run.id,
        automationId: run.automationId,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  await finish(deps, system, run, outcome);
  deps.log.info('automation.run', {
    runId: run.id,
    automationId: run.automationId,
    status: outcome.status,
    ...(outcome.status === 'done' ? {} : { code: outcome.code }),
  });
}

/** Everything a run does before and including its actions; throws a refusal for a failure the engine words. */
async function decide(deps: AutomationRunDeps, system: EngineScope, run: Claimed): Promise<Outcome> {
  const { workspaceId } = system;
  const now = (deps.now ?? (() => new Date()))();
  // The hourly cap first: a flood costs one count, not a read of the record.
  const [recent] = (
    await inWorkspace(system, (tx) =>
      tx.execute<{ count: number }>(sql`
        select count(*)::int as count from automation_runs
        where claimed_at > now() - interval '1 hour' and id <> ${run.id}::uuid
          and status in ('running', 'done', 'failed') and code is distinct from 'RATE_LIMITED'
      `),
    )
  ).rows;
  if ((recent?.count ?? 0) >= AUTOMATION_RUNS_PER_HOUR) return { status: 'failed', code: 'RATE_LIMITED' };

  const [row] = await inWorkspace(system, (tx) =>
    tx.select().from(automations).where(eq(automations.id, run.automationId)),
  );
  if (row === undefined || row.deletedAt !== null || !row.enabled) return { status: 'skipped', code: 'OFF' };
  const parsed = AutomationDefinition.safeParse({
    trigger: row.trigger,
    actions: row.actions,
    ...(row.conditions === null ? {} : { conditions: row.conditions }),
  });
  if (!parsed.success) return { status: 'failed', code: 'CONFIG_INVALID' };
  const definition = parsed.data;

  let scope: EngineScope;
  try {
    scope = await enterAsAutomation(deps.door, {
      workspaceId,
      automationId: run.automationId,
      memberId: row.runAsMemberId,
    });
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') {
      return { status: 'failed', code: 'CREATOR_GONE', off: 'CREATOR_GONE' };
    }
    throw error;
  }

  const runAs = row.runAsMemberId;
  const today = now.toISOString().slice(0, 10);

  if (definition.trigger.kind === 'task_due') {
    const [task] = (
      await inWorkspace(system, (tx) =>
        tx.execute<{ is_done: boolean; assignee: string | null }>(sql`
          select is_done, assignee_member_id::text as assignee from tasks
          where id = ${run.subjectId}::uuid and deleted_at is null
        `),
      )
    ).rows;
    if (task === undefined || task.is_done) return { status: 'skipped', code: 'TASK_GONE' };
    return act(deps, scope, run, definition, {
      today,
      runAs,
      owner: task.assignee ?? undefined,
      dueTaskId: run.subjectId,
    });
  }

  const { objectId } = definition.trigger;
  const attributes = await inWorkspace(scope, (tx) => loadAttributes(tx, objectId));
  const owner = [...attributes.values()].find(
    (attribute) => attribute.apiSlug === 'owner' && attribute.type === 'actor_reference' && !isArchivedNow(attribute),
  );
  const named = new Set<string>(conditionAttributeIds(definition.conditions));
  if (definition.trigger.kind === 'field_changed') named.add(definition.trigger.attributeId.toLowerCase());
  // A field the member can no longer see can't be judged: a failure to fix, never a silent skip.
  for (const id of named) {
    const attribute = attributes.get(id);
    if (attribute === undefined || isArchivedNow(attribute) || !attributeVisible(scope.access, attribute)) {
      return { status: 'failed', code: 'FORBIDDEN' };
    }
  }
  const wanted = [...named, ...(owner === undefined ? [] : [owner.id])];
  const [record] = await getRecords(scope, {
    ids: [run.subjectId],
    attributeIds: wanted,
    attributes: new Map([[objectId, attributes]]),
  });
  if (record === undefined || record.objectId !== objectId) return { status: 'skipped', code: 'RECORD_GONE' };

  if (definition.trigger.kind === 'field_changed') {
    const { attributeId, to } = definition.trigger;
    const version = record.versions[attributeId];
    // The cell has moved on since this change: a later change has its own run.
    if (version !== undefined && run.versionId !== null && version !== run.versionId) {
      return { status: 'skipped', code: 'STALE' };
    }
    if (to !== undefined) {
      const value = record.values[attributeId];
      const held =
        'checked' in to
          ? value === to.checked
          : Array.isArray(value)
            ? value.includes(to.optionId)
            : value === to.optionId;
      if (!held) return { status: 'skipped', code: 'NOT_MATCHED' };
    }
  }
  if (definition.conditions !== undefined) {
    const shapes = new Map(
      [...attributes].map(([id, attribute]) => [
        id.toLowerCase(),
        { type: attribute.type, isMulti: attribute.isMulti, archived: isArchivedNow(attribute) },
      ]),
    );
    const values = Object.fromEntries(Object.entries(record.values).map(([id, value]) => [id.toLowerCase(), value]));
    const met = matchesCondition(definition.conditions, {
      values,
      attributes: shapes,
      clock: { now: now.toISOString(), timeZone: 'UTC', weekStart: 'monday' },
      actor: { type: 'automation', id: run.automationId },
    });
    if (!met) return { status: 'skipped', code: 'NOT_MATCHED' };
  }
  return act(deps, scope, run, definition, {
    today,
    runAs,
    owner: ownerOf(record.values, owner),
    recordId: record.id,
  });
}

/** The member a record's Owner field names, when it names one. */
function ownerOf(values: Readonly<Record<string, unknown>>, owner: AttributeDef | undefined): string | undefined {
  if (owner === undefined) return undefined;
  const value = values[owner.id];
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, id } = value as { readonly type?: unknown; readonly id?: unknown };
  return type === 'member' && typeof id === 'string' ? id : undefined;
}

/** What the actions of one run need from the subject. */
interface Subject {
  readonly today: string;
  /** The member the automation runs as: who "owner" falls back to. */
  readonly runAs: string;
  readonly owner: string | undefined;
  readonly recordId?: string;
  readonly dueTaskId?: string;
}

/** Runs the actions in order; the first refusal fails the run (earlier actions stay, and are idempotent on a retry). */
async function act(
  deps: AutomationRunDeps,
  scope: EngineScope,
  run: Claimed,
  definition: AutomationDefinition,
  subject: Subject,
): Promise<Outcome> {
  const whoOf = (who: AutomationWho): string =>
    who.kind === 'member' ? who.memberId : (subject.owner ?? subject.runAs);
  const people = definition.actions.flatMap((action: AutomationAction) =>
    action.kind === 'create_task' ? [whoOf(action.assignee)] : action.kind === 'notify' ? [whoOf(action.who)] : [],
  );
  const active = await inWorkspace(scope, (tx) => activeMembers(tx, people));
  if (people.some((id) => !active.has(id))) return { status: 'failed', code: 'NOT_FOUND' };

  for (const [index, action] of definition.actions.entries()) {
    switch (action.kind) {
      case 'create_task':
        await createTask(
          scope,
          {
            id: derivedTaskId(run.id, index),
            title: action.title,
            dueOn: addDays(subject.today, action.dueInDays),
            assigneeMemberId: whoOf(action.assignee),
            ...(subject.recordId === undefined ? {} : { recordIds: [subject.recordId] }),
          },
          deps.hooks(),
        );
        break;
      case 'set_field':
        if (subject.recordId === undefined) return { status: 'failed', code: 'CONFIG_INVALID' };
        await setRecordValues(
          scope,
          { recordId: subject.recordId, values: { [action.attributeId]: { value: action.value } } },
          deps.hooks(),
        );
        break;
      case 'notify':
        await runWrite(
          scope,
          (context) =>
            notifyAutomation(context, {
              memberId: whoOf(action.who),
              automationId: run.automationId,
              runId: run.id,
              ...(subject.recordId === undefined ? {} : { recordId: subject.recordId }),
              ...(subject.dueTaskId === undefined ? {} : { dueTaskId: subject.dueTaskId }),
            }),
          deps.hooks(),
        );
        break;
    }
  }
  return { status: 'done' };
}

/** Writes how a run ended, its automation's failure count, and the change event that tells the screens. */
async function finish(deps: AutomationRunDeps, system: EngineScope, run: Claimed, outcome: Outcome): Promise<void> {
  const code = outcome.status === 'done' ? null : outcome.code;
  await runWrite(
    system,
    async (context) => {
      const { tx } = context;
      await tx.execute(sql`
        update automation_runs set status = ${outcome.status}, code = ${code}, finished_at = now()
        where id = ${run.id}::uuid
      `);
      if (outcome.status === 'done') {
        await tx.execute(sql`
          update automations set failures = 0, last_run_at = now() where id = ${run.automationId}::uuid
        `);
      } else if (outcome.status === 'failed' && outcome.off === 'CREATOR_GONE') {
        await tx.execute(sql`
          update automations set enabled = false, disabled_reason = 'CREATOR_GONE', last_run_at = now()
          where id = ${run.automationId}::uuid and enabled
        `);
      } else if (outcome.status === 'failed' && outcome.code !== 'RATE_LIMITED') {
        // One statement: every right hand side reads the row as it was, so the fifth failure switches it off.
        await tx.execute(sql`
          update automations set
            failures = failures + 1,
            last_run_at = now(),
            disabled_reason = case when enabled and failures + 1 >= ${AUTOMATION_FAILURES_MAX} then 'FAILING' else disabled_reason end,
            enabled = enabled and failures + 1 < ${AUTOMATION_FAILURES_MAX}
          where id = ${run.automationId}::uuid
        `);
      }
      if (outcome.status !== 'skipped') context.record({ automations: [run.automationId] });
    },
    deps.hooks(),
  );
  deps.onStored?.();
}

/**
 * Queues a run for every task that became due and that a task due automation of the workspace watches (parity #53):
 * open, not deleted, due today or in the last two days, and never before the automation was switched on. Keyed by the
 * due date, so a task is told once per date and a moved date is a new event. At most 200 a call, oldest due first;
 * the queue's cap holds here as it does in the write hook. Answers how many it queued.
 */
export async function queueDueAutomations(deps: AutomationRunDeps, workspaceId: string): Promise<number> {
  const system = deps.systemScope(workspaceId);
  const queued = await inWorkspace(system, (tx) =>
    tx.execute(sql`
      insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, event_key)
      select a.workspace_id, a.id, 'task', t.id, 'due:' || t.due_on::text
      from automations a
      join tasks t on t.workspace_id = a.workspace_id
      where a.enabled and a.deleted_at is null and a.trigger_kind = 'task_due'
        and t.deleted_at is null and not t.is_done and t.due_on is not null
        and t.due_on <= (now() at time zone 'utc')::date
        and t.due_on >= greatest((a.enabled_at at time zone 'utc')::date, (now() at time zone 'utc')::date - 2)
        and (select count(*) from (
          select 1 from automation_runs q where q.status = 'queued' limit 1000
        ) waiting) < 1000
      order by t.due_on, t.id
      limit 200
      on conflict (workspace_id, automation_id, subject_id, event_key) do nothing
    `),
  );
  return queued.rowCount ?? 0;
}

/**
 * The daily cleanup's part (parity #53): run rows older than 7 days go (the log shows 50, and an event's once only
 * key outlives the outbox's day by six), and automations deleted more than 30 days ago go with their runs and
 * notices. Answers how many of each, for the cleanup's report.
 */
export async function pruneAutomations(
  deps: Pick<AutomationRunDeps, 'systemScope'>,
  workspaceId: string,
): Promise<{ readonly runs: number; readonly automations: number }> {
  return inWorkspace(deps.systemScope(workspaceId), async (tx) => {
    // In batches of 1,000 through the age index, so a backlog never holds one long statement.
    const runs = await tx.execute(sql`
      delete from automation_runs where (workspace_id, id) in (
        select workspace_id, id from automation_runs
        where created_at < now() - interval '7 days' and status in ('done', 'failed', 'skipped')
        order by created_at limit 1000
      )
    `);
    const removed = await tx.execute(sql`
      delete from automations where deleted_at is not null and deleted_at < now() - interval '30 days'
    `);
    return { runs: runs.rowCount ?? 0, automations: removed.rowCount ?? 0 };
  });
}
