// A list of questions as the builders change it (spec 0023, Questions; spec 0057): plain functions over the list,
// each answering a new one, so a form's draft and a booking page's settings hold one list in state and the tests
// check every rule here. A form wraps them over its document (`features/forms/draft.ts`); a booking page uses them as
// they are.
import type { AnswerType, FormAttributeChoice, FormQuestion } from '@crm/data';
import {
  CHOICE_TYPES,
  FILES_ONTO,
  fitsAttribute,
  freeKey,
  keyFromLabel,
  SCORED_TYPES,
  type QuestionPreset,
} from '@crm/data/forms';
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

/**
 * A new question of `answerType` at `index` (the end when past it), no words yet, optional (T40, critique c: the type
 * is picked first, and the question goes under the one being edited). A choice type starts with no choices.
 */
export function insertQuestion(
  questions: Questions,
  id: string,
  answerType: AnswerType,
  index: number,
): FormQuestion[] {
  const question: FormQuestion = {
    id,
    key: freeKey('question', keysOf(questions)),
    label: '',
    answerType,
    required: false,
    update: 'fill',
    ...(CHOICE_TYPES.includes(answerType) ? { choices: [] } : {}),
  };
  const at = Math.max(0, Math.min(index, questions.length));
  return [...questions.slice(0, at), question, ...questions.slice(at)];
}

/**
 * The field a question's words name, when it has never been filed or kept by hand (T40: Save answer to is "Keep with
 * the answer" unless the question matches a field the object already has, such as Email or Company): the same
 * match the first publish makes, one question at a time. Undefined when nothing matches.
 */
export function matchingField(
  questions: Questions,
  id: string,
  label: string,
  attributes: readonly FormAttributeChoice[],
): string | undefined {
  const probe = questions.map((question): FormQuestion => {
    if (question.id !== id) return question;
    const { kept: _kept, filedOn: _filed, ...rest } = question;
    return { ...rest, label };
  });
  return fileByLabel(probe, attributes).find((question) => question.id === id)?.filedOn?.attributeId;
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
  /** True: keep the answer off the CRM (Not filed, chosen). False: let Save give it a field again. */
  readonly kept?: boolean;
  /** Show when (spec 0043): new conditions, or null to always show it. */
  readonly showWhen?: FormQuestion['showWhen'] | null;
  /** What its type sets (spec 0063), merged over what it had: a part set to undefined is cleared. */
  readonly options?: Partial<NonNullable<FormQuestion['options']>>;
  /** What its answers are worth (spec 0063, AC-6316): new points, or null for none. */
  readonly points?: FormQuestion['points'] | null;
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
        // Kept, so it stays Not filed as "choosing it moves it here" promised: unkept, Save would make it a new field.
        const { filedOn: _gone, ...rest } = question;
        return { ...rest, kept: true as const };
      }
      return question;
    }
    const { filedOn, showWhen: shownWhen, kept: wasKept, options: hadOptions, points: hadPoints, ...rest } = question;
    const merged = Object.fromEntries(
      Object.entries({ ...hadOptions, ...change.options }).filter(
        ([, value]: [string, unknown]) => value !== undefined && value !== '',
      ),
    );
    const options = Object.keys(merged).length === 0 ? undefined : (merged as NonNullable<FormQuestion['options']>);
    const showWhen = change.showWhen === null ? undefined : (change.showWhen ?? shownWhen);
    // Points go with the answers they are for: a type that carries none drops them, as the document refuses them.
    const kinds = change.points === null ? undefined : (change.points ?? hadPoints);
    const scored =
      kinds === undefined || !SCORED_TYPES.includes(change.answerType ?? question.answerType) ? undefined : kinds;
    // Points belong to their choice, not to a place in the list: a choice dragged, removed or added takes its own
    // number with it, matched by the words it had. A renamed choice keeps the number at its place.
    const points =
      scored === undefined || scored === 'value' || change.choices === undefined
        ? scored
        : movedPoints(question.choices ?? [], change.choices, scored);
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
      change.kept === true
        ? undefined
        : change.filedOn === null
          ? undefined
          : change.filedOn === undefined
            ? filedOn?.attributeId
            : change.filedOn;
    // Kept off the CRM only while it is filed nowhere: filing it anywhere, or asking for a field again, ends that.
    const kept = filing === undefined && (change.kept ?? wasKept === true);
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
      ...(kept ? { kept: true as const } : {}),
      ...(showWhen === undefined ? {} : { showWhen }),
      ...(options === undefined ? {} : { options }),
      ...(points === undefined ? {} : { points: points === 'value' ? points : [...points] }),
    };
  });
  return renamedKeys(questions, changed).reduce((list, [from, to]) => renameShowWhen(list, from, to), changed);
}

/**
 * A question's points after its choices changed (spec 0063, AC-6316): each new choice takes the number of the old
 * choice with the same words, and one whose words are new keeps the number at its own place, which is what a rename
 * is. Trailing zeros are dropped, so a list of nothing but zeros reads as no points at all.
 */
export function movedPoints(
  before: readonly string[],
  after: readonly string[],
  points: readonly number[],
): readonly number[] | undefined {
  const taken = new Set<number>();
  const moved = after.map((choice, place) => {
    const from = before.findIndex(
      (each, at) => !taken.has(at) && each.trim().toLowerCase() === choice.trim().toLowerCase(),
    );
    if (from !== -1) {
      taken.add(from);
      return points[from] ?? 0;
    }
    // New words at this place: a rename, so the number that was here stays here unless another choice took it.
    return taken.has(place) ? 0 : (points[place] ?? 0);
  });
  while (moved.length > 0 && moved.at(-1) === 0) moved.pop();
  return moved.every((each) => each === 0) ? undefined : moved;
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

/**
 * A question's answer type changed: a field the new type can't fill is let go, rather than kept filed out of sight
 * until Publish refuses FILING_MISFIT (late trap #46), so Publish can give the question a field that fits. A filing
 * on a field the editor doesn't list (hidden from them) is left as it is.
 */
export function typeChange(
  question: Pick<FormQuestion, 'filedOn'>,
  attributes: readonly FormAttributeChoice[],
  answerType: AnswerType,
): QuestionChange {
  const filed = attributes.find((attribute) => attribute.attributeId === question.filedOn?.attributeId);
  return filed !== undefined && !fitsAttribute(answerType, filed.type) ? { answerType, filedOn: null } : { answerType };
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
    if (question.filedOn !== undefined || question.kept === true) return question;
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
  readonly type: PlannedType;
  /** A multi select's field holds several choices (spec 0063). */
  readonly isMulti?: boolean;
  /** A select's options, from the question's own choices. */
  readonly choices: readonly string[];
  /**
   * Made unique: the object a form files onto matches each submission on its one unique email, so an object with
   * none can never take a form (27 October 2026). The email question's own attribute becomes that match.
   */
  readonly isUnique?: boolean;
}

/** The attribute types a question can be given on Save or Publish. */
export type PlannedType =
  'text' | 'email' | 'phone' | 'url' | 'number' | 'select' | 'checkbox' | 'date' | 'rating' | 'location';

/**
 * The attribute type a question's answer type makes: the first fit in `FILES_ONTO`, a select for choices; none for an
 * answer only a field nobody can make holds (a file, a date and time's timestamp), which stays with the submission.
 */
export function plannedType(answerType: AnswerType): PlannedType | undefined {
  const first = FILES_ONTO[answerType][0];
  switch (first) {
    case 'email':
    case 'phone':
    case 'url':
    case 'number':
    case 'select':
    case 'checkbox':
    case 'date':
    case 'rating':
    case 'location':
    case 'text':
    case 'personal_name':
      return first === 'personal_name' ? 'text' : first;
    default:
      return undefined;
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
 * label,
 * typed from its answer type, with a select carrying its choices. Empty while nothing is filed (`isFiling` false: a
 * form that keeps submissions only, a booking page kept out of the CRM, a reader who can't add attributes).
 *
 * A file question gets none: a file answer only files onto a file attribute, and the picker doesn't make those
 * (`PICKER_TYPES`), so there is nothing to create. It stays with the submission, and says so.
 *
 * The first email plan on an object with no unique email of its own is made unique, because that is what the object
 * then matches submissions on. Without it a form could create the email attribute it needs and still refuse to
 * publish, since the match it asks for would never exist.
 */
export function planNewAttributes(
  questions: Questions,
  attributes: readonly FormAttributeChoice[],
  isFiling: boolean,
): readonly PlannedAttribute[] {
  if (!isFiling) return [];
  const taken = new Set(attributes.map((attribute) => attribute.title.trim().toLowerCase()));
  let needsMatch = !attributes.some((attribute) => attribute.isUnique && attribute.type === 'email');
  const plans: PlannedAttribute[] = [];
  for (const question of questions) {
    const label = question.label.trim();
    const type = plannedType(question.answerType);
    if (question.filedOn !== undefined || question.kept === true || label === '' || type === undefined) continue;
    const title = freeTitle(label, taken);
    taken.add(title.toLowerCase());
    const isMatch = type === 'email' && needsMatch;
    if (isMatch) needsMatch = false;
    plans.push({
      questionId: question.id,
      title,
      type,
      // A ranking's choices are the order's words, filed as text: only a select takes them as options.
      choices:
        type === 'select' && CHOICE_TYPES.includes(question.answerType)
          ? (question.choices ?? []).filter((choice) => choice.trim() !== '')
          : [],
      ...(isMatch ? { isUnique: true } : {}),
      ...(question.answerType === 'multi_select' ? { isMulti: true } : {}),
    });
  }
  return plans;
}

/** The answer types a form's How did you hear question may be (spec 0067): a pick from choices, or a short answer. */
export const SOURCE_ANSWER_TYPES: ReadonlySet<string> = new Set(['choice', 'dropdown', 'short_text']);

/**
 * Marks `id` as the form's How did you hear question (spec 0067, AC-6703), or unmarks it: a form has one, so
 * marking it unmarks any other.
 */
export function markSource(questions: Questions, id: string, isSource: boolean): FormQuestion[] {
  return questions.map((question): FormQuestion => {
    const { source: _was, ...rest } = question;
    return question.id === id && isSource ? { ...rest, source: true } : rest;
  });
}
