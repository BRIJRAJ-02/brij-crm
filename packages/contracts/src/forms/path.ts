// A form's layouts and the path a visitor takes through it (spec 0063, AC-6302, AC-6312, AC-6313, AC-6314): which
// questions they pass, grouped into the steps they see, and which ending they land on. Plain TypeScript, no Zod and
// no I/O: the hosted page, the builder's preview, the answer check and the submit endpoint all run it, so the page
// and the server never disagree about what was asked. The Zod schemas live in `document.ts`.
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

/** At most this many endings beside the form's default thank you (spec 0063, AC-6315). */
export const FORM_ENDINGS_MAX = 4;

/** At most this many jumps on one step, or on one question with One at a time (AC-6313). */
export const STEP_JUMPS_MAX = 10;

/** What the path reads of a question: its key, its Show when, and with One at a time its own jumps. */
export interface PathQuestion {
  readonly key: string;
  readonly showWhen?: ShowWhen | undefined;
  /** Where this question sends a visitor (AC-6313); read only by One at a time, where a question is a screen. */
  readonly jumps?: readonly PathJump[] | undefined;
}

/**
 * Where a jump sends a visitor, as the walk reads it (AC-6313): another step further down, or one of the form's
 * endings. The Zod schema of the same shape is `JumpTarget` in `document.ts`.
 */
export type PathJumpTarget = { readonly step: string } | { readonly ending: string };

/** One jump rule: when these answers match, go there. Rules are tried in order and the first match wins. */
export interface PathJump {
  readonly when?: ShowWhen | undefined;
  readonly to: PathJumpTarget;
}

/**
 * One step as the path reads it: the keys of its questions, in order, its optional title, its Show when and its
 * jumps. The questions before a form's first break make a step with no id.
 */
export interface PathStep {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly keys: readonly string[];
  readonly showWhen?: ShowWhen | undefined;
  readonly jumps?: readonly PathJump[] | undefined;
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

/** The path: every question asked, in order, the steps they are asked in, and the ending a jump sent them to. */
export interface FormPath {
  readonly keys: ReadonlySet<string>;
  readonly steps: readonly ShownStep[];
  /** The ending a jump named (AC-6315); absent for the form's default ending. */
  readonly ending?: string | undefined;
}

/**
 * The groups a form's questions fall into before any answer: with Steps, its steps (a question no step names joins
 * the one before it); otherwise one group holding every question, so breaks and their Show when are ignored by
 * Classic and One at a time (AC-6303).
 */
export function groupsOf(form: PathForm): readonly PathStep[] {
  // One at a time asks one question per screen, so each question is a step of its own and carries its own jumps
  // (AC-6313), named by its key: the form's breaks are ignored by this layout, so there is no divider to jump to.
  if (form.layout === 'conversational') {
    return form.questions.map((question) => ({
      id: question.key,
      keys: [question.key],
      ...(question.jumps === undefined ? {} : { jumps: question.jumps }),
    }));
  }
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

/** What a walk made of one question: whether it was shown, and the facts the next question reads. */
export interface PathTake {
  readonly shown: boolean;
  readonly seen: Readonly<Record<string, unknown>>;
}

/**
 * The one walk over a form's groups (AC-6313, AC-6314), which `pathOf` and `checkAnswers` both run so the page, the
 * check and the submit endpoint can never disagree about what was asked. `take` is handed each key in turn with the
 * facts gathered so far and answers whether that question showed and what the next one reads; this walk owns the
 * order alone: a step's Show when over those facts, the step skipped when nothing in it shows, and the step's jumps
 * tried in order once it has been answered.
 *
 * Jumps only go forward: a jump naming this step or one above it, or a step the form no longer has, is ignored and
 * the next step follows, so a visitor can never loop however a document was edited. Publish refuses such a jump
 * (`publishProblem`) rather than leaving it to be ignored here.
 */
export function walkPath(
  form: PathForm,
  take: (key: string, seen: Readonly<Record<string, unknown>>) => PathTake,
): FormPath {
  const groups = groupsOf(form);
  const indexOf = new Map(groups.flatMap((group, index) => (group.id === undefined ? [] : [[group.id, index]])));
  const keys = new Set<string>();
  const steps: ShownStep[] = [];
  let seen: Readonly<Record<string, unknown>> = {};
  let ending: string | undefined;
  let at = 0;
  // One pass per step at most: every move is forward, so the walk always ends.
  for (let guard = 0; at < groups.length && guard <= groups.length; guard += 1) {
    const group = groups[at];
    if (group === undefined) break;
    if (!matchesShowWhen(group.showWhen, seen)) {
      at += 1;
      continue;
    }
    const shown: string[] = [];
    for (const key of group.keys) {
      const result = take(key, seen);
      seen = result.seen;
      if (!result.shown) continue;
      shown.push(key);
      keys.add(key);
    }
    if (shown.length === 0) {
      at += 1;
      continue;
    }
    if (form.layout === 'conversational') steps.push(...shown.map((key) => ({ keys: [key] })));
    // A conversational group holds one question, so the push above is one step; Steps keeps its divider's id.
    else steps.push({ ...(group.id === undefined ? {} : { id: group.id }), title: group.title, keys: shown });
    const target = (group.jumps ?? []).find((each) => matchesShowWhen(each.when, seen))?.to;
    if (target !== undefined && 'ending' in target) {
      ending = target.ending;
      break;
    }
    const to = target === undefined ? undefined : indexOf.get(target.step);
    at = to !== undefined && to > at ? to : at + 1;
  }
  return { keys, steps, ...(ending === undefined ? {} : { ending }) };
}

/**
 * Which questions a visitor passes through for these answers, the steps they see, and the ending a jump sent them
 * to (AC-6312, AC-6313, AC-6314). A step's Show when reads the answers to the questions shown before it; a step it
 * hides takes its questions with it, and a step left with no question showing is skipped and not counted. A
 * question's own Show when reads the shown questions before it, as `visibleQuestions` always has. One at a time
 * makes each question its own step.
 */
export function pathOf(form: PathForm, answers: Readonly<Record<string, unknown>>): FormPath {
  const showWhenOf = new Map(form.questions.map((question) => [question.key, question.showWhen]));
  return walkPath(form, (key, seen) => {
    if (!showWhenOf.has(key) || !matchesShowWhen(showWhenOf.get(key), seen)) return { shown: false, seen };
    return { shown: true, seen: Object.hasOwn(answers, key) ? { ...seen, [key]: answers[key] } : seen };
  });
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
