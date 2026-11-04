// A step's (and, with One at a time, a question's) jumps as the builder changes them (spec 0063, AC-6313): plain
// functions over a form's flow and its endings, so the editor keeps one draft and the rules are tested here. A jump
// only ever goes forward: the targets offered are the steps below it and the form's endings, so a backward jump is
// not something the editor can produce, and publish refuses one a stored document still holds.
import type { FormQuestion } from '@crm/data';
import { stepsOfBreaks, type FormEnding, type FormJump, type FormStep, type JumpTarget } from '@crm/data/forms';
import { strings } from './strings.ts';

/** One target a jump may take, as the picker lists it: `step:<id>` or `ending:<id>`. */
export interface JumpChoice {
  readonly id: string;
  readonly label: string;
}

/** A target as the picker's id. */
export function idOfTarget(target: JumpTarget): string {
  return 'ending' in target ? `ending:${target.ending}` : `step:${target.step}`;
}

/** A picker's id as a target, or undefined when it names neither a step nor an ending. */
export function targetOfId(id: string): JumpTarget | undefined {
  if (id.startsWith('ending:')) return { ending: id.slice('ending:'.length) };
  if (id.startsWith('step:')) return { step: id.slice('step:'.length) };
  return undefined;
}

/**
 * The targets a jump on `stepId` may take, in the order the picker lists them: every step below it that a visitor
 * can reach (one with questions under it), then every ending. A step at the end of the form may still end with an
 * ending, which is the point of one.
 */
export function jumpChoices(
  flow: { readonly questions: readonly FormQuestion[]; readonly steps: readonly FormStep[] },
  endings: readonly FormEnding[],
  stepId: string,
): readonly JumpChoice[] {
  const resolved = stepsOfBreaks(flow.questions, flow.steps);
  const at = resolved.findIndex((step) => step.id === stepId);
  let place = 0;
  const later = resolved.flatMap((step, index): JumpChoice[] => {
    if (step.keys.length > 0) place += 1;
    if (index <= at || step.id === undefined || step.keys.length === 0) return [];
    return [{ id: `step:${step.id}`, label: strings.jumpToStep(place, step.title) }];
  });
  return [
    ...later,
    ...endings.map((ending, index) => ({
      id: `ending:${ending.id}`,
      label: strings.jumpToEnding(index + 1, ending.heading),
    })),
  ];
}

/** The jumps with one added at the end, taking the first target offered; unchanged when there is none to take. */
export function addJump(
  jumps: readonly FormJump[],
  target: JumpTarget | undefined,
  when: FormJump['when'],
): FormJump[] {
  return target === undefined ? [...jumps] : [...jumps, { when, to: target }];
}

/** The jumps with the one at `index` changed. */
export function changeJump(jumps: readonly FormJump[], index: number, change: Partial<FormJump>): FormJump[] {
  return jumps.map((jump, at) => (at === index ? { ...jump, ...change } : jump));
}

/** The jumps without the one at `index`. */
export function removeJump(jumps: readonly FormJump[], index: number): FormJump[] {
  return jumps.filter((_, at) => at !== index);
}

/** A target's words for a jump's line, or undefined when it names a step or an ending the form no longer has. */
export function targetWords(target: JumpTarget, choices: readonly JumpChoice[]): string | undefined {
  return choices.find((choice) => choice.id === idOfTarget(target))?.label;
}

/**
 * Where a visitor goes after step `stepId` when no jump matched: the next step they can reach, by its name ("Step 3",
 * "Step 3 · Your team"), or undefined at the last step, where the form ends with the thank you.
 */
export function nextStepName(
  flow: { readonly questions: readonly FormQuestion[]; readonly steps: readonly FormStep[] },
  stepId: string | undefined,
): string | undefined {
  const resolved = stepsOfBreaks(flow.questions, flow.steps).filter((step) => step.keys.length > 0);
  const at = resolved.findIndex((step) => step.id === stepId);
  const next = at < 0 ? undefined : resolved[at + 1];
  return next === undefined ? undefined : strings.jumpToStep(at + 2, next.title);
}

/** A question One at a time can stop on: every question but a hidden one, which a visitor never sees. */
const isAsked = (question: FormQuestion) => question.answerType !== 'hidden';

/** A question's name in a jump's line: its words, or "Untitled question". */
const questionName = (question: FormQuestion) =>
  question.label.trim() === '' ? strings.untitledQuestion : question.label.trim();

/**
 * The targets a jump on question `questionId` may take with One at a time (spec 0063, AC-6313), where each question
 * is a screen of its own and a jump names the question it goes to by its key: every question below it a visitor sees,
 * then every ending. Only forward targets are offered, as on a step.
 */
export function questionJumpChoices(
  questions: readonly FormQuestion[],
  endings: readonly FormEnding[],
  questionId: string,
): readonly JumpChoice[] {
  const asked = questions.filter(isAsked);
  const at = asked.findIndex((question) => question.id === questionId);
  const later = asked.flatMap((question, index): JumpChoice[] =>
    index <= at
      ? []
      : [{ id: `step:${question.key}`, label: strings.jumpToQuestion(index + 1, questionName(question)) }],
  );
  return [
    ...later,
    ...endings.map((ending, index) => ({
      id: `ending:${ending.id}`,
      label: strings.jumpToEnding(index + 1, ending.heading),
    })),
  ];
}

/**
 * Where a visitor goes after question `questionId` with One at a time when no jump matched: the next question they
 * see, by its place and words ("Question 4 · Budget"), or undefined at the last one, where the form is sent.
 */
export function nextQuestionName(questions: readonly FormQuestion[], questionId: string): string | undefined {
  const asked = questions.filter(isAsked);
  const at = asked.findIndex((question) => question.id === questionId);
  const next = at < 0 ? undefined : asked[at + 1];
  return next === undefined ? undefined : strings.jumpToQuestion(at + 2, questionName(next));
}
