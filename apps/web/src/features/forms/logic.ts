// A form's logic as plain functions (T39, T41; the owner, 5 November 2026: "the rules need to be explicit and
// smart"): the question a new rule reads first, and keeping every rule in step when a choice is renamed or removed.
// No React and no I/O: the builder's screens call these, and `logic.test.ts` checks them.
import type { FormDocument, FormQuestion } from '@crm/data';
import type { ShowWhen } from '@crm/data/forms';
import { questionFacts, type Fact } from '../routing/facts.ts';
import { isContactQuestion } from '../questions/steps.ts';

/** The answer types a rule branches on best: picked from a list, so its value is one of the real choices. */
const PICKED_TYPES: ReadonlySet<string> = new Set(['choice', 'dropdown', 'multi_select', 'yes_no', 'checkbox']);
/** Then a number a rule can compare: a rating, a scale, a number. */
const NUMBER_TYPES: ReadonlySet<string> = new Set(['rating', 'scale', 'number']);
/** Never a rule's first guess: what someone agreed to, or their contact details. */
const NEVER_FIRST: ReadonlySet<string> = new Set(['consent', 'hidden', 'file', 'signature']);

/**
 * The question a new rule reads (T39): the first picked-from-a-list question (a choice, a dropdown, yes or no), then
 * the first number, then any other question that is not contact details; never a consent, a name, an email or a
 * phone. Undefined when the form has nothing a rule could sensibly read.
 */
export function ruleQuestion(questions: readonly FormQuestion[]): FormQuestion | undefined {
  const usable = questions.filter(
    (question) =>
      !NEVER_FIRST.has(question.answerType) && !isContactQuestion(question) && question.answerType !== 'email',
  );
  const hasChoices = (question: FormQuestion) =>
    question.answerType === 'yes_no' ||
    question.answerType === 'checkbox' ||
    (question.choices ?? []).some((choice) => choice.trim() !== '');
  return (
    usable.find((question) => PICKED_TYPES.has(question.answerType) && hasChoices(question)) ??
    usable.find((question) => NUMBER_TYPES.has(question.answerType)) ??
    usable.find((question) => questionFacts([question]).length > 0)
  );
}

/**
 * A new rule's condition, complete the moment it appears where it can be (T39): the rule question "is" its first
 * choice, a rating or scale "is less than" a point in its lower part, else "is" with the value left to type.
 */
export function readyRule(questions: readonly FormQuestion[], facts: readonly Fact[]): ShowWhen | undefined {
  const question = ruleQuestion(questions);
  const fact = question === undefined ? undefined : facts.find((each) => each.key === question.key);
  if (fact === undefined) return undefined;
  const first = fact.options?.[0];
  if (first !== undefined) return { join: 'all', rules: [{ key: fact.key, op: 'is', value: first.id }] };
  const range = fact.range;
  if (range !== undefined && range.to > range.from) {
    const value = String(range.from + Math.ceil((range.to - range.from) * 0.65));
    return { join: 'all', rules: [{ key: fact.key, op: 'less_than', value }] };
  }
  return { join: 'all', rules: [{ key: fact.key, op: 'is' }] };
}

/** One condition list with `transform` applied to each condition; conditions it drops leave, and none left is undefined. */
type Conditions = FormDocument['routing']['rules'][number]['when'];
type Condition = Conditions['rules'][number];

function mapConditions(
  when: Conditions,
  transform: (condition: Condition) => Condition | undefined,
): { readonly when: Conditions | undefined; readonly changed: boolean } {
  let changed = false;
  const rules = when.rules.flatMap((condition) => {
    const next = transform(condition);
    if (next !== condition) changed = true;
    return next === undefined ? [] : [next];
  });
  return { when: rules.length === 0 ? undefined : { ...when, rules }, changed };
}

/**
 * Every condition in the document through `transform` (Show only if on questions and steps, jumps, After they send's
 * rules), with how many rules lost their last condition and so went. Untouched parts keep their identity.
 */
function mapLogic(
  document: FormDocument,
  transform: (condition: Condition) => Condition | undefined,
): { readonly document: FormDocument; readonly dropped: number } {
  let dropped = 0;
  const questions = document.questions.map((question): FormQuestion => {
    let next = question;
    if (question.showWhen !== undefined) {
      const { when, changed } = mapConditions(question.showWhen, transform);
      if (changed) {
        const { showWhen: _was, ...rest } = next;
        if (when === undefined) dropped += 1;
        next = when === undefined ? rest : { ...rest, showWhen: when };
      }
    }
    if (question.jumps !== undefined) {
      const jumps = question.jumps.flatMap((jump) => {
        const { when, changed } = mapConditions(jump.when, transform);
        if (!changed) return [jump];
        if (when === undefined) {
          dropped += 1;
          return [];
        }
        return [{ ...jump, when }];
      });
      if (jumps.length !== question.jumps.length || jumps.some((jump, at) => jump !== question.jumps?.[at])) {
        const { jumps: _was, ...rest } = next;
        next = jumps.length === 0 ? rest : { ...rest, jumps };
      }
    }
    return next;
  });
  const steps = document.steps.map((step) => {
    let next = step;
    if (step.showWhen !== undefined) {
      const { when, changed } = mapConditions(step.showWhen, transform);
      if (changed) {
        const { showWhen: _was, ...rest } = next;
        if (when === undefined) dropped += 1;
        next = when === undefined ? rest : { ...rest, showWhen: when };
      }
    }
    if (step.jumps !== undefined) {
      const jumps = step.jumps.flatMap((jump) => {
        const { when, changed } = mapConditions(jump.when, transform);
        if (!changed) return [jump];
        if (when === undefined) {
          dropped += 1;
          return [];
        }
        return [{ ...jump, when }];
      });
      if (jumps.length !== step.jumps.length || jumps.some((jump, at) => jump !== step.jumps?.[at])) {
        const { jumps: _was, ...rest } = next;
        next = jumps.length === 0 ? rest : { ...rest, jumps };
      }
    }
    return next;
  });
  const rules = document.routing.rules.flatMap((rule) => {
    const { when, changed } = mapConditions(rule.when, transform);
    if (!changed) return [rule];
    if (when === undefined) {
      dropped += 1;
      return [];
    }
    return [{ ...rule, when }];
  });
  const isSame =
    questions.every((question, at) => question === document.questions[at]) &&
    steps.every((step, at) => step === document.steps[at]) &&
    rules.length === document.routing.rules.length &&
    rules.every((rule, at) => rule === document.routing.rules[at]);
  return isSame
    ? { document, dropped: 0 }
    : { document: { ...document, questions, steps, routing: { rules } }, dropped };
}

/** How a choice changed between two versions of one question: renamed in place, or taken out. */
type ChoiceChange =
  | { readonly kind: 'renamed'; readonly key: string; readonly from: string; readonly to: string }
  | { readonly kind: 'removed'; readonly key: string; readonly choice: string };

/**
 * The choices each question renamed or removed between `before` and `after` (T41: values follow renames). A list of
 * the same length with one word changed at one place is a rename; a shorter list lost the words it no longer has.
 */
export function choiceChanges(
  before: readonly FormQuestion[],
  after: readonly FormQuestion[],
): readonly ChoiceChange[] {
  const was = new Map(before.map((question) => [question.id, question]));
  return after.flatMap((question): ChoiceChange[] => {
    const old = was.get(question.id);
    if (old === undefined || old.choices === question.choices) return [];
    const from = (old.choices ?? []).map((each) => each.trim()).filter((each) => each !== '');
    const to = (question.choices ?? []).map((each) => each.trim()).filter((each) => each !== '');
    const key = question.key;
    if ((old.choices ?? []).length === (question.choices ?? []).length) {
      return (old.choices ?? []).flatMap((choice, at): ChoiceChange[] => {
        const next = question.choices?.[at] ?? '';
        return choice.trim() !== '' && next.trim() !== '' && choice.trim() !== next.trim()
          ? [{ kind: 'renamed', key, from: choice.trim(), to: next.trim() }]
          : [];
      });
    }
    return from.filter((choice) => !to.includes(choice)).map((choice) => ({ kind: 'removed' as const, key, choice }));
  });
}

/** Whether a condition's value names `choice` (one value, or one of several). */
function names(condition: Condition, choice: string): boolean {
  const value = condition.value;
  if (value === undefined) return false;
  const wanted = choice.toLowerCase();
  return typeof value === 'string'
    ? value.trim().toLowerCase() === wanted
    : value.some((each) => each.trim().toLowerCase() === wanted);
}

/**
 * The document with every rule kept in step with a change of choices (T41): a renamed choice's rules name its new
 * words; a removed choice leaves the conditions that named it (a list loses just that value), and a rule left with no
 * condition goes. Answers how many rules went, so the screen can say so and offer Undo.
 */
export function followChoices(
  before: readonly FormQuestion[],
  document: FormDocument,
): { readonly document: FormDocument; readonly dropped: number } {
  const changes = choiceChanges(before, document.questions);
  return changes.reduce<{ document: FormDocument; dropped: number }>(
    (sum, change) => {
      const next = mapLogic(sum.document, (condition) => {
        if (condition.key !== change.key) return condition;
        const choice = change.kind === 'renamed' ? change.from : change.choice;
        if (!names(condition, choice)) return condition;
        const value = condition.value;
        if (change.kind === 'renamed') {
          return typeof value === 'string'
            ? { ...condition, value: change.to }
            : {
                ...condition,
                value: (value ?? []).map((each) => (names({ ...condition, value: each }, choice) ? change.to : each)),
              };
        }
        if (typeof value === 'string' || value === undefined) return undefined;
        const kept = value.filter((each) => !names({ ...condition, value: each }, choice));
        return kept.length === 0 ? undefined : { ...condition, value: kept };
      });
      return { document: next.document, dropped: sum.dropped + next.dropped };
    },
    { document, dropped: 0 },
  );
}

/** How many conditions anywhere in the form read `key` (a question's), and optionally name `choice`. */
export function logicUses(document: FormDocument, key: string, choice?: string): number {
  const all: readonly Conditions[] = [
    ...document.questions.flatMap((question) => [
      ...(question.showWhen === undefined ? [] : [question.showWhen]),
      ...(question.jumps ?? []).map((jump) => jump.when),
    ]),
    ...document.steps.flatMap((step) => [
      ...(step.showWhen === undefined ? [] : [step.showWhen]),
      ...(step.jumps ?? []).map((jump) => jump.when),
    ]),
    ...document.routing.rules.map((rule) => rule.when),
  ];
  return all.filter((when) =>
    when.rules.some((condition) => condition.key === key && (choice === undefined || names(condition, choice))),
  ).length;
}

/**
 * The document without any condition reading `key` (a question being deleted): a rule left with no condition goes.
 * Answers how many rules went.
 */
export function dropQuestionLogic(
  document: FormDocument,
  key: string,
): { readonly document: FormDocument; readonly dropped: number } {
  return mapLogic(document, (condition) => (condition.key === key ? undefined : condition));
}
