// Automations (parity #53): "when X, if Y, do Z". One trigger, optional same record conditions (the filter builder's
// own `FilterGroup`), one to three actions, no branches, loops or delays. They are read and written through
// `automations.*`, which need `automations.manage`. An automation runs as the member who last saved it or switched it
// on, never with more access than that member holds. Action settings are typed values: nothing in a record is ever
// put into a title, a message or a query.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import {
  AUTOMATIONS_MAX,
  AUTOMATION_ACTIONS_MAX,
  AUTOMATION_DUE_DAYS_MAX,
  AUTOMATION_MESSAGE_MAX,
  AUTOMATION_OFF_REASONS,
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_RUNS_SHOWN,
  AUTOMATION_TITLE_MAX,
} from './automation-limits.ts';
import { FilterGroup } from './values/filters.ts';
import { Uuid, uuidV7 } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export {
  AUTOMATION_ACTIONS_MAX,
  AUTOMATION_DUE_DAYS_MAX,
  AUTOMATION_EVENTS_PER_WRITE,
  AUTOMATION_FAILURES_MAX,
  AUTOMATION_MESSAGE_MAX,
  AUTOMATION_OFF_REASONS,
  AUTOMATION_QUEUE_MAX,
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_RUNS_PER_HOUR,
  AUTOMATION_RUNS_SHOWN,
  AUTOMATION_TITLE_MAX,
  AUTOMATIONS_MAX,
  type AutomationOffReason,
  type AutomationRunStatus,
} from './automation-limits.ts';

const NUL_REFUSED = 'This text holds a character that can’t be stored.';

/** Who a task goes to or a notice is for: the record's Owner (else the person it runs as), or one member. */
export const AutomationWho = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner') }),
  z.strictObject({ kind: z.literal('member'), memberId: Uuid }),
]);
/** Who a task goes to or a notice is for. */
export type AutomationWho = z.infer<typeof AutomationWho>;

/** The value a field must become for "becomes": a status or select option, or a checkbox. */
export const AutomationTo = z.union([z.strictObject({ optionId: Uuid }), z.strictObject({ checked: z.boolean() })]);
/** The value a field must become for "becomes". */
export type AutomationTo = z.infer<typeof AutomationTo>;

/** What starts an automation. */
export const AutomationTrigger = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('record_created'), objectId: Uuid }),
  z.strictObject({
    kind: z.literal('field_changed'),
    objectId: Uuid,
    attributeId: Uuid,
    to: AutomationTo.optional(),
  }),
  z.strictObject({ kind: z.literal('task_due') }),
]);
/** What starts an automation. */
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/** Plain text a person typed, trimmed, with no NUL. */
const plain = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .refine((text) => !text.includes('\u0000'), { error: NUL_REFUSED });

/** The most JSON a "set a field" value may take, in characters: a value is a field's, never a document. */
const VALUE_MAX = 4_000;

/** A value to set: given (null clears), and small enough to be a field's, never a document. */
function isSmallValue(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    return JSON.stringify(value).length <= VALUE_MAX;
  } catch {
    return false;
  }
}

/** What an automation does. */
export const AutomationAction = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create_task'),
    title: plain(AUTOMATION_TITLE_MAX, `A task title holds at most ${String(AUTOMATION_TITLE_MAX)} characters.`).refine(
      (title) => title.length > 0,
      { error: 'Give the task a title.' },
    ),
    assignee: AutomationWho,
    dueInDays: z.number().int().min(0).max(AUTOMATION_DUE_DAYS_MAX),
  }),
  z.strictObject({
    kind: z.literal('set_field'),
    attributeId: Uuid,
    value: z.unknown().refine(isSmallValue, { error: 'Give a value that fits the field.' }),
  }),
  z.strictObject({
    kind: z.literal('notify'),
    who: AutomationWho,
    message: plain(
      AUTOMATION_MESSAGE_MAX,
      `A message holds at most ${String(AUTOMATION_MESSAGE_MAX)} characters.`,
    ).optional(),
  }),
]);
/** What an automation does. */
export type AutomationAction = z.infer<typeof AutomationAction>;

/**
 * An automation's definition: the trigger, same record conditions, and one to three actions. A task due automation
 * has no conditions (a task is no record) and only notifies (a task has no fields to set).
 */
export const AutomationDefinition = z
  .strictObject({
    trigger: AutomationTrigger,
    conditions: FilterGroup.optional(),
    actions: z
      .array(AutomationAction)
      .min(1, 'Add an action.')
      .max(AUTOMATION_ACTIONS_MAX, `An automation does at most ${String(AUTOMATION_ACTIONS_MAX)} things.`),
  })
  .superRefine((definition, context) => {
    if (definition.trigger.kind !== 'task_due') return;
    if (definition.conditions !== undefined && definition.conditions.conditions.length > 0) {
      context.addIssue({ code: 'custom', path: ['conditions'], message: 'A due task has no conditions yet.' });
    }
    definition.actions.forEach((action, index) => {
      if (action.kind !== 'notify') {
        context.addIssue({ code: 'custom', path: ['actions', index], message: 'A due task can only notify someone.' });
      }
    });
  });
/** An automation's definition. */
export type AutomationDefinition = z.infer<typeof AutomationDefinition>;

/** One automation as the Automations screen reads it. */
export const Automation = z.object({
  id: Uuid,
  trigger: AutomationTrigger,
  conditions: FilterGroup.optional(),
  actions: z.array(AutomationAction),
  enabled: z.boolean(),
  /** Why it switched itself off, while it is off for that reason. */
  disabledReason: z.enum(AUTOMATION_OFF_REASONS).optional(),
  /** Failed runs in a row. */
  failures: z.number().int().min(0),
  /** The member it runs as. */
  runAsMemberId: Uuid,
  lastRunAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/** One automation as the Automations screen reads it. */
export type Automation = z.infer<typeof Automation>;

/** The workspace's automations, oldest first, and how many it may hold. */
export const AutomationList = z.object({
  automations: z.array(Automation),
  max: z.literal(AUTOMATIONS_MAX),
});
/** The workspace's automations. */
export type AutomationList = z.infer<typeof AutomationList>;

/** One run in the log: its automation, what it ran for, and how it ended. */
export const AutomationRun = z.object({
  id: Uuid,
  automationId: Uuid,
  subjectKind: z.enum(['record', 'task']),
  subjectId: Uuid,
  /** The record's object, for its link. */
  objectId: Uuid.optional(),
  status: z.enum(AUTOMATION_RUN_STATUSES),
  /** Why a failed run failed. */
  code: z.string().optional(),
  at: z.iso.datetime(),
});
/** One run in the log. */
export type AutomationRun = z.infer<typeof AutomationRun>;

/** The run log: the newest runs first, at most `AUTOMATION_RUNS_SHOWN`. */
export const AutomationRuns = z.object({ runs: z.array(AutomationRun) });
/** The run log. */
export type AutomationRuns = z.infer<typeof AutomationRuns>;

/** A new automation: the browser's v7 id (the retry key) and the definition. It starts on. */
export const CreateAutomationInput = WorkspaceScoped.extend({
  id: uuidV7('The automation id must be a UUID v7.'),
  definition: AutomationDefinition,
  mutationId: Uuid,
});
/** A new automation. */
export type CreateAutomationInput = z.infer<typeof CreateAutomationInput>;

/** A saved definition; the caller becomes the member it runs as. */
export const UpdateAutomationInput = WorkspaceScoped.extend({
  automationId: Uuid,
  definition: AutomationDefinition,
  mutationId: Uuid,
});
/** A saved definition. */
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInput>;

/** Switching one on or off. On clears the failure count and the reason, and the caller becomes who it runs as. */
export const SetAutomationEnabledInput = WorkspaceScoped.extend({
  automationId: Uuid,
  enabled: z.boolean(),
  mutationId: Uuid,
});
/** Switching one on or off. */
export type SetAutomationEnabledInput = z.infer<typeof SetAutomationEnabledInput>;

/** Deleting one, or bringing it back within its Undo window. */
export const AutomationRefInput = WorkspaceScoped.extend({ automationId: Uuid, mutationId: Uuid });
/** Deleting one, or bringing it back. */
export type AutomationRefInput = z.infer<typeof AutomationRefInput>;

/** The runs to show: the workspace's newest, or one automation's. */
export const AutomationRunsInput = WorkspaceScoped.extend({
  automationId: Uuid.optional(),
  limit: z.number().int().min(1).max(AUTOMATION_RUNS_SHOWN).optional(),
});
/** The runs to show. */
export type AutomationRunsInput = z.infer<typeof AutomationRunsInput>;

/** The automations procedures. All need `automations.manage`, behind the member door. */
export const automationsContract = {
  list: oc.input(WorkspaceScoped).output(AutomationList),
  create: oc.input(CreateAutomationInput).output(Automation),
  update: oc.input(UpdateAutomationInput).output(Automation),
  setEnabled: oc.input(SetAutomationEnabledInput).output(Automation),
  remove: oc.input(AutomationRefInput).output(z.object({ ok: z.literal(true) })),
  restore: oc.input(AutomationRefInput).output(Automation),
  runs: oc.input(AutomationRunsInput).output(AutomationRuns),
};
