// Automations (parity #53), the member door's part: list, make, change, switch, delete and bring back, and read the run
// log. All need `automations.manage`, and the person who saves or switches one on becomes the member it runs as
// (`run_as_member_id`): its actions later run with that member's access, never more. A definition is checked here
// against the workspace as the caller sees it, so a saved automation names only an object, fields, options and members
// that exist, a field they may write, and conditions over fields they may read; the engine checks them again when it
// runs. Every change stores one `automations` outbox row (a screen reads the list again), and nothing but ids and the
// definition's own typed settings is stored.
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  AUTOMATION_RUNS_SHOWN,
  AUTOMATIONS_MAX,
  AutomationDefinition,
  type Automation,
  type AutomationList,
  type AutomationRun,
  type AutomationRuns,
} from '@crm/contracts';
import { conditionAttributeIds } from '@crm/contracts/validation';
import type { FilterCondition, FilterGroup } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { attributeLevel, attributeVisible, checkObject } from '../access/visibility.ts';
import { canonicalId, isUuid, isUuidV7 } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { isArchivedNow, loadAttributes, parseFor, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { activeMembers } from './members.ts';

const { attributeOptions, automationRuns, automations, objects } = schema;

/** What a saved or switched on automation refuses when it names something the caller can't use. */
const UNKNOWN_AUTOMATION = 'That automation does not exist.';
const UNKNOWN_FIELD = 'That field is not on this object.';
const UNKNOWN_MEMBER = "That member isn't in this workspace.";
const FULL = `A workspace holds at most ${String(AUTOMATIONS_MAX)} automations. Delete one to make room.`;
const NOT_A_MEMBER = 'Only a member can build an automation.';

type Row = typeof automations.$inferSelect;

/** The member the caller is, or a refusal: an automation runs as a person. */
function me(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  return principal.memberId;
}

/** A stored row as the screen reads it, or undefined for one whose definition no longer parses (never expected). */
function toView(row: Row): Automation | undefined {
  const parsed = AutomationDefinition.safeParse({
    trigger: row.trigger,
    actions: row.actions,
    ...(row.conditions === null ? {} : { conditions: row.conditions }),
  });
  if (!parsed.success) return undefined;
  const { trigger, actions, conditions } = parsed.data;
  return {
    id: row.id,
    trigger,
    ...(conditions === undefined ? {} : { conditions }),
    actions,
    enabled: row.enabled,
    ...(row.disabledReason === 'FAILING' || row.disabledReason === 'CREATOR_GONE'
      ? { disabledReason: row.disabledReason }
      : {}),
    failures: row.failures,
    runAsMemberId: row.runAsMemberId,
    ...(row.lastRunAt === null ? {} : { lastRunAt: new Date(row.lastRunAt).toISOString() }),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Walks a filter's conditions. */
function conditionsOf(group: FilterGroup): readonly FilterCondition[] {
  return group.conditions.flatMap((item) => ('conjunction' in item ? conditionsOf(item) : [item]));
}

/** What a definition's trigger puts in the plain columns the hook and the sweep read. */
interface TriggerColumns {
  readonly kind: 'record_created' | 'field_changed' | 'task_due';
  readonly objectId: string | null;
  readonly attributeId: string | null;
}

/**
 * Checks a definition against the workspace as the caller sees it, or refuses `CONFIG_INVALID` on the part at fault
 * (a hidden object or field answers as an unknown one). Answers the trigger's plain columns.
 */
async function checkDefinition(
  context: WriteContext,
  definition: AutomationDefinition,
  workspaceAttributes?: ReadonlyMap<string, AttributeDef>,
): Promise<TriggerColumns> {
  const { tx, scope } = context;
  const { access } = scope;
  const { trigger, actions } = definition;
  // Members named by an action (a task's assignee, a notice's recipient) are active members now.
  const named = actions.flatMap((action) => {
    const who = action.kind === 'create_task' ? action.assignee : action.kind === 'notify' ? action.who : undefined;
    return who?.kind === 'member' ? [who.memberId] : [];
  });
  const active = await activeMembers(tx, named);
  actions.forEach((action, index) => {
    const who = action.kind === 'create_task' ? action.assignee : action.kind === 'notify' ? action.who : undefined;
    if (who?.kind === 'member' && !active.has(who.memberId)) {
      throw refuseOn('CONFIG_INVALID', UNKNOWN_MEMBER, `actions.${String(index)}`);
    }
  });
  if (trigger.kind === 'task_due') return { kind: 'task_due', objectId: null, attributeId: null };

  await checkObject(tx, access, trigger.objectId, 'read');
  const [object] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.id, trigger.objectId), isNull(objects.archivedAt)));
  if (object === undefined) throw refuseOn('CONFIG_INVALID', 'That object does not exist.', 'trigger');
  const attributes = workspaceAttributes ?? (await loadAttributes(tx, trigger.objectId));

  const field = (attributeId: string, path: string): AttributeDef => {
    const attribute = attributes.get(attributeId);
    if (attribute === undefined || isArchivedNow(attribute) || !attributeVisible(access, attribute)) {
      throw refuseOn('CONFIG_INVALID', UNKNOWN_FIELD, path);
    }
    return attribute;
  };

  if (trigger.kind === 'field_changed') {
    const attribute = field(trigger.attributeId, 'trigger');
    const { to } = trigger;
    if (to !== undefined) {
      if (
        'checked' in to ? attribute.type !== 'checkbox' : attribute.type !== 'select' && attribute.type !== 'status'
      ) {
        throw refuseOn('CONFIG_INVALID', 'That value does not fit this field.', 'trigger');
      }
      if ('optionId' in to) {
        const [option] = await tx
          .select({ id: attributeOptions.id })
          .from(attributeOptions)
          .where(and(eq(attributeOptions.attributeId, attribute.id), eq(attributeOptions.id, to.optionId)));
        if (option === undefined) throw refuseOn('CONFIG_INVALID', 'That option is not on this field.', 'trigger');
      }
    }
  }

  const { conditions } = definition;
  if (conditions !== undefined) {
    if (conditionsOf(conditions).some((condition) => condition.operator === 'through')) {
      throw refuseOn('CONFIG_INVALID', 'A condition can only look at this record’s own fields.', 'conditions');
    }
    for (const id of conditionAttributeIds(conditions)) field(id, 'conditions');
  }

  actions.forEach((action, index) => {
    if (action.kind !== 'set_field') return;
    const path = `actions.${String(index)}`;
    const attribute = field(action.attributeId, path);
    if (access.principal.kind !== 'system' && attributeLevel(access, attribute) !== 'write') {
      throw refuseOn('CONFIG_INVALID', `You can't change ${attribute.title}.`, path);
    }
    try {
      parseFor(attribute, action.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That value does not fit this field.';
      throw refuseOn('CONFIG_INVALID', message, path);
    }
  });
  return {
    kind: trigger.kind,
    objectId: trigger.objectId,
    attributeId: trigger.kind === 'field_changed' ? trigger.attributeId : null,
  };
}

/** The workspace's lock for counting and adding automations: two makers never both see room for the last one. */
async function lockCount(tx: WorkspaceTx, workspaceId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`automations:${workspaceId}`}, 0))`);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(automations)
    .where(isNull(automations.deletedAt));
  return row?.count ?? 0;
}

/** One live automation, locked for the write. */
async function lockOne(tx: WorkspaceTx, automationId: string): Promise<Row> {
  if (!isUuid(automationId)) throw refuse('NOT_FOUND', UNKNOWN_AUTOMATION);
  const [row] = await tx
    .select()
    .from(automations)
    .where(and(eq(automations.id, canonicalId(automationId)), isNull(automations.deletedAt)))
    .for('update');
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_AUTOMATION);
  return row;
}

/** The view of a row just written. */
function viewOf(row: Row): Automation {
  const view = toView(row);
  if (view === undefined) throw new Error('An automation just written could not be read back.');
  return view;
}

/** The workspace's automations, oldest first (deleted ones left out), and the most it may hold. */
export async function listAutomations(scope: EngineScope): Promise<AutomationList> {
  requirePermission(scope, 'automations.manage');
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(automations)
      .where(isNull(automations.deletedAt))
      .orderBy(asc(automations.createdAt), asc(automations.id)),
  );
  return {
    automations: rows.flatMap((row) => {
      const view = toView(row);
      return view === undefined ? [] : [view];
    }),
    max: AUTOMATIONS_MAX,
  };
}

/** The columns a definition writes. */
function definitionColumns(definition: AutomationDefinition, columns: TriggerColumns) {
  return {
    triggerKind: columns.kind,
    objectId: columns.objectId,
    attributeId: columns.attributeId,
    trigger: definition.trigger,
    conditions: definition.conditions ?? null,
    actions: definition.actions,
  };
}

/**
 * Makes an automation, on, running as the caller. The same call again (a lost answer) returns the same automation;
 * an id used by anyone else's is `ID_TAKEN`; the 51st is `LIMIT_REACHED`. One `automations` outbox row.
 */
export async function createAutomation(
  scope: EngineScope,
  input: { readonly id: string; readonly definition: AutomationDefinition },
  hooks: readonly AfterWrite[] = [],
): Promise<Automation> {
  requirePermission(scope, 'automations.manage');
  const caller = me(scope);
  if (!isUuidV7(input.id)) throw refuseOn('CONFIG_INVALID', 'The automation id must be a UUID v7.', 'id');
  const id = canonicalId(input.id);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [existing] = await tx.select().from(automations).where(eq(automations.id, id));
      if (existing !== undefined) {
        if (existing.createdByMemberId === caller && existing.deletedAt === null) return viewOf(existing);
        throw refuse('ID_TAKEN', 'An automation with that id already exists.');
      }
      if ((await lockCount(tx, scope.workspaceId)) >= AUTOMATIONS_MAX) throw refuse('LIMIT_REACHED', FULL);
      const columns = await checkDefinition(context, input.definition);
      const [row] = await tx
        .insert(automations)
        .values({
          workspaceId: scope.workspaceId,
          id,
          ...definitionColumns(input.definition, columns),
          runAsMemberId: caller,
          createdByType: 'member',
          createdById: caller,
          createdByMemberId: caller,
          updatedByType: 'member',
          updatedById: caller,
          updatedByMemberId: caller,
        })
        .returning();
      if (row === undefined) throw new Error('An automation just written could not be read back.');
      context.record({ automations: [id] });
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** Saves a definition. The caller becomes the member it runs as; whether it is on is left as it was. */
export async function updateAutomation(
  scope: EngineScope,
  input: { readonly automationId: string; readonly definition: AutomationDefinition },
  hooks: readonly AfterWrite[] = [],
): Promise<Automation> {
  requirePermission(scope, 'automations.manage');
  const caller = me(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await lockOne(tx, input.automationId);
      const columns = await checkDefinition(context, input.definition);
      const [updated] = await tx
        .update(automations)
        .set({
          ...definitionColumns(input.definition, columns),
          runAsMemberId: caller,
          updatedAt: sql`now()`,
          updatedByType: 'member',
          updatedById: caller,
          updatedByMemberId: caller,
        })
        .where(eq(automations.id, row.id))
        .returning();
      if (updated === undefined) throw new Error('An automation just written could not be read back.');
      context.record({ automations: [row.id] });
      return viewOf(updated);
    },
    hooks,
  );
  return result;
}

/**
 * Switches one on or off. On clears the failure count and the reason, makes the caller the member it runs as and
 * starts a task due automation's reach from now; the definition is checked again as the caller sees it, so one
 * naming something they can't use is refused rather than switched on. Off clears nothing else.
 */
export async function setAutomationEnabled(
  scope: EngineScope,
  input: { readonly automationId: string; readonly enabled: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<Automation> {
  requirePermission(scope, 'automations.manage');
  const caller = me(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await lockOne(tx, input.automationId);
      if (input.enabled) {
        const view = viewOf(row);
        await checkDefinition(context, {
          trigger: view.trigger,
          actions: view.actions,
          ...(view.conditions === undefined ? {} : { conditions: view.conditions }),
        });
      }
      const [updated] = await tx
        .update(automations)
        .set(
          input.enabled
            ? {
                enabled: true,
                enabledAt: sql`now()`,
                disabledReason: null,
                failures: 0,
                runAsMemberId: caller,
                updatedAt: sql`now()`,
                updatedByType: 'member',
                updatedById: caller,
                updatedByMemberId: caller,
              }
            : {
                enabled: false,
                disabledReason: null,
                updatedAt: sql`now()`,
                updatedByType: 'member',
                updatedById: caller,
                updatedByMemberId: caller,
              },
        )
        .where(eq(automations.id, row.id))
        .returning();
      if (updated === undefined) throw new Error('An automation just written could not be read back.');
      context.record({ automations: [row.id] });
      return viewOf(updated);
    },
    hooks,
  );
  return result;
}

/** Deletes one: hidden at once, brought back by `restoreAutomation` until the daily cleanup removes it. */
export async function deleteAutomation(
  scope: EngineScope,
  input: { readonly automationId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly ok: true }> {
  requirePermission(scope, 'automations.manage');
  const caller = me(scope);
  await runWrite(
    scope,
    async (context) => {
      const row = await lockOne(context.tx, input.automationId);
      await context.tx
        .update(automations)
        .set({
          deletedAt: sql`now()`,
          deletedByType: 'member',
          deletedById: caller,
          deletedByMemberId: caller,
        })
        .where(eq(automations.id, row.id));
      context.record({ automations: [row.id] });
    },
    hooks,
  );
  return { ok: true };
}

/** Brings a deleted automation back, as it was (on or off), if the workspace has room. */
export async function restoreAutomation(
  scope: EngineScope,
  input: { readonly automationId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<Automation> {
  requirePermission(scope, 'automations.manage');
  me(scope);
  if (!isUuid(input.automationId)) throw refuse('NOT_FOUND', UNKNOWN_AUTOMATION);
  const id = canonicalId(input.automationId);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      if ((await lockCount(tx, scope.workspaceId)) >= AUTOMATIONS_MAX) throw refuse('LIMIT_REACHED', FULL);
      const [row] = await tx
        .update(automations)
        .set({ deletedAt: null, deletedByType: null, deletedById: null, deletedByMemberId: null })
        .where(and(eq(automations.id, id), sql`${automations.deletedAt} is not null`))
        .returning();
      if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_AUTOMATION);
      context.record({ automations: [id] });
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/**
 * The run log: the newest runs first, at most `AUTOMATION_RUNS_SHOWN`, of the workspace or of one automation. Runs
 * skipped by a condition or a stale event are not in it, and a run for a record on an object the reader can't see is
 * left out (hidden means absent).
 */
export async function listAutomationRuns(
  scope: EngineScope,
  input: { readonly automationId?: string; readonly limit?: number } = {},
): Promise<AutomationRuns> {
  requirePermission(scope, 'automations.manage');
  const limit = Math.min(Math.max(input.limit ?? AUTOMATION_RUNS_SHOWN, 1), AUTOMATION_RUNS_SHOWN);
  const only =
    input.automationId !== undefined && isUuid(input.automationId) ? canonicalId(input.automationId) : undefined;
  if (input.automationId !== undefined && only === undefined) return { runs: [] };
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(automationRuns)
      .where(
        and(
          sql`${automationRuns.status} <> 'skipped'`,
          only === undefined ? undefined : eq(automationRuns.automationId, only),
        ),
      )
      .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
      .limit(limit),
  );
  return { runs: rows.flatMap((row) => toRun(row, scope.access)) };
}

/** A stored run as the log reads it, or nothing when it is about an object the reader can't see. */
function toRun(row: typeof automationRuns.$inferSelect, access: Access): AutomationRun[] {
  if (row.objectId !== null && objectLevel(access, row.objectId) === 'none') return [];
  const status = row.status;
  if (status !== 'queued' && status !== 'running' && status !== 'done' && status !== 'failed') return [];
  return [
    {
      id: row.id,
      automationId: row.automationId,
      subjectKind: row.subjectKind === 'task' ? 'task' : 'record',
      subjectId: row.subjectId,
      ...(row.objectId === null ? {} : { objectId: row.objectId }),
      status,
      ...(row.code === null ? {} : { code: row.code }),
      at: new Date(row.createdAt).toISOString(),
    },
  ];
}
