// The builder's changes to a draft (spec 0023, 0023-experience.md, Questions):
// plain functions over the document, each answering a new one, so the screen
// keeps one draft in state and the tests check every rule here.
import type {
  AnswerType,
  FormAttributeChoice,
  FormDocument,
  FormQuestion,
  FormTargetChoices,
  FormView,
} from '@crm/data';
import {
  CHOICE_TYPES,
  fitsAttribute,
  freeKey,
  keyFromLabel,
  type PublishAttribute,
  type QuestionPreset,
} from '@crm/data/forms';
import { strings } from './strings.ts';

/** The keys the draft's questions use, but `except`'s. */
function keysOf(document: FormDocument, except?: string): ReadonlySet<string> {
  return new Set(document.questions.filter((question) => question.id !== except).map((question) => question.key));
}

/** A new question at the end: Short text, no label yet ("Untitled question"), not filed, optional. */
export function addQuestion(document: FormDocument, id: string): FormDocument {
  const question: FormQuestion = {
    id,
    key: freeKey('question', keysOf(document)),
    label: '',
    answerType: 'short_text',
    required: false,
    update: 'fill',
  };
  return { ...document, questions: [...document.questions, question] };
}

/** A preset's question at the end, not filed, its key made free. */
export function addPreset(document: FormDocument, preset: QuestionPreset, id: string): FormDocument {
  const question: FormQuestion = {
    id,
    key: freeKey(preset.key, keysOf(document)),
    label: preset.label,
    answerType: preset.answerType,
    ...(preset.choices === undefined ? {} : { choices: [...preset.choices] }),
    ...(preset.placeholder === undefined ? {} : { placeholder: preset.placeholder }),
    required: false,
    update: 'fill',
  };
  return { ...document, questions: [...document.questions, question] };
}

/** A copy right below `id`, its key suffixed (`company_2`) and not filed, so two questions never share an attribute. */
export function duplicateQuestion(document: FormDocument, id: string, copyId: string): FormDocument {
  const index = document.questions.findIndex((question) => question.id === id);
  const source = document.questions[index];
  if (source === undefined) return document;
  const { filedOn: _filed, ...rest } = source;
  const copy: FormQuestion = { ...rest, id: copyId, key: freeKey(source.key, keysOf(document)) };
  return {
    ...document,
    questions: [...document.questions.slice(0, index + 1), copy, ...document.questions.slice(index + 1)],
  };
}

/** The draft without `id`, and what Undo needs to put it back where it was. */
export function removeQuestion(
  document: FormDocument,
  id: string,
): { readonly document: FormDocument; readonly removed?: { readonly question: FormQuestion; readonly index: number } } {
  const index = document.questions.findIndex((question) => question.id === id);
  const question = document.questions[index];
  if (question === undefined) return { document };
  return {
    document: { ...document, questions: document.questions.filter((each) => each.id !== id) },
    removed: { question, index },
  };
}

/**
 * A removed question back at its place (Undo). Its key is made free again,
 * and its filing dropped if another question took that attribute meanwhile.
 */
export function restoreQuestion(document: FormDocument, question: FormQuestion, index: number): FormDocument {
  if (document.questions.some((each) => each.id === question.id)) return document;
  const taken = document.questions.some(
    (each) => question.filedOn !== undefined && each.filedOn?.attributeId === question.filedOn.attributeId,
  );
  const { filedOn, ...rest } = question;
  const back: FormQuestion = {
    ...rest,
    key: freeKey(question.key, keysOf(document)),
    ...(filedOn === undefined || taken ? {} : { filedOn }),
  };
  const at = Math.min(index, document.questions.length);
  return { ...document, questions: [...document.questions.slice(0, at), back, ...document.questions.slice(at)] };
}

/** The draft with `id` moved to `index`. */
export function moveQuestion(document: FormDocument, id: string, index: number): FormDocument {
  const moving = document.questions.find((question) => question.id === id);
  if (moving === undefined) return document;
  const rest = document.questions.filter((question) => question.id !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return { ...document, questions: [...rest.slice(0, at), moving, ...rest.slice(at)] };
}

/** What a question's editor changes in one go. `filedOn: null` is Not filed. */
export interface QuestionChange {
  readonly label?: string;
  readonly answerType?: AnswerType;
  readonly choices?: readonly string[];
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly filedOn?: string | null;
}

/**
 * The draft with one question changed. A label change also changes the key
 * of a question that never went live (so answers are stored under a word
 * from the question). Filing on an attribute another question uses moves it
 * here, leaving the other Not filed. A choice type gets its first empty
 * choice when it has none.
 */
export function changeQuestion(
  document: FormDocument,
  id: string,
  change: QuestionChange,
  liveIds: ReadonlySet<string> = new Set(),
): FormDocument {
  const moving = change.filedOn ?? undefined;
  const questions = document.questions.map((question): FormQuestion => {
    if (question.id !== id) {
      if (moving !== undefined && question.filedOn?.attributeId === moving) {
        const { filedOn: _gone, ...rest } = question;
        return rest;
      }
      return question;
    }
    const { filedOn, ...rest } = question;
    const label = change.label ?? question.label;
    const answerType = change.answerType ?? question.answerType;
    const key =
      change.label !== undefined && !liveIds.has(question.id)
        ? freeKey(keyFromLabel(label) === '' ? 'question' : keyFromLabel(label), keysOf(document, question.id))
        : question.key;
    const choices =
      change.choices !== undefined
        ? [...change.choices]
        : CHOICE_TYPES.includes(answerType) && question.choices === undefined
          ? []
          : question.choices;
    const filing =
      change.filedOn === null ? undefined : change.filedOn === undefined ? filedOn?.attributeId : change.filedOn;
    return {
      ...rest,
      key,
      label,
      answerType,
      ...(choices === undefined ? {} : { choices }),
      ...(change.placeholder !== undefined
        ? { placeholder: change.placeholder }
        : question.placeholder === undefined
          ? {}
          : { placeholder: question.placeholder }),
      required: change.required ?? question.required,
      ...(filing === undefined ? {} : { filedOn: { objectRole: 'main' as const, attributeId: filing } }),
    };
  });
  return { ...document, questions };
}

/** The attributes a question of `answerType` may be filed on, in their order. */
export function fittingAttributes(
  attributes: readonly FormAttributeChoice[],
  answerType: AnswerType,
): readonly FormAttributeChoice[] {
  return attributes.filter((attribute) => fitsAttribute(answerType, attribute.type));
}

/** Where a question's answers go, as its closed card says it: "Person · Budget band", or Not filed. */
export function filedLine(
  question: FormQuestion,
  objectName: string,
  attributes: readonly FormAttributeChoice[],
): string {
  const id = question.filedOn?.attributeId;
  if (id === undefined) return strings.notFiled;
  const attribute = attributes.find((each) => each.attributeId === id);
  return attribute === undefined ? strings.goneAttribute : strings.filedLine(objectName, attribute.title);
}

/** Whether `question` is the email question the form matches people by: it can't be deleted. */
export function isMatchQuestion(document: FormDocument, question: FormQuestion): boolean {
  const match = document.targets.main.matchAttributeId;
  return match !== undefined && question.answerType === 'email' && question.filedOn?.attributeId === match;
}

/**
 * Files each unfiled question whose label or key names a free attribute that
 * fits its type ("Budget band" for "Budget band", "Phone" for "phone"):
 * the first publish's prefill.
 */
export function fileByLabel(document: FormDocument, attributes: readonly FormAttributeChoice[]): FormDocument {
  const used = new Set(document.questions.flatMap((question) => question.filedOn?.attributeId ?? []));
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const questions = document.questions.map((question): FormQuestion => {
    if (question.filedOn !== undefined) return question;
    const names = [plain(question.label), plain(question.key)];
    const match = attributes.find(
      (attribute) =>
        attribute.canWrite &&
        !used.has(attribute.attributeId) &&
        fitsAttribute(question.answerType, attribute.type) &&
        names.includes(plain(attribute.title)),
    );
    if (match === undefined) return question;
    used.add(match.attributeId);
    return { ...question, filedOn: { objectRole: 'main', attributeId: match.attributeId } };
  });
  return { ...document, questions };
}

/** The target's attributes as the publish check reads them. */
export function publishAttributesOf(target: FormTargetChoices): ReadonlyMap<string, PublishAttribute> {
  return new Map(
    target.items.map((item) => [
      item.attributeId,
      {
        id: item.attributeId,
        title: item.title,
        type: item.type,
        objectName: target.objectName,
        canWrite: item.canWrite,
      },
    ]),
  );
}

/** The status line's tone and words. */
export function statusOf(
  form: Pick<FormView, 'status' | 'liveVersionNumber' | 'hasUnpublished'>,
  isChanged: boolean,
): { readonly tone: 'live' | 'changed' | 'draft' | 'paused'; readonly text: string } {
  if (form.liveVersionNumber === undefined) return { tone: 'draft', text: strings.statusDraft };
  if (form.status === 'paused') return { tone: 'paused', text: strings.statusPaused };
  if (isChanged) return { tone: 'changed', text: strings.statusChanged };
  return { tone: 'live', text: strings.statusLive(form.liveVersionNumber) };
}

/** Whether two documents say the same thing (key order aside). */
export function sameDocument(a: FormDocument | undefined, b: FormDocument | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
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
