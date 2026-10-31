// A form's layouts and the path a visitor takes through it (spec 0063, AC-6302, AC-6312, AC-6314): which questions
// they pass, grouped into the steps they see. Plain TypeScript, no Zod and no I/O: the hosted page, the builder's
// preview, the answer check and the submit endpoint all run it, so the page and the server never disagree about
// what was asked. The Zod schemas live in `document.ts`.
import { matchesShowWhen, type ShowWhen } from './show-when.ts';

/**
 * How a visitor sees a form: `classic`, every question on one card; `steps`, the questions in groups with Back and
 * Continue; `conversational` (shown as One at a time), one question per screen.
 */
export const FORM_LAYOUTS = ['classic', 'steps', 'conversational'] as const;
/** How a visitor sees a form. */
export type FormLayout = (typeof FORM_LAYOUTS)[number];

/** The longest step title the document takes. */
export const FORM_STEP_TITLE_MAX = 80;

/** What the path reads of a question: its key and its Show when. */
export interface PathQuestion {
  readonly key: string;
  readonly showWhen?: ShowWhen | undefined;
}

/**
 * One step as the path reads it: the keys of its questions, in order, its optional title and its Show when. The
 * questions before a form's first break make a step with no id.
 */
export interface PathStep {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly keys: readonly string[];
  readonly showWhen?: ShowWhen | undefined;
}

/** What `pathOf` needs of a form. Without `layout` it is Classic; `steps` count only with `steps`. */
export interface PathForm {
  readonly layout?: FormLayout | undefined;
  readonly questions: readonly PathQuestion[];
  readonly steps?: readonly PathStep[] | undefined;
}

/** A step on a visitor's path: its title and the keys of the questions it shows, never empty. */
export interface ShownStep {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly keys: readonly string[];
}

/** The path: every question asked, in order, and the steps they are asked in. */
export interface FormPath {
  readonly keys: ReadonlySet<string>;
  readonly steps: readonly ShownStep[];
}

/**
 * The groups a form's questions fall into before any answer: with Steps, its steps (a question no step names joins
 * the one before it); otherwise one group holding every question, so breaks and their Show when are ignored by
 * Classic and One at a time (AC-6303).
 */
export function groupsOf(form: PathForm): readonly PathStep[] {
  const steps = form.layout === 'steps' ? (form.steps ?? []) : [];
  if (steps.length === 0) return [{ keys: form.questions.map((question) => question.key) }];
  const known = new Set(form.questions.map((question) => question.key));
  const named = new Map<string, number>();
  steps.forEach((step, index) => {
    for (const key of step.keys) if (known.has(key) && !named.has(key)) named.set(key, index);
  });
  // Each question in its step, in the form's own order: a key a step names twice, or out of order, never repeats.
  const keys = steps.map((): string[] => []);
  let current = 0;
  for (const question of form.questions) {
    current = named.get(question.key) ?? current;
    keys[current]?.push(question.key);
  }
  return steps.map((step, index) => ({ ...step, keys: keys[index] ?? [] }));
}

/**
 * Which questions a visitor passes through for these answers, and the steps they see (AC-6312, AC-6314). A step's
 * Show when reads the answers to the questions shown before it; a step it hides takes its questions with it, and a
 * step left with no question showing is skipped and not counted. A question's own Show when reads the shown
 * questions before it, as `visibleQuestions` always has. One at a time makes each question its own step.
 */
export function pathOf(form: PathForm, answers: Readonly<Record<string, unknown>>): FormPath {
  const showWhenOf = new Map(form.questions.map((question) => [question.key, question.showWhen]));
  const keys = new Set<string>();
  const seen: Record<string, unknown> = {};
  const steps: ShownStep[] = [];
  for (const group of groupsOf(form)) {
    if (!matchesShowWhen(group.showWhen, seen)) continue;
    const shown: string[] = [];
    for (const key of group.keys) {
      if (!showWhenOf.has(key) || !matchesShowWhen(showWhenOf.get(key), seen)) continue;
      shown.push(key);
      keys.add(key);
      if (Object.hasOwn(answers, key)) seen[key] = answers[key];
    }
    if (shown.length === 0) continue;
    if (form.layout === 'conversational') steps.push(...shown.map((key) => ({ keys: [key] })));
    else steps.push({ ...(group.id === undefined ? {} : { id: group.id }), title: group.title, keys: shown });
  }
  return { keys, steps };
}

/** What `visibleQuestions` needs of a question. */
export type ShownQuestion = PathQuestion;

/**
 * The keys of the questions that show for these answers (spec 0043, AC-1614), in order: `pathOf` over the questions
 * alone, so a question's Show when reads only earlier questions that are themselves shown, and hiding one hides
 * those that depend on it too.
 */
export function visibleQuestions(
  questions: readonly ShownQuestion[],
  answers: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return pathOf({ questions }, answers).keys;
}
