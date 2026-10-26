// A list of questions as the builders change it (spec 0023, Questions; spec 0057): plain functions over the list,
// each answering a new one, so a form's draft and a booking page's settings hold one list in state and the tests
// check every rule here. A form wraps them over its document (`features/forms/draft.ts`); a booking page uses them as
// they are.
import type { AnswerType, FormAttributeChoice, FormQuestion } from '@crm/data';
import { CHOICE_TYPES, FILES_ONTO, fitsAttribute, freeKey, keyFromLabel, type QuestionPreset } from '@crm/data/forms';
import { strings } from './strings.ts';

/** A list of questions, in order. */
export type Questions = readonly FormQuestion[];

/** The keys the questions use, but `except`'s. */
function keysOf(questions: Questions, except?: string): ReadonlySet<string> {
  return new Set(questions.filter((question) => question.id !== except).map((question) => question.key));
}

/** A new question at the end: Short text, no label yet ("Untitled question"), not filed, optional. */
export function addQuestion(questions: Questions, id: string): FormQuestion[] {
  const question: FormQuestion = {
    id,
    key: freeKey('question', keysOf(questions)),
    label: '',
    answerType: 'short_text',
    required: false,
    update: 'fill',
  };
  return [...questions, question];
}

/** A preset's question at the end, not filed, its key made free. */
export function addPreset(questions: Questions, preset: QuestionPreset, id: string): FormQuestion[] {
  const question: FormQuestion = {
    id,
    key: freeKey(preset.key, keysOf(questions)),
    label: preset.label,
    answerType: preset.answerType,
    ...(preset.choices === undefined ? {} : { choices: [...preset.choices] }),
    ...(preset.placeholder === undefined ? {} : { placeholder: preset.placeholder }),
    required: false,
    update: 'fill',
  };
  return [...questions, question];
}

/** A copy right below `id`, its key suffixed (`company_2`) and not filed, so two questions never share an attribute. */
export function duplicateQuestion(questions: Questions, id: string, copyId: string): FormQuestion[] {
  const index = questions.findIndex((question) => question.id === id);
  const source = questions[index];
  if (source === undefined) return [...questions];
  const { filedOn: _filed, ...rest } = source;
  const copy: FormQuestion = { ...rest, id: copyId, key: freeKey(source.key, keysOf(questions)) };
  return [...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)];
}

/** The list without `id`, and what Undo needs to put it back where it was. */
export function removeQuestion(
  questions: Questions,
  id: string,
): {
  readonly questions: FormQuestion[];
  readonly removed?: { readonly question: FormQuestion; readonly index: number };
} {
  const index = questions.findIndex((question) => question.id === id);
  const question = questions[index];
  if (question === undefined) return { questions: [...questions] };
  return { questions: questions.filter((each) => each.id !== id), removed: { question, index } };
}

/**
 * A removed question back at its place (Undo). Its key is made free again,
 * and its filing dropped if another question took that attribute meanwhile.
 */
export function restoreQuestion(questions: Questions, question: FormQuestion, index: number): FormQuestion[] {
  if (questions.some((each) => each.id === question.id)) return [...questions];
  const taken = questions.some(
    (each) => question.filedOn !== undefined && each.filedOn?.attributeId === question.filedOn.attributeId,
  );
  const { filedOn, ...rest } = question;
  const back: FormQuestion = {
    ...rest,
    key: freeKey(question.key, keysOf(questions)),
    ...(filedOn === undefined || taken ? {} : { filedOn }),
  };
  const at = Math.min(index, questions.length);
  return [...questions.slice(0, at), back, ...questions.slice(at)];
}

/** The list with `id` moved to `index`. */
export function moveQuestion(questions: Questions, id: string, index: number): FormQuestion[] {
  const moving = questions.find((question) => question.id === id);
  if (moving === undefined) return [...questions];
  const rest = questions.filter((question) => question.id !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** What a question's editor changes in one go. `filedOn: null` is Not filed. */
export interface QuestionChange {
  readonly label?: string;
  readonly answerType?: AnswerType;
  readonly choices?: readonly string[];
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly filedOn?: string | null;
  /** Show when (spec 0043): new conditions, or null to always show it. */
  readonly showWhen?: FormQuestion['showWhen'] | null;
}

/**
 * The list with one question changed. A label change also changes the key
 * of a question that never went live (so answers are stored under a word
 * from the question), and every Show when reading the old key follows it.
 * Filing on an attribute another question uses moves it here, leaving the
 * other Not filed. A choice type gets its first empty choice when it has none.
 */
export function changeQuestion(
  questions: Questions,
  id: string,
  change: QuestionChange,
  liveIds: ReadonlySet<string> = new Set(),
): FormQuestion[] {
  const moving = change.filedOn ?? undefined;
  const changed = questions.map((question): FormQuestion => {
    if (question.id !== id) {
      if (moving !== undefined && question.filedOn?.attributeId === moving) {
        const { filedOn: _gone, ...rest } = question;
        return rest;
      }
      return question;
    }
    const { filedOn, showWhen: shownWhen, ...rest } = question;
    const showWhen = change.showWhen === null ? undefined : (change.showWhen ?? shownWhen);
    const label = change.label ?? question.label;
    const answerType = change.answerType ?? question.answerType;
    const key =
      change.label !== undefined && !liveIds.has(question.id)
        ? freeKey(keyFromLabel(label) === '' ? 'question' : keyFromLabel(label), keysOf(questions, question.id))
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
      ...(showWhen === undefined ? {} : { showWhen }),
    };
  });
  return renamedKeys(questions, changed).reduce((list, [from, to]) => renameShowWhen(list, from, to), changed);
}

/** Each key a question changed between two lists of the same questions, as `[from, to]`. */
export function renamedKeys(before: Questions, after: Questions): readonly (readonly [string, string])[] {
  const was = new Map(before.map((question) => [question.id, question.key]));
  return after.flatMap((question) => {
    const from = was.get(question.id);
    return from === undefined || from === question.key ? [] : [[from, question.key] as const];
  });
}

/** The list with every Show when condition reading `from` reading `to` instead (spec 0043). */
export function renameShowWhen(questions: Questions, from: string, to: string): FormQuestion[] {
  return questions.map((question) =>
    question.showWhen === undefined
      ? question
      : {
          ...question,
          showWhen: {
            ...question.showWhen,
            rules: question.showWhen.rules.map((condition) =>
              condition.key === from ? { ...condition, key: to } : condition,
            ),
          },
        },
  );
}

/** The attributes a question of `answerType` may be filed on, in their order. */
export function fittingAttributes(
  attributes: readonly FormAttributeChoice[],
  answerType: AnswerType,
): readonly FormAttributeChoice[] {
  return attributes.filter((attribute) => fitsAttribute(answerType, attribute.type));
}

/** Where a question's answers go, as its closed card says it: "Person › Budget band", or Not filed. */
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

/**
 * Files each unfiled question whose label or key names a free attribute that
 * fits its type ("Budget band" for "Budget band", "Phone" for "phone").
 */
export function fileByLabel(questions: Questions, attributes: readonly FormAttributeChoice[]): FormQuestion[] {
  const used = new Set(questions.flatMap((question) => question.filedOn?.attributeId ?? []));
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return questions.map((question): FormQuestion => {
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
}

/** An attribute to create on the target object for a question that has none to file onto. */
export interface PlannedAttribute {
  readonly questionId: string;
  readonly title: string;
  readonly type: 'text' | 'email' | 'phone' | 'url' | 'number' | 'select' | 'checkbox';
  /** A select's options, from the question's own choices. */
  readonly choices: readonly string[];
}

/** The attribute type a question's answer type makes: the first fit in `FILES_ONTO`, a select for choices. */
function plannedType(answerType: AnswerType): PlannedAttribute['type'] {
  const first = FILES_ONTO[answerType][0];
  switch (first) {
    case 'email':
    case 'phone':
    case 'url':
    case 'number':
    case 'select':
    case 'checkbox':
      return first;
    default:
      return 'text';
  }
}

/** A title no existing attribute (or earlier plan) has, by name ignoring case: "Budget", then "Budget 2". */
function freeTitle(wanted: string, taken: ReadonlySet<string>): string {
  const lower = (text: string) => text.trim().toLowerCase();
  if (!taken.has(lower(wanted))) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted} ${String(n)}`;
    if (!taken.has(lower(candidate))) return candidate;
  }
}

/**
 * The attributes to create for the questions still unfiled: a labelled, non file question gets one titled from its
 * label, typed from its answer type, with a select carrying its choices. Empty while nothing is filed (`isFiling`
 * false: a form that keeps submissions only, a booking page kept out of the CRM, a reader who can't add attributes).
 */
export function planNewAttributes(
  questions: Questions,
  attributes: readonly FormAttributeChoice[],
  isFiling: boolean,
): readonly PlannedAttribute[] {
  if (!isFiling) return [];
  const taken = new Set(attributes.map((attribute) => attribute.title.trim().toLowerCase()));
  const plans: PlannedAttribute[] = [];
  for (const question of questions) {
    const label = question.label.trim();
    if (question.filedOn !== undefined || label === '' || question.answerType === 'file') continue;
    const title = freeTitle(label, taken);
    taken.add(title.toLowerCase());
    plans.push({
      questionId: question.id,
      title,
      type: plannedType(question.answerType),
      choices: CHOICE_TYPES.includes(question.answerType)
        ? (question.choices ?? []).filter((choice) => choice.trim() !== '')
        : [],
    });
  }
  return plans;
}
