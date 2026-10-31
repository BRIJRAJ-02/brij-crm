// A form's New step dividers as the builder changes them (spec 0063, AC-6303): plain functions over the questions
// and their breaks, each answering a new pair, so the editor keeps one draft and the tests check every rule here.
// A break is stored as the question it starts at (`startsAt`), absent at the end; the list the builder shows puts
// each break in its place among the questions, so a break drags like a question.
import type { FormQuestion } from '@crm/data';
import { stepsOfBreaks, type FormStep } from '@crm/data/forms';

/** The questions and the breaks between them, as a form's draft holds them. */
export interface Flow {
  readonly questions: readonly FormQuestion[];
  readonly steps: readonly FormStep[];
}

/** One row of the builder's list: a question, or a break. */
export type FlowItem =
  { readonly kind: 'question'; readonly id: string } | { readonly kind: 'step'; readonly id: string };

/** The rows in order: each break just before the question it starts at, and the breaks at the end last. */
export function itemsOf(flow: Flow): FlowItem[] {
  const ids = new Set(flow.questions.map((question) => question.id));
  const at = (step: FormStep) => (step.startsAt !== undefined && ids.has(step.startsAt) ? step.startsAt : undefined);
  return [
    ...flow.questions.flatMap((question): FlowItem[] => [
      ...flow.steps.filter((step) => at(step) === question.id).map((step) => ({ kind: 'step' as const, id: step.id })),
      { kind: 'question', id: question.id },
    ]),
    ...flow.steps.filter((step) => at(step) === undefined).map((step) => ({ kind: 'step' as const, id: step.id })),
  ];
}

/** The questions and breaks a list of rows says: each break starting at the next question after it, if any. */
export function fromItems(flow: Flow, items: readonly FlowItem[]): Flow {
  const questions = new Map(flow.questions.map((question) => [question.id, question]));
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  return {
    questions: items.flatMap((item) => {
      const question = item.kind === 'question' ? questions.get(item.id) : undefined;
      return question === undefined ? [] : [question];
    }),
    steps: items.flatMap((item, index) => {
      const step = item.kind === 'step' ? steps.get(item.id) : undefined;
      if (step === undefined) return [];
      const next = items.slice(index + 1).find((each) => each.kind === 'question');
      const { startsAt: _was, ...rest } = step;
      return [next === undefined ? rest : { ...rest, startsAt: next.id }];
    }),
  };
}

/** The flow with the row `id` (a question's or a break's) moved to `index` among all the rows. */
export function moveItem(flow: Flow, id: string, index: number): Flow {
  const items = itemsOf(flow);
  const moving = items.find((item) => item.id === id);
  if (moving === undefined) return flow;
  const rest = items.filter((item) => item !== moving);
  const to = Math.max(0, Math.min(index, rest.length));
  return fromItems(flow, [...rest.slice(0, to), moving, ...rest.slice(to)]);
}

/** A new break at the end, with no title yet: the questions added after it make its step. */
export function addStep(flow: Flow, id: string): Flow {
  return { ...flow, steps: [...flow.steps, { id }] };
}

/** The flow without the break `id`, so its questions join the step above, and what Undo needs to put it back. */
export function removeStep(
  flow: Flow,
  id: string,
): { readonly flow: Flow; readonly removed?: { readonly step: FormStep; readonly index: number } } {
  const index = flow.steps.findIndex((step) => step.id === id);
  const step = flow.steps[index];
  if (step === undefined) return { flow };
  return { flow: { ...flow, steps: flow.steps.filter((each) => each.id !== id) }, removed: { step, index } };
}

/** A removed break back where it was (Undo): at its question if that is still there, else at the end. */
export function restoreStep(flow: Flow, step: FormStep, index: number): Flow {
  if (flow.steps.some((each) => each.id === step.id)) return flow;
  const steps = [...flow.steps.slice(0, index), step, ...flow.steps.slice(index)];
  return fromItems({ ...flow, steps }, itemsOf({ ...flow, steps }));
}

/** What a break's editor changes: its title, or its Show when (null: always shows). */
export interface StepChange {
  readonly title?: string;
  readonly showWhen?: FormStep['showWhen'] | null;
}

/** The flow with the break `id` changed. A blank title is no title. */
export function changeStep(flow: Flow, id: string, change: StepChange): Flow {
  return {
    ...flow,
    steps: flow.steps.map((step) => {
      if (step.id !== id) return step;
      const { title: _title, showWhen: _showWhen, ...rest } = step;
      const title = change.title ?? step.title;
      const showWhen = change.showWhen === null ? undefined : (change.showWhen ?? step.showWhen);
      return {
        ...rest,
        ...(title === undefined || title === '' ? {} : { title }),
        ...(showWhen === undefined ? {} : { showWhen }),
      };
    }),
  };
}

/**
 * The breaks kept in step with a change of the questions alone (a question added, deleted or duplicated): a break
 * whose question was deleted starts at the next one that is still there, or goes to the end; and a break at the end
 * takes the first question added after every other, so Add a question under a new step fills that step.
 */
export function keepBreaks(
  before: readonly FormQuestion[],
  after: readonly FormQuestion[],
  steps: readonly FormStep[],
): FormStep[] {
  const now = new Set(after.map((question) => question.id));
  const was = new Set(before.map((question) => question.id));
  const lastOld = after.findLastIndex((question) => was.has(question.id));
  const appended = after.slice(lastOld + 1).find((question) => !was.has(question.id));
  let tookAppended = false;
  return steps.map((step) => {
    const { startsAt, ...rest } = step;
    if (startsAt !== undefined && now.has(startsAt)) return step;
    if (startsAt !== undefined) {
      const from = before.findIndex((question) => question.id === startsAt);
      const next = before.slice(from + 1).find((question) => now.has(question.id));
      if (next !== undefined) return { ...rest, startsAt: next.id };
    }
    if (appended !== undefined && !tookAppended) {
      tookAppended = true;
      return { ...rest, startsAt: appended.id };
    }
    return rest;
  });
}

/** Each break's place as a visitor counts it ("Step 2"), and how many questions its step holds, by break id. */
export function stepPlaces(flow: Flow): ReadonlyMap<string, { readonly number: number; readonly count: number }> {
  return new Map(
    stepsOfBreaks(flow.questions, flow.steps).flatMap((step, index) =>
      step.id === undefined ? [] : [[step.id, { number: index + 1, count: step.keys.length }] as const],
    ),
  );
}

/** The questions before the break `id`: what its Show when may read. */
export function questionsBefore(flow: Flow, id: string): readonly FormQuestion[] {
  const items = itemsOf(flow);
  const at = items.findIndex((item) => item.kind === 'step' && item.id === id);
  const ids = new Set(items.slice(0, Math.max(0, at)).flatMap((item) => (item.kind === 'question' ? [item.id] : [])));
  return flow.questions.filter((question) => ids.has(question.id));
}

/** The breaks with every Show when condition reading `from` reading `to` instead, as a question's rename asks. */
export function renameStepKeys(steps: readonly FormStep[], from: string, to: string): FormStep[] {
  return steps.map((step) =>
    step.showWhen === undefined
      ? step
      : {
          ...step,
          showWhen: {
            ...step.showWhen,
            rules: step.showWhen.rules.map((condition) =>
              condition.key === from ? { ...condition, key: to } : condition,
            ),
          },
        },
  );
}
