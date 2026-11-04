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

/**
 * A new break, placed so the step it makes already holds questions (the owner, 4 November 2026: one click, "already
 * named and placed"): it splits the last step in two, starting at the middle of that step's questions, so a form of
 * four questions becomes two steps of two. With fewer than two questions in the last step there is nothing to split,
 * and the break goes at the end, where the questions added after it make its step. It has no title yet: the list
 * names it by its place ("Step 2").
 */
export function addStep(flow: Flow, id: string): Flow {
  const items = itemsOf(flow);
  const lastBreak = items.findLastIndex((item) => item.kind === 'step');
  const tail = items.slice(lastBreak + 1).filter((item) => item.kind === 'question');
  if (lastBreak === items.length - 1 || tail.length < 2) return { ...flow, steps: [...flow.steps, { id }] };
  const startsAt = tail[Math.ceil(tail.length / 2)]?.id;
  if (startsAt === undefined) return { ...flow, steps: [...flow.steps, { id }] };
  const next = { ...flow, steps: [...flow.steps, { id, startsAt }] };
  // In the order the list shows them, so the steps array never disagrees with where each break sits.
  return fromItems(next, itemsOf(next));
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

/** The questions under the break `id`: its own step, which its jumps read along with everything before it. */
export function stepQuestionsOf(flow: Flow, id: string): readonly FormQuestion[] {
  const keys = new Set(stepsOfBreaks(flow.questions, flow.steps).find((step) => step.id === id)?.keys ?? []);
  return flow.questions.filter((question) => keys.has(question.key));
}

/** What a break's editor changes: its title, its Show when (null: always shows), or its jumps. */
export interface StepChange {
  readonly title?: string;
  readonly showWhen?: FormStep['showWhen'] | null;
  /** Its jumps in order (spec 0063, AC-6313); an empty list is no jumps at all. */
  readonly jumps?: NonNullable<FormStep['jumps']>;
}

/** The flow with the break `id` changed. A blank title is no title. */
export function changeStep(flow: Flow, id: string, change: StepChange): Flow {
  return {
    ...flow,
    steps: flow.steps.map((step) => {
      if (step.id !== id) return step;
      const { title: _title, showWhen: _showWhen, jumps: _jumps, ...rest } = step;
      const title = change.title ?? step.title;
      const showWhen = change.showWhen === null ? undefined : (change.showWhen ?? step.showWhen);
      const jumps = change.jumps ?? step.jumps;
      return {
        ...rest,
        ...(title === undefined || title === '' ? {} : { title }),
        ...(showWhen === undefined ? {} : { showWhen }),
        ...(jumps === undefined || jumps.length === 0 ? {} : { jumps: [...jumps] }),
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

/**
 * Each break's place as a visitor counts it ("Step 2", 0 for a break with no question under it yet, which visitors
 * never see), and how many questions its step holds, by break id.
 */
export function stepPlaces(flow: Flow): ReadonlyMap<string, { readonly number: number; readonly count: number }> {
  let number = 0;
  return new Map(
    stepsOfBreaks(flow.questions, flow.steps).flatMap((step) => {
      if (step.keys.length > 0) number += 1;
      return step.id === undefined
        ? []
        : [[step.id, { number: step.keys.length > 0 ? number : 0, count: step.keys.length }] as const];
    }),
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

/** The answer types that make up someone's contact details: the page a stepped form asks first. */
const CONTACT_TYPES: ReadonlySet<string> = new Set(['email', 'phone']);
/** A short text whose words ask for a name or a company is contact detail too. */
const CONTACT_WORDS = /\b(name|company|organi[sz]ation|job title|role at)\b/i;

/** Whether a question asks for contact details (a name, an email, a phone, a company). */
export function isContactQuestion(question: Pick<FormQuestion, 'answerType' | 'label'>): boolean {
  return (
    CONTACT_TYPES.has(question.answerType) ||
    (question.answerType === 'short_text' && CONTACT_WORDS.test(question.label))
  );
}

/**
 * The form split into pages when Steps is chosen (T20, 5 November 2026: "choosing Steps splits the form at once",
 * Tally's page breaks): breaks it already has are kept. The first question always starts a step of its own, so every
 * page has a header to rename. A form with no breaks of its own is split after its contact details (a leading run of
 * name, email and phone, titled "Your details"), else in the middle; a form of one question stays one step.
 */
export function splitIntoSteps(flow: Flow, newId: () => string, words: { readonly details: string }): Flow {
  const first = flow.questions[0];
  if (first === undefined) return flow;
  const resolved = stepsOfBreaks(flow.questions, flow.steps);
  const hasLead = resolved[0]?.id !== undefined;
  if (flow.steps.some((step) => step.startsAt !== undefined)) {
    if (hasLead) return flow;
    // Breaks of its own: only the first page gets its header.
    const steps = [{ id: newId(), startsAt: first.id }, ...flow.steps];
    return fromItems({ ...flow, steps }, itemsOf({ ...flow, steps }));
  }
  if (flow.questions.length < 2) return { ...flow, steps: [{ id: newId(), startsAt: first.id }] };
  const contactRun = flow.questions.findIndex((question) => !isContactQuestion(question));
  const cut = contactRun > 0 ? contactRun : Math.ceil(flow.questions.length / 2);
  const second = flow.questions[cut];
  const steps: FormStep[] = [
    { id: newId(), startsAt: first.id, ...(contactRun > 0 && second !== undefined ? { title: words.details } : {}) },
    ...(second === undefined ? [] : [{ id: newId(), startsAt: second.id }]),
    // Breaks at the end (with nothing under them yet) are kept where they were.
    ...flow.steps.filter((step) => step.startsAt === undefined),
  ];
  return fromItems({ ...flow, steps }, itemsOf({ ...flow, steps }));
}

/** The flow with a new break starting at `questionId` (Split here): its questions from there on make a new step. */
export function splitAt(flow: Flow, questionId: string, id: string): Flow {
  if (!flow.questions.some((question) => question.id === questionId)) return flow;
  if (flow.steps.some((step) => step.startsAt === questionId)) return flow;
  const items = itemsOf(flow);
  const at = items.findIndex((item) => item.kind === 'question' && item.id === questionId);
  const next = [...items.slice(0, at), { kind: 'step' as const, id }, ...items.slice(at)];
  return fromItems({ ...flow, steps: [...flow.steps, { id }] }, next);
}

/** Whether a question starts a step (it comes right after a break): there is nothing to split above it. */
export function startsAStep(flow: Flow, questionId: string): boolean {
  const items = itemsOf(flow);
  const at = items.findIndex((item) => item.kind === 'question' && item.id === questionId);
  return at <= 0 || items[at - 1]?.kind === 'step';
}

/** Whether the break `id` is the form's first page, which has no step above it to merge with. */
export function isFirstStep(flow: Flow, id: string): boolean {
  return itemsOf(flow)[0]?.id === id;
}
