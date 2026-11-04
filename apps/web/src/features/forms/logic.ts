// A form's logic as plain functions (T39, T41; the owner, 5 November 2026: "the rules need to be explicit and
// smart"): the question a new rule reads first, and keeping every rule in step when a choice is renamed or removed.
// No React and no I/O: the builder's screens call these, and `logic.test.ts` checks them.
import type { FormDocument, FormQuestion } from '@crm/data';
import { SCORE_FACT, stepsOfBreaks, type ShowWhen } from '@crm/data/forms';
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

/** Where a logic problem is, so the screen can say it on the rule itself. */
export type LogicPlace =
  | { readonly kind: 'question'; readonly questionId: string }
  | { readonly kind: 'step'; readonly stepId: string }
  | { readonly kind: 'jump'; readonly stepId: string; readonly index: number }
  | { readonly kind: 'rule'; readonly ruleId: string };

/**
 * What can be wrong with a form's logic (T41: "detect never-matching rules, unreachable steps, conflicts, loops,
 * hidden required questions"):
 * - `gone`: a condition reads a question the form no longer has;
 * - `never`: a rule can never match (a value that is not one of the question's choices, or one question asked to be
 *   two things at once);
 * - `shadowed`: an earlier rule in the same list always catches these people first (the first match wins);
 * - `unreachable`: no visitor can reach this step;
 * - `backward`: a jump goes back up the form, which would loop, so it is ignored;
 * - `hiddenRequired`: a required question some people never see (they won't have to answer it).
 */
export type LogicProblemKind = 'gone' | 'never' | 'shadowed' | 'unreachable' | 'backward' | 'hiddenRequired';

/** One problem: its kind, where it is, and, for a shadowed rule, which rule wins (its place in its list, from 1). */
export interface LogicProblem {
  readonly kind: LogicProblemKind;
  readonly place: LogicPlace;
  readonly winner?: number;
}

/** A condition's values, lower case. */
function valuesIn(condition: Condition): readonly string[] {
  const value = condition.value;
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : value)
    .map((each) => each.trim().toLowerCase())
    .filter((each) => each !== '');
}

/** Whether a condition is finished enough to judge: a question, and a value unless its comparison takes none. */
function isJudged(condition: Condition): boolean {
  if (condition.key === '') return false;
  if (condition.op === 'is_answered' || condition.op === 'is_empty') return true;
  return valuesIn(condition).length > 0;
}

/**
 * Whether one condition can never hold, read against the questions: a value that is none of a choice question's
 * choices (or not yes or no), or a number comparison against words.
 */
function conditionNever(condition: Condition, facts: ReadonlyMap<string, Fact>): boolean {
  const fact = facts.get(condition.key);
  if (fact === undefined || !isJudged(condition)) return false;
  const wanted = valuesIn(condition);
  if (fact.options !== undefined && (condition.op === 'is' || condition.op === 'is_any_of')) {
    const known = new Set(fact.options.map((option) => option.id.trim().toLowerCase()));
    return wanted.every((value) => !known.has(value));
  }
  if (condition.op === 'more_than' || condition.op === 'less_than') {
    return wanted.every((value) => !Number.isFinite(Number(value.replaceAll(',', ''))));
  }
  return false;
}

/** Whether one condition always holds: a required question "is answered", or "is any of" every choice it has. */
function conditionAlways(
  condition: Condition,
  facts: ReadonlyMap<string, Fact>,
  questions: readonly FormQuestion[],
): boolean {
  const fact = facts.get(condition.key);
  if (fact === undefined) return false;
  const question = questions.find((each) => each.key === condition.key);
  if (condition.op === 'is_answered') return question?.required === true && question.showWhen === undefined;
  if (condition.op === 'is_any_of' && fact.options !== undefined && fact.options.length > 0) {
    const wanted = new Set(valuesIn(condition));
    return fact.options.every((option) => wanted.has(option.id.trim().toLowerCase()));
  }
  return false;
}

/** Whether a set of conditions can never match: all of them where one never holds, or one question two ways. */
function whenNever(when: Conditions, facts: ReadonlyMap<string, Fact>): boolean {
  const judged = when.rules.filter(isJudged);
  if (judged.length === 0) return false;
  if (when.join === 'any') return judged.every((condition) => conditionNever(condition, facts));
  if (judged.some((condition) => conditionNever(condition, facts))) return true;
  // "Budget is A and Budget is B" on a question that takes one answer.
  const single = judged.filter((condition) => condition.op === 'is' && facts.get(condition.key)?.kind !== undefined);
  const byKey = new Map<string, Set<string>>();
  for (const condition of single) {
    const question = facts.get(condition.key);
    if (question?.options === undefined) continue;
    const seen = byKey.get(condition.key) ?? new Set<string>();
    for (const value of valuesIn(condition)) seen.add(value);
    byKey.set(condition.key, seen);
  }
  return [...byKey.entries()].some(([key, values]) => values.size > 1 && !isMulti(key, facts));
}

/** A multi select takes several answers, so "is A and is B" can hold there. */
function isMulti(key: string, facts: ReadonlyMap<string, Fact>): boolean {
  return facts.get(key)?.group === MULTI;
}
/** A marker on a multi select's fact, set by `factMap`. */
const MULTI = '~multi';

/** Whether a set of conditions always matches: any of them always holding, or all of them for "all". */
function whenAlways(when: Conditions, facts: ReadonlyMap<string, Fact>, questions: readonly FormQuestion[]): boolean {
  const judged = when.rules.filter(isJudged);
  if (judged.length === 0 || judged.length !== when.rules.length) return false;
  return when.join === 'any'
    ? judged.some((condition) => conditionAlways(condition, facts, questions))
    : judged.every((condition) => conditionAlways(condition, facts, questions));
}

/** Two sets of conditions that say the same thing, order aside. */
function sameWhen(a: Conditions, b: Conditions): boolean {
  const said = (when: Conditions) =>
    when.rules
      .map((condition) => `${condition.key}|${condition.op}|${[...valuesIn(condition)].sort().join(',')}`)
      .sort()
      .join(';');
  return (a.join === b.join || a.rules.length === 1) && said(a) === said(b);
}

/** The facts a form's questions give, by key, a multi select marked so it may be two things at once. */
function factMap(questions: readonly FormQuestion[]): ReadonlyMap<string, Fact> {
  return new Map(
    questionFacts(questions).map((fact) => {
      const question = questions.find((each) => each.key === fact.key);
      return [fact.key, question?.answerType === 'multi_select' ? { ...fact, group: MULTI } : fact] as const;
    }),
  );
}

/** The problems in one ordered list of rules: never matching, and caught first by an earlier one. */
function listProblems(
  whens: readonly Conditions[],
  place: (index: number) => LogicPlace,
  facts: ReadonlyMap<string, Fact>,
  questions: readonly FormQuestion[],
  isFact: (key: string) => boolean,
): LogicProblem[] {
  return whens.flatMap((when, index): LogicProblem[] => {
    if (when.rules.some((condition) => !isFact(condition.key))) return [{ kind: 'gone', place: place(index) }];
    if (whenNever(when, facts)) return [{ kind: 'never', place: place(index) }];
    const winner = whens
      .slice(0, index)
      .findIndex((earlier) => whenAlways(earlier, facts, questions) || sameWhen(earlier, when));
    return winner < 0 ? [] : [{ kind: 'shadowed', place: place(index), winner: winner + 1 }];
  });
}

/**
 * Every problem in a form's logic (T41), in the order the form reads: each question's Show only if, each step's
 * Show only if and rules, then After they send's rules. Steps are judged only with the Steps layout, where they are
 * drawn. Plain and pure, so the builder can say each one where it is and the Logic map can list them all.
 */
export function logicProblems(document: FormDocument): readonly LogicProblem[] {
  const questions = document.questions;
  const facts = factMap(questions);
  const keys = new Set(questions.map((question) => question.key));
  const problems: LogicProblem[] = [];
  // A question it has, a record field or a hidden field (they carry a dot), the score, or one still being picked.
  const isFact = (key: string) => keys.has(key) || key.includes('.') || key === SCORE_FACT || key === '';

  for (const question of questions) {
    if (question.showWhen === undefined) continue;
    const place: LogicPlace = { kind: 'question', questionId: question.id };
    if (question.showWhen.rules.some((condition) => !isFact(condition.key))) problems.push({ kind: 'gone', place });
    else if (whenNever(question.showWhen, facts)) problems.push({ kind: 'never', place });
    else if (question.required && !whenAlways(question.showWhen, facts, questions)) {
      problems.push({ kind: 'hiddenRequired', place });
    }
  }

  if (document.layout === 'steps') {
    const steps = stepsOfBreaks(questions, document.steps).filter((step) => step.keys.length > 0);
    const indexOf = new Map(steps.flatMap((step, index) => (step.id === undefined ? [] : [[step.id, index] as const])));
    const stored = new Map(document.steps.map((step) => [step.id, step]));
    // Reachable steps: from the first, each step goes on to its rules' targets, and to the next step unless one of
    // its rules always matches. A step whose Show only if never matches passes everyone on.
    const reached = new Set<number>([0]);
    for (let at = 0; at < steps.length; at += 1) {
      if (!reached.has(at)) continue;
      const step = steps[at];
      const full = step?.id === undefined ? undefined : stored.get(step.id);
      if (full?.showWhen !== undefined && whenNever(full.showWhen, facts)) {
        reached.add(at + 1);
        continue;
      }
      let fallsThrough = true;
      for (const jump of full?.jumps ?? []) {
        if (whenNever(jump.when, facts)) continue;
        const target = 'step' in jump.to ? indexOf.get(jump.to.step) : undefined;
        if (target !== undefined && target > at) reached.add(target);
        if (whenAlways(jump.when, facts, questions)) {
          fallsThrough = false;
          break;
        }
      }
      if (fallsThrough) reached.add(at + 1);
    }
    steps.forEach((step, at) => {
      if (step.id === undefined) return;
      const full = stored.get(step.id);
      if (!reached.has(at)) problems.push({ kind: 'unreachable', place: { kind: 'step', stepId: step.id } });
      if (full?.showWhen !== undefined) {
        const place: LogicPlace = { kind: 'step', stepId: step.id };
        if (whenNever(full.showWhen, facts)) problems.push({ kind: 'never', place });
        else if (
          step.keys.some((key) => questions.find((question) => question.key === key)?.required === true) &&
          !whenAlways(full.showWhen, facts, questions)
        ) {
          problems.push({ kind: 'hiddenRequired', place });
        }
      }
      const jumps = full?.jumps ?? [];
      jumps.forEach((jump, index) => {
        if ('step' in jump.to) {
          const target = indexOf.get(jump.to.step);
          if (target !== undefined && target <= at) {
            problems.push({ kind: 'backward', place: { kind: 'jump', stepId: step.id ?? '', index } });
          }
        }
      });
      problems.push(
        ...listProblems(
          jumps.map((jump) => jump.when),
          (index) => ({ kind: 'jump', stepId: step.id ?? '', index }),
          facts,
          questions,
          isFact,
        ).filter(
          (problem) =>
            !problems.some(
              (each) =>
                each.place.kind === 'jump' &&
                problem.place.kind === 'jump' &&
                each.place.index === problem.place.index &&
                each.place.stepId === problem.place.stepId,
            ),
        ),
      );
    });
  }

  problems.push(
    ...listProblems(
      document.routing.rules.map((rule) => rule.when),
      (index) => ({ kind: 'rule', ruleId: document.routing.rules[index]?.id ?? '' }),
      facts,
      questions,
      isFact,
    ),
  );
  return problems;
}

/** The problems at one place: a question's, a step's, one jump's, or one rule's. */
export function problemsAt(problems: readonly LogicProblem[], place: LogicPlace): readonly LogicProblem[] {
  return problems.filter((problem) => {
    const at = problem.place;
    switch (place.kind) {
      case 'question':
        return at.kind === 'question' && at.questionId === place.questionId;
      case 'step':
        return at.kind === 'step' && at.stepId === place.stepId;
      case 'jump':
        return at.kind === 'jump' && at.stepId === place.stepId && at.index === place.index;
      case 'rule':
        return at.kind === 'rule' && at.ruleId === place.ruleId;
    }
  });
}

/** How many rules a form has, of every kind: Show only if, step rules, After they send's. */
export function logicCount(document: FormDocument): number {
  return (
    document.questions.filter((question) => question.showWhen !== undefined).length +
    document.questions.reduce((sum, question) => sum + (question.jumps?.length ?? 0), 0) +
    document.steps.reduce((sum, step) => sum + (step.showWhen === undefined ? 0 : 1) + (step.jumps?.length ?? 0), 0) +
    document.routing.rules.length
  );
}

/** What a problem says, where it is (T41): plain, one sentence, with what to do. */
export function problemWords(problem: LogicProblem): string {
  switch (problem.kind) {
    case 'gone':
      return 'This reads a question the form no longer has. Pick another, or delete the rule.';
    case 'never':
      return 'This can never match: no answer fits it. Check the answers it asks for.';
    case 'shadowed':
      return `Rule ${String(problem.winner ?? 1)} catches these people first, so this one never runs. The first match wins.`;
    case 'unreachable':
      return 'Nobody reaches this step: the rules above send everyone past it.';
    case 'backward':
      return 'This goes back up the form, which would loop, so it is ignored. Pick a step below.';
    case 'hiddenRequired':
      return 'Required, but some people never see it, so they won’t have to answer it.';
  }
}
