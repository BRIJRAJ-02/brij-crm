// The builder's changes to a draft (spec 0023, 0023-experience.md, Questions):
// plain functions over the document, each answering a new one, so the screen
// keeps one draft in state and the tests check every rule here. The question
// list's own rules live in the shared editor (`features/questions/questions.ts`,
// spec 0057, which a booking page uses too); these wrap them over a form.
import type { FormAttributeChoice, FormDocument, FormQuestion, FormTargetChoices, FormView } from '@crm/data';
import {
  FORM_ENDINGS_MAX,
  FORM_SLUG,
  type FormEnding,
  type PublishAttribute,
  type QuestionPreset,
  slugFromName,
} from '@crm/data/forms';
import * as list from '../questions/questions.ts';
import { keepBreaks, renameStepKeys, type Flow } from '../questions/steps.ts';
import type { PlannedAttribute, QuestionChange } from '../questions/questions.ts';
import { isSavable } from '../routing/facts.ts';
import { barStrings } from './bar-strings.ts';
import { strings } from './strings.ts';

/** A new question at the end: Short text, no label yet ("Untitled question"), not filed, optional. */
export function addQuestion(document: FormDocument, id: string): FormDocument {
  return { ...document, questions: list.addQuestion(document.questions, id) };
}

/** A preset's question at the end, not filed, its key made free. */
export function addPreset(document: FormDocument, preset: QuestionPreset, id: string): FormDocument {
  return { ...document, questions: list.addPreset(document.questions, preset, id) };
}

/** A copy right below `id`, its key suffixed (`company_2`) and not filed, so two questions never share an attribute. */
export function duplicateQuestion(document: FormDocument, id: string, copyId: string): FormDocument {
  return { ...document, questions: list.duplicateQuestion(document.questions, id, copyId) };
}

/** The draft without `id`, and what Undo needs to put it back where it was. */
export function removeQuestion(
  document: FormDocument,
  id: string,
): { readonly document: FormDocument; readonly removed?: { readonly question: FormQuestion; readonly index: number } } {
  const { questions, removed } = list.removeQuestion(document.questions, id);
  return removed === undefined ? { document } : { document: { ...document, questions }, removed };
}

/** A removed question back at its place (Undo), its key made free and its filing dropped if taken meanwhile. */
export function restoreQuestion(document: FormDocument, question: FormQuestion, index: number): FormDocument {
  return { ...document, questions: list.restoreQuestion(document.questions, question, index) };
}

/** The draft with `id` moved to `index`. */
export function moveQuestion(document: FormDocument, id: string, index: number): FormDocument {
  return { ...document, questions: list.moveQuestion(document.questions, id, index) };
}

/**
 * The draft with one question changed (`changeQuestion` in the shared editor): a key that changes with its label is
 * followed by Show when and by the form's routing rules (spec 0043).
 */
export function changeQuestion(
  document: FormDocument,
  id: string,
  change: QuestionChange,
  liveIds: ReadonlySet<string> = new Set(),
): FormDocument {
  return withQuestions(document, list.changeQuestion(document.questions, id, change, liveIds));
}

/**
 * The draft with a new list of questions: each key a question changed is followed by the routing rules too, so a
 * rule never reads a key that is gone. The shared editor changes the list; this keeps the rest of the form in step.
 */
export function withQuestions(document: FormDocument, questions: readonly FormQuestion[]): FormDocument {
  const renames = list.renamedKeys(document.questions, questions);
  // The New step dividers follow the questions (spec 0063): a deleted question's break moves to the next one.
  const next: FormDocument = {
    ...document,
    questions: [...questions],
    steps: keepBreaks(document.questions, questions, document.steps),
  };
  return renames.reduce((each, [from, to]) => renameRouting(each, from, to), next);
}

/**
 * The draft with new questions and breaks together (spec 0063, AC-6303): a move among questions and dividers, or a
 * divider's own change. Keys a question changed are followed by the routing rules and the steps' Show when.
 */
export function withFlow(document: FormDocument, flow: Flow): FormDocument {
  const renames = list.renamedKeys(document.questions, flow.questions);
  const next: FormDocument = { ...document, questions: [...flow.questions], steps: [...flow.steps] };
  return renames.reduce((each, [from, to]) => renameRouting(each, from, to), next);
}

/** The document with every condition reading `from` reading `to` instead: Show when and routing rules alike. */
export function renameKey(document: FormDocument, from: string, to: string): FormDocument {
  return renameRouting({ ...document, questions: list.renameShowWhen(document.questions, from, to) }, from, to);
}

/** The document with every routing rule's and step's condition reading `from` reading `to` instead. */
function renameRouting(document: FormDocument, from: string, to: string): FormDocument {
  return {
    ...document,
    steps: renameStepKeys(document.steps, from, to),
    routing: {
      rules: document.routing.rules.map((rule) => ({
        ...rule,
        when: {
          ...rule.when,
          rules: rule.when.rules.map((condition) => (condition.key === from ? { ...condition, key: to } : condition)),
        },
      })),
    },
  };
}

/** Whether `question` is the email question the form matches people by: it can't be deleted. */
export function isMatchQuestion(document: FormDocument, question: FormQuestion): boolean {
  const match = document.targets.main?.matchAttributeId;
  return match !== undefined && question.answerType === 'email' && question.filedOn?.attributeId === match;
}

/**
 * Files each unfiled question whose label or key names a free attribute that
 * fits its type ("Budget band" for "Budget band", "Phone" for "phone"):
 * the first publish's prefill.
 */
export function fileByLabel(document: FormDocument, attributes: readonly FormAttributeChoice[]): FormDocument {
  return { ...document, questions: list.fileByLabel(document.questions, attributes) };
}

/** The attributes the publish will create for the form's unfiled questions (`planNewAttributes` in the shared editor). */
export function planNewAttributes(
  document: FormDocument,
  attributes: readonly FormAttributeChoice[],
  isFiling: boolean,
): readonly PlannedAttribute[] {
  return list.planNewAttributes(document.questions, attributes, isFiling);
}

export { filedLine, fittingAttributes, type PlannedAttribute, type QuestionChange } from '../questions/questions.ts';

/** The target's attributes as the publish check reads them. */
export function publishAttributesOf(
  target: Pick<FormTargetChoices, 'items' | 'objectName'>,
): ReadonlyMap<string, PublishAttribute> {
  return new Map(
    target.items.map((item) => [
      item.attributeId,
      {
        id: item.attributeId,
        title: item.title,
        type: item.type,
        objectName: target.objectName ?? '',
        canWrite: item.canWrite,
      },
    ]),
  );
}

/** The parts of a form the publish bar names, in the order the editor shows them (spec 0074, AC-7407). */
const PART_NAMES: Readonly<Partial<Record<keyof FormDocument, string>>> = {
  headline: barStrings.parts.headline,
  subheading: barStrings.parts.subheading,
  buttonText: barStrings.parts.buttonText,
  layout: barStrings.parts.layout,
  steps: barStrings.parts.steps,
  endings: barStrings.parts.endings,
  after: barStrings.parts.after,
  look: barStrings.parts.look,
  language: barStrings.parts.language,
  targets: barStrings.parts.targets,
  scoreFiledOn: barStrings.parts.score,
  routing: barStrings.parts.routing,
  confirmation: barStrings.parts.confirmation,
  saveProgress: barStrings.parts.saveProgress,
  closing: barStrings.parts.closing,
  closedMessage: barStrings.parts.closing,
  spam: barStrings.parts.spam,
};

/**
 * What a draft changes against the live form, one plain sentence each, for the publish bar's Changes (spec 0074,
 * AC-7407): each question added, removed or changed by its label, then each other part changed by its name (two
 * fields of one part say it once). Read from the two documents the editor already holds, never asked of the server.
 * `filedBefore` is the server's own memory of earlier mappings and is never a change of the person's.
 */
export function formChanges(draft: FormDocument, live: FormDocument): readonly string[] {
  const label = (question: FormQuestion) => (question.label.trim() === '' ? strings.untitledQuestion : question.label);
  const before = new Map(live.questions.map((question) => [question.id, question]));
  const after = new Set(draft.questions.map((question) => question.id));
  const questions = [
    ...draft.questions.flatMap((question) => {
      const was = before.get(question.id);
      if (was === undefined) return [barStrings.questionAdded(label(question))];
      return sameValue(was, question) ? [] : [barStrings.questionChanged(label(question))];
    }),
    ...live.questions
      .filter((question) => !after.has(question.id))
      .map((question) => barStrings.questionRemoved(label(question))),
  ];
  // A reorder with nothing else changed is a change too.
  const reordered =
    questions.length === 0 &&
    !sameValue(
      draft.questions.map((question) => question.id),
      live.questions.map((question) => question.id),
    );
  // The named parts in the editor's order, then anything else either document holds.
  const keys = new Set([
    ...(Object.keys(PART_NAMES) as (keyof FormDocument)[]),
    ...(Object.keys(draft) as (keyof FormDocument)[]),
    ...(Object.keys(live) as (keyof FormDocument)[]),
  ]);
  const parts = new Set<string>();
  for (const key of keys) {
    if (key === 'questions' || key === 'filedBefore') continue;
    if (!sameValue(draft[key], live[key])) parts.add(PART_NAMES[key] ?? barStrings.parts.settings);
  }
  return [
    ...questions,
    ...(reordered ? [barStrings.questionsOrder] : []),
    ...[...parts].map((part) => barStrings.part(part)),
  ];
}

/** Whether two documents say the same thing (key order aside). */
export function sameDocument(a: FormDocument | undefined, b: FormDocument | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameValue(a, b);
}

/**
 * Whether two values say the same thing, whatever order their keys were written in (a list's order still counts).
 * What the editor writes and what the server answers spell one value with their keys in different orders, so
 * comparing them as plain text reads every round trip as a change.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, each]) => each !== undefined)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([key, each]) => [key, sorted(each)]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/**
 * Whether a web address is complete enough for "Another web page": https (http only for localhost, for local
 * testing), a host with a dot in it, at most 2,048 characters. As strict as the server's check or stricter, so the
 * draft never sends one the server refuses.
 */
export function isRedirectAddress(value: string): boolean {
  if (value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hostname === 'localhost') return url.protocol === 'https:' || url.protocol === 'http:';
  return url.protocol === 'https:' && /^[^.]+(\.[^.]+)+$/.test(url.hostname);
}

/**
 * What a field still needs before the draft can hold it: the thank you page's link, a rule's or an ending's link (After
 * they send), or the button's words.
 */
export type DraftGap = 'redirect' | 'route' | 'button';

/** Whether a rule can be saved as it stands: its conditions complete, and a link it sends to a whole address. */
function isRuleDone(rule: FormDocument['routing']['rules'][number]): boolean {
  return isSavable(rule.when) && (rule.then.kind !== 'redirect' || isRedirectAddress(rule.then.url));
}

/** Whether an ending's button can be saved: no button, a booking page, or a whole web address. */
function isEndingDone(ending: FormEnding): boolean {
  return ending.button?.kind !== 'url' || isRedirectAddress(ending.button.url);
}

/** The first field typed into but not yet complete, which neither saves nor publishes until it is. */
export function draftGap(document: FormDocument): DraftGap | undefined {
  if (document.after.kind === 'redirect' && !isRedirectAddress(document.after.url)) return 'redirect';
  if (
    document.routing.rules.some((rule) => rule.then.kind === 'redirect' && !isRedirectAddress(rule.then.url)) ||
    !(document.endings ?? []).every(isEndingDone)
  ) {
    return 'route';
  }
  if (document.buttonText.trim() === '') return 'button';
  return undefined;
}

/**
 * The draft as it can be saved: a field still being typed (a partial web address, empty button words) keeps what
 * the server holds, so every other change still saves, and the half typed field never comes back as a failed save.
 * A rule still being written is the same (T15, 4 November 2026: picking a question and a comparison saved a rule
 * with no value, and the toast said "Your last change didn't save"): a Show when that is not complete keeps the
 * server's, and a jump whose conditions are not complete is left out of the save, until it has its value.
 */
export function savableDraft(document: FormDocument, saved: FormDocument): FormDocument {
  const after =
    document.after.kind === 'redirect' && !isRedirectAddress(document.after.url) ? saved.after : document.after;
  const buttonText = document.buttonText.trim() === '' ? saved.buttonText : document.buttonText;
  const questions = savableQuestions(document.questions, saved.questions);
  const steps = savableSteps(document.steps, saved.steps);
  // A rule or an ending still being written (After they send) keeps the server's, or waits, as a jump does.
  const rules = document.routing.rules.every(isRuleDone)
    ? document.routing.rules
    : document.routing.rules.flatMap((rule) => {
        if (isRuleDone(rule)) return [rule];
        const kept = saved.routing.rules.find((each) => each.id === rule.id);
        return kept === undefined ? [] : [kept];
      });
  const endings =
    document.endings === undefined || document.endings.every(isEndingDone)
      ? document.endings
      : document.endings.map((ending) => {
          if (isEndingDone(ending)) return ending;
          const kept = saved.endings?.find((each) => each.id === ending.id)?.button;
          const { button: _typing, ...rest } = ending;
          return kept === undefined || (kept.kind === 'url' && !isRedirectAddress(kept.url))
            ? rest
            : { ...rest, button: kept };
        });
  return after === document.after &&
    buttonText === document.buttonText &&
    questions === document.questions &&
    steps === document.steps &&
    rules === document.routing.rules &&
    endings === document.endings
    ? document
    : {
        ...document,
        after,
        buttonText,
        questions,
        steps,
        routing: { rules },
        ...(endings === undefined ? {} : { endings }),
      };
}

/**
 * The questions with each unfinished Show when back at the server's (or none), and unfinished jumps (One at a time)
 * left out: the same list when all are done.
 */
function savableQuestions(
  questions: FormDocument['questions'],
  saved: FormDocument['questions'],
): FormDocument['questions'] {
  const isDone = (question: FormDocument['questions'][number]) =>
    (question.showWhen === undefined || isSavable(question.showWhen)) &&
    (question.jumps ?? []).every((jump) => isSavable(jump.when));
  if (questions.every(isDone)) return questions;
  return questions.map((question) => {
    if (isDone(question)) return question;
    const { showWhen, jumps, ...rest } = question;
    const kept =
      showWhen === undefined || isSavable(showWhen)
        ? showWhen
        : saved.find((each) => each.id === question.id)?.showWhen;
    const done = (jumps ?? []).filter((jump) => isSavable(jump.when));
    return {
      ...rest,
      ...(kept === undefined ? {} : { showWhen: kept }),
      ...(done.length === 0 ? {} : { jumps: done }),
    };
  });
}

/** The steps with an unfinished Show when back at the server's, and unfinished jumps left out. */
function savableSteps(steps: FormDocument['steps'], saved: FormDocument['steps']): FormDocument['steps'] {
  const isDone = (step: FormDocument['steps'][number]) =>
    (step.showWhen === undefined || isSavable(step.showWhen)) &&
    (step.jumps ?? []).every((jump) => isSavable(jump.when));
  if (steps.every(isDone)) return steps;
  return steps.map((step) => {
    if (isDone(step)) return step;
    const { showWhen, jumps, ...rest } = step;
    const kept =
      showWhen === undefined || isSavable(showWhen) ? showWhen : saved.find((each) => each.id === step.id)?.showWhen;
    const done = (jumps ?? []).filter((jump) => isSavable(jump.when));
    return {
      ...rest,
      ...(kept === undefined ? {} : { showWhen: kept }),
      ...(done.length === 0 ? {} : { jumps: done }),
    };
  });
}

/**
 * What the first publish opens with: the form's name (blank while it is still "Untitled form") and an address made
 * from that name, or the form's own key when the name gives none, so a name given before Publish carries into it.
 */
export function publishStart(name: string, publicKey: string): { readonly name: string; readonly address: string } {
  const named = name === strings.untitledForm ? '' : name;
  const suggested = named.trim() === '' ? '' : slugFromName(named);
  return { name: named, address: FORM_SLUG.test(suggested) ? suggested : publicKey };
}

/**
 * What a first publish goes live with, with nothing asked (the owner, 5 November 2026: one click, like Tally): every
 * answer matched to a field by its label (`fileByLabel`, what the old dialog prefilled), the form's own name ("Untitled
 * form" stays until it is renamed), and a link made from the name, or the form's own key when the name gives none.
 * The caller checks the link is free and falls back to the key; anything else is changed later in Settings.
 */
export function firstPublish(
  document: FormDocument,
  form: { readonly name: string; readonly publicKey: string },
  attributes: readonly FormAttributeChoice[],
): { readonly document: FormDocument; readonly name: string; readonly address: string } {
  const start = publishStart(form.name, form.publicKey);
  return {
    document: fileByLabel(document, attributes),
    name: start.name === '' ? form.name : start.name,
    address: start.address,
  };
}

/** Whether Discard changes is offered: a published form whose draft differs from what is live. */
export function canDiscard(form: Pick<FormView, 'liveVersionNumber' | 'hasUnpublished'>, isChanged: boolean): boolean {
  return form.liveVersionNumber !== undefined && (isChanged || form.hasUnpublished);
}

/** A new ending's id: short, stable, and never one the draft already holds. */
export function mintEndingId(endings: readonly FormEnding[]): string {
  for (let place = 1; place <= FORM_ENDINGS_MAX + 1; place += 1) {
    const id = `ending_${String(place)}`;
    if (!endings.some((ending) => ending.id === id)) return id;
  }
  return `ending_${String(Date.now())}`;
}

/** The most words of an ending's line the Flow shows before it trails off. */
const FIRST_WORDS = 12;

/** A line's first words, ending in "…" when there are more; empty for an empty line. */
export function firstWords(line: string): string {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  return words.length <= FIRST_WORDS ? words.join(' ') : `${words.slice(0, FIRST_WORDS).join(' ')}…`;
}

/**
 * Whether the builder warns that a form asks for a file where visitors can't upload one (forms fixes 2): a file or a
 * signature question, and the api saying uploads are off here.
 */
export function uploadsOffFor(
  target: Pick<FormTargetChoices, 'uploadsOff'>,
  document: Pick<FormDocument, 'questions'>,
) {
  return (
    target.uploadsOff === true &&
    document.questions.some((question) => question.answerType === 'file' || question.answerType === 'signature')
  );
}
