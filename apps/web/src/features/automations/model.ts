// Automations (parity #53), the builder's plain parts: the draft a person edits as a sentence, the three starters,
// the definition a draft makes (nothing until it is complete), the draft a saved automation makes, and the one line a
// list row reads. No React, no data layer: the screen holds the lists and hands them in.
import {
  AUTOMATION_ACTIONS_MAX,
  AUTOMATION_DUE_DAYS_MAX,
  AUTOMATION_MESSAGE_MAX,
  AUTOMATION_TITLE_MAX,
  type Automation,
  type AutomationAction,
  type AutomationDefinition,
  type AttributeDefinition,
  type FilterGroup,
  type MemberSummary,
  type ObjectSummary,
} from '@crm/data';
import { strings } from './strings.ts';

/** Who a task goes to or a notice is for, in the draft: the record's Owner, or a member by id. */
export type DraftWho = string;

/** One action as the sentence edits it; `days` is typed text until it is read. */
export type DraftAction =
  | { readonly kind: 'create_task'; readonly title: string; readonly who: DraftWho; readonly days: string }
  | { readonly kind: 'set_field'; readonly attributeId: string; readonly value: unknown }
  | { readonly kind: 'notify'; readonly who: DraftWho; readonly message: string };

/**
 * The automation as the sentence reads it. `subject` is an object's id or `task`; `event` is `created` or the id of the
 * field that changes; `to` is an option id (a select or status), `checked` or `unchecked`, or empty for any change.
 */
export interface Draft {
  readonly subject: string;
  readonly event: string;
  readonly to: string;
  readonly conditions: FilterGroup | undefined;
  readonly actions: readonly DraftAction[];
}

/** The subject that stands for tasks. */
export const TASK_SUBJECT = 'task';
/** The event that stands for a record being made. */
export const CREATED = 'created';
/** `to` for any change. */
export const ANY = '';

/** What the starters and the sentence need to know about the workspace. */
export interface Names {
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  /** An object's attributes, once read (the sentence asks for them as it needs them). */
  readonly attributesOf: (objectId: string) => readonly AttributeDefinition[] | undefined;
}

/** The three starter chips. */
export type StarterId = 'new-deal' | 'stage-won' | 'task-due';

/** The starters' ids in the order the chips show. */
export const STARTERS: readonly StarterId[] = ['new-deal', 'stage-won', 'task-due'];

/** Whether an object can be watched: live ones, writable or not (a read only object still raises events). */
const live = (objects: readonly ObjectSummary[]) => objects.filter((object) => !object.isArchived);

/** The Deals object, else the first live one: the starters are about a pipeline where there is one. */
export function pipelineObject(objects: readonly ObjectSummary[]): ObjectSummary | undefined {
  const open = live(objects);
  return open.find((object) => object.standardKey === 'deals') ?? open[0];
}

/** The first status field of an object, else its first select: a stage. */
export function stageField(attributes: readonly AttributeDefinition[]): AttributeDefinition | undefined {
  const usable = attributes.filter((each) => !each.isArchived && !each.isSystem);
  return (
    usable.find((each) => each.type === 'status') ?? usable.find((each) => each.type === 'select' && !each.isMulti)
  );
}

/** The option that ends a pipeline well (outcome won), else the last live one. */
export function wonOption(attribute: AttributeDefinition): string {
  const options = (attribute.options ?? []).filter((option) => !option.isArchived);
  return (options.find((option) => option.outcome === 'won') ?? options.at(-1))?.id ?? ANY;
}

/** A starter's draft. Needs an object for the first two (Deals where there is one); undefined without one. */
export function starterDraft(id: StarterId, names: Names): Draft | undefined {
  if (id === 'task-due') {
    return {
      subject: TASK_SUBJECT,
      event: CREATED,
      to: ANY,
      conditions: undefined,
      actions: [{ kind: 'notify', who: 'owner', message: '' }],
    };
  }
  const object = pipelineObject(names.objects);
  if (object === undefined) return undefined;
  if (id === 'new-deal') {
    return {
      subject: object.id,
      event: CREATED,
      to: ANY,
      conditions: undefined,
      actions: [{ kind: 'create_task', title: strings.starterTaskNew, who: 'owner', days: '1' }],
    };
  }
  const stage = stageField(names.attributesOf(object.id) ?? []);
  return {
    subject: object.id,
    event: stage?.id ?? CREATED,
    to: stage === undefined ? ANY : wonOption(stage),
    conditions: undefined,
    actions: [{ kind: 'create_task', title: strings.starterTaskWon, who: 'owner', days: '3' }],
  };
}

/** A blank draft: the first object being created, one task to its Owner. */
export function blankDraft(names: Names): Draft | undefined {
  const object = pipelineObject(names.objects);
  if (object === undefined) return undefined;
  return {
    subject: object.id,
    event: CREATED,
    to: ANY,
    conditions: undefined,
    actions: [{ kind: 'create_task', title: '', who: 'owner', days: '1' }],
  };
}

const whoOf = (who: DraftWho) =>
  who === 'owner' ? ({ kind: 'owner' } as const) : ({ kind: 'member', memberId: who } as const);

/** The days a person typed, a whole number from 0 to a year, else undefined. */
export function daysOf(text: string): number | undefined {
  if (!/^\d{1,3}$/.test(text.trim())) return undefined;
  const days = Number(text.trim());
  return days <= AUTOMATION_DUE_DAYS_MAX ? days : undefined;
}

/** One draft action as a definition's, or undefined while it is not finished. */
function actionOf(action: DraftAction): AutomationAction | undefined {
  switch (action.kind) {
    case 'create_task': {
      const title = action.title.trim();
      const days = daysOf(action.days);
      if (title === '' || title.length > AUTOMATION_TITLE_MAX || days === undefined) return undefined;
      return { kind: 'create_task', title, assignee: whoOf(action.who), dueInDays: days };
    }
    case 'set_field':
      return action.attributeId === '' || action.value === undefined
        ? undefined
        : { kind: 'set_field', attributeId: action.attributeId, value: action.value };
    case 'notify': {
      const message = action.message.trim();
      if (message.length > AUTOMATION_MESSAGE_MAX) return undefined;
      return { kind: 'notify', who: whoOf(action.who), ...(message === '' ? {} : { message }) };
    }
  }
}

/** The definition a finished draft makes, or undefined while any part is missing. */
export function toDefinition(draft: Draft): AutomationDefinition | undefined {
  const actions = draft.actions.map(actionOf);
  const done = actions.flatMap((action) => (action === undefined ? [] : [action]));
  if (done.length !== actions.length || done.length === 0 || done.length > AUTOMATION_ACTIONS_MAX) return undefined;
  if (draft.subject === TASK_SUBJECT) return { trigger: { kind: 'task_due' }, actions: done };
  const conditions =
    draft.conditions !== undefined && draft.conditions.conditions.length > 0 ? draft.conditions : undefined;
  const base = { actions: done, ...(conditions === undefined ? {} : { conditions }) };
  if (draft.event === CREATED) return { ...base, trigger: { kind: 'record_created', objectId: draft.subject } };
  const to =
    draft.to === ANY
      ? undefined
      : draft.to === 'checked' || draft.to === 'unchecked'
        ? { checked: draft.to === 'checked' }
        : { optionId: draft.to };
  return {
    ...base,
    trigger: {
      kind: 'field_changed',
      objectId: draft.subject,
      attributeId: draft.event,
      ...(to === undefined ? {} : { to }),
    },
  };
}

const draftWho = (who: { readonly kind: string; readonly memberId?: string }): DraftWho =>
  who.kind === 'member' && who.memberId !== undefined ? who.memberId : 'owner';

/** The draft a saved automation opens as. */
export function draftOf(automation: Automation): Draft {
  const { trigger } = automation;
  const actions = automation.actions.map((action): DraftAction => {
    if (action.kind === 'create_task') {
      return {
        kind: 'create_task',
        title: action.title,
        who: draftWho(action.assignee),
        days: String(action.dueInDays),
      };
    }
    if (action.kind === 'set_field') return { kind: 'set_field', attributeId: action.attributeId, value: action.value };
    return { kind: 'notify', who: draftWho(action.who), message: action.message ?? '' };
  });
  if (trigger.kind === 'task_due') {
    return { subject: TASK_SUBJECT, event: CREATED, to: ANY, conditions: undefined, actions };
  }
  const base = { subject: trigger.objectId, conditions: automation.conditions, actions };
  if (trigger.kind === 'record_created') return { ...base, event: CREATED, to: ANY };
  const { to } = trigger;
  return {
    ...base,
    event: trigger.attributeId,
    to: to === undefined ? ANY : 'checked' in to ? (to.checked ? 'checked' : 'unchecked') : to.optionId,
  };
}

/** A member's name, else "Owner" for the record's. */
function whoWords(who: DraftWho, names: Names): string {
  return who === 'owner'
    ? strings.owner
    : (names.members.find((member) => member.id === who)?.name ?? strings.formerMember);
}

/** One line for a list row: "Deal Stage becomes Won: create a task “Send contract” for Owner". */
export function summaryOf(automation: Automation, names: Names): string {
  const draft = draftOf(automation);
  const head = (() => {
    if (draft.subject === TASK_SUBJECT) return strings.summary.taskDue;
    const object = names.objects.find((each) => each.id === draft.subject);
    const name = object?.singularName ?? strings.summary.unknownObject;
    if (draft.event === CREATED) return strings.summary.created(name);
    const attribute = names.attributesOf(draft.subject)?.find((each) => each.id === draft.event);
    const field = attribute?.title ?? strings.summary.unknownField;
    if (draft.to === ANY) return strings.summary.changes(name, field);
    const option = attribute?.options?.find((each) => each.id === draft.to)?.label;
    const value =
      draft.to === 'checked' ? strings.checked : draft.to === 'unchecked' ? strings.unchecked : (option ?? '');
    return strings.summary.becomes(name, field, value);
  })();
  const todo = draft.actions.map((action) => {
    if (action.kind === 'create_task') return strings.summary.task(action.title, whoWords(action.who, names));
    if (action.kind === 'set_field') {
      const attribute = names.attributesOf(draft.subject)?.find((each) => each.id === action.attributeId);
      return strings.summary.setField(attribute?.title ?? strings.summary.unknownField);
    }
    return strings.summary.notify(whoWords(action.who, names));
  });
  return `${head}: ${todo.join(strings.summary.then)}`;
}

/** Why an automation is off by itself, in a few words; undefined while it is on or was switched off by hand. */
export function offReason(automation: Automation): string | undefined {
  if (automation.enabled || automation.disabledReason === undefined) return undefined;
  return automation.disabledReason === 'FAILING' ? strings.offFailing : strings.offGone;
}

/** Why a run failed, in a few words, by the code the server gave. */
export function failureWords(code: string | undefined): string {
  return strings.failures[code ?? ''] ?? strings.failures['default'] ?? '';
}
