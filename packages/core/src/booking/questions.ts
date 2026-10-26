// A booking page's own questions (spec 0057): where their answers may be filed, the check a save runs, the answers
// a booking keeps, and their filing onto the person the booking matched. Everything about a question comes from
// forms (spec 0023): the schema, the answer check, the public shape and the record write; this file only says which
// object (People, AC-5706) and keeps a booking's answers with the labels they had (AC-5711).
import { and, isNull, sql } from 'drizzle-orm';
import {
  BookingAnswer,
  fitsAttribute,
  questionsProblem,
  type BookingQuestions,
  type FormTargetChoices,
  type PhoneAnswer,
  type PublishAttribute,
  type PublicQuestion,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { fieldLevel, objectLevel, type Access } from '../access/policy.ts';
import type { EngineScope } from '../engine/scope.ts';
import { refuseOn } from '../engine/refusals.ts';
import { loadAttributes } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { targetChoices } from '../forms/forms.ts';
import { fileOntoRecord } from '../forms/process.ts';
import { publicQuestionOf, publishAttributes } from '../forms/shared.ts';

const { objects } = schema;

/** The workspace's People object, live, or undefined: a booking page files answers there and nowhere else. */
export async function peopleObjectId(tx: WorkspaceTx): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(sql`${objects.standardKey} = 'people'`, isNull(objects.archivedAt)));
  return row?.id;
}

/** The api slug of the person's email, which the booking writes itself: no question files onto it (AC-5703). */
const VISITOR_EMAIL_SLUG = 'email_addresses';

/** What a save refuses a question set to overwrite with: a booking page only fills an empty value. */
const ONLY_FILL = 'A booking page only fills empty fields: anyone can type an email, so it never overwrites one.';

/** What a save refuses a question's filing with, naming nothing about the attribute it asked for. */
const NOT_FILEABLE = 'A question can only be filed onto a field of People you can change.';

/**
 * Checks a page's questions as a save sends them (AC-5706, AC-5717): each one as a form's publish checks it
 * (`questionsProblem`: a label, choices for a choice question, a Show when that reads only earlier questions), and
 * each filing that changed since `before` onto a live, non system attribute of this workspace's People that fits its
 * answer type and that the writer may write, never the person's email (AC-5703). A filing the page already had stays
 * as it is, so a writer who can't write that field (an admin on a teammate's page) still saves their other changes.
 * Anything else, another object's attribute or another workspace's id included, is refused as `CONFIG_INVALID` on
 * `questions`; a filing refusal says nothing of what the id names.
 */
export async function checkPageQuestions(
  tx: WorkspaceTx,
  scope: EngineScope,
  questions: BookingQuestions,
  before: BookingQuestions = [],
): Promise<void> {
  // A booking page only fills an empty value (owner, 26 Oct 2026): the visitor's email is unverified, so a booking
  // never overwrites what a person's record already holds.
  if (questions.some((question) => question.update === 'always')) {
    throw refuseOn('CONFIG_INVALID', ONLY_FILL, 'questions');
  }
  const kept = new Set(
    before.flatMap((question) =>
      question.filedOn === undefined ? [] : [`${question.id}:${question.filedOn.attributeId}`],
    ),
  );
  const isKept = (question: BookingQuestions[number]) =>
    question.filedOn !== undefined && kept.has(`${question.id}:${question.filedOn.attributeId}`);
  const changed = questions.filter((question) => question.filedOn !== undefined && !isKept(question));
  const people = questions.some((question) => question.filedOn !== undefined) ? await peopleObjectId(tx) : undefined;
  if (changed.length > 0 && (people === undefined || objectLevel(scope.access, people) !== 'write')) {
    throw refuseOn('CONFIG_INVALID', NOT_FILEABLE, 'questions');
  }
  // Only People's own attributes are loaded, under row level security: an id of another object or workspace is absent.
  const attributes: ReadonlyMap<string, PublishAttribute> =
    people === undefined ? new Map() : await publishAttributes(tx, scope.access, people);
  const email =
    people === undefined
      ? undefined
      : [...(await loadAttributes(tx, people)).values()].find((each) => each.apiSlug === VISITOR_EMAIL_SLUG)?.id;
  for (const question of changed) {
    const attribute = question.filedOn === undefined ? undefined : attributes.get(question.filedOn.attributeId);
    if (
      attribute === undefined ||
      attribute.id === email ||
      !fitsAttribute(question.answerType, attribute.type) ||
      !attribute.canWrite
    ) {
      throw refuseOn('CONFIG_INVALID', NOT_FILEABLE, 'questions');
    }
  }
  // The rest as a form's publish asks it; a kept filing counts as writable, since it isn't this writer's choice.
  const keptIds = new Set(questions.filter(isKept).map((question) => question.filedOn?.attributeId));
  const asChecked = new Map(
    [...attributes].map(([id, attribute]) => [id, keptIds.has(id) ? { ...attribute, canWrite: true } : attribute]),
  );
  const problem = questionsProblem(questions, asChecked);
  if (problem !== undefined) throw refuseOn('CONFIG_INVALID', problem.message, 'questions');
}

/**
 * A reader's view of a page's questions (hidden means absent): a filing onto a People field hidden from them loses
 * its `filedOn`, so its attribute's id never reaches them. People's id is read once, before any page is shown.
 */
export async function questionsSeenBy(
  tx: WorkspaceTx,
  access: Access,
): Promise<(questions: BookingQuestions) => BookingQuestions> {
  const people = await peopleObjectId(tx);
  return (questions) =>
    questions.map((question) => {
      if (question.filedOn === undefined) return question;
      const isHidden =
        people === undefined || fieldLevel(access, { id: question.filedOn.attributeId, objectId: people }) === 'hidden';
      if (!isHidden) return question;
      const { filedOn: _hidden, ...rest } = question;
      return rest;
    });
}

/**
 * A save's questions with the filings its writer can't see put back (hidden means absent, and never erased): a
 * question they received without `filedOn` because its field is hidden from them keeps the filing it had.
 */
export function withHiddenFilings(
  before: BookingQuestions,
  incoming: BookingQuestions,
  seen: (questions: BookingQuestions) => BookingQuestions,
): BookingQuestions {
  const shown = new Map(seen(before).map((question) => [question.id, question]));
  const had = new Map(before.map((question) => [question.id, question]));
  return incoming.map((question) => {
    const previous = had.get(question.id);
    if (question.filedOn !== undefined || previous?.filedOn === undefined) return question;
    // Hidden from this writer: they never saw the filing, so leaving it out isn't taking it off.
    return shown.get(question.id)?.filedOn === undefined ? { ...question, filedOn: previous.filedOn } : question;
  });
}

/**
 * Where a page's answers may be filed (AC-5706): People and its attributes as a form's Where it goes lists them,
 * the person's email left out, since the booking already writes it (AC-5703). Empty when the workspace has no People.
 */
export async function questionTargets(tx: WorkspaceTx, scope: EngineScope): Promise<FormTargetChoices> {
  const people = await peopleObjectId(tx);
  if (people === undefined) return { items: [] };
  const choices = await targetChoices(tx, scope, people);
  const email = [...(await loadAttributes(tx, people)).values()].find(
    (attribute) => attribute.apiSlug === VISITOR_EMAIL_SLUG,
  );
  return { ...choices, items: choices.items.filter((item) => item.attributeId !== email?.id) };
}

/**
 * Whether Book by chat is off for a page (owner, 26 Oct 2026): chat asks no questions, so a page with a required one
 * books only through its form. A page whose questions are all optional keeps chat, which skips them.
 */
export function chatIsOff(questions: BookingQuestions): boolean {
  return questions.some((question) => question.required);
}

/** A page's questions as its public page draws them (AC-5709): never where an answer is filed. */
export function publicQuestionsOf(questions: BookingQuestions): readonly PublicQuestion[] {
  return questions.map(publicQuestionOf);
}

/**
 * The answers a booking keeps (AC-5711): one per question the visitor answered, in the page's order, with the
 * question's key, label and type as they are now, so a later rename never changes what they answered.
 */
export function bookingAnswersOf(
  questions: BookingQuestions,
  answers: Readonly<Record<string, string | boolean | PhoneAnswer>>,
): BookingAnswer[] {
  return questions.flatMap((question): BookingAnswer[] => {
    if (!Object.hasOwn(answers, question.key)) return [];
    return [
      {
        questionId: question.id,
        key: question.key,
        label: question.label,
        answerType: question.answerType,
        ...(question.filedOn === undefined ? {} : { attributeId: question.filedOn.attributeId }),
        value: answers[question.key],
      },
    ];
  });
}

/**
 * Files a booking's answers onto the person it matched or made (AC-5712), through forms' record write
 * (`fileOntoRecord`), as the booking's own actor, in the caller's savepoint. Answers back what it kept, each filed one
 * marked `saved`; one the record refused is kept with `saved: false`, and the booking stands.
 */
export async function fileBookingAnswers(
  context: WriteContext,
  input: {
    readonly people: string;
    readonly personId: string;
    readonly questions: BookingQuestions;
    readonly answers: Readonly<Record<string, string | boolean | PhoneAnswer>>;
    readonly kept: readonly BookingAnswer[];
  },
): Promise<BookingAnswer[]> {
  if (!input.kept.some((answer) => answer.attributeId !== undefined)) return [...input.kept];
  const filed = await fileOntoRecord(context, {
    recordId: input.personId,
    // Fill only, whatever is stored (a page saved before the rule): a booking never overwrites a person's value.
    questions: input.questions.map((question) => ({ ...question, update: 'fill' as const })),
    attributes: await loadAttributes(context.tx, input.people),
    answers: input.answers,
  });
  const refused = new Set(filed.refused.map((each) => each.questionId));
  const planned = new Set(filed.planned);
  // Saved when it was planned onto a live attribute and the record took it (or already held it, `fill`).
  return input.kept.map((answer) =>
    answer.attributeId === undefined
      ? answer
      : { ...answer, saved: planned.has(answer.questionId) && !refused.has(answer.questionId) },
  );
}

/** The answer types a hand off's words fill as they are (a hosted form's prefill takes the same). */
const PREFILLED_AS_TEXT: ReadonlySet<string> = new Set(['short_text', 'long_text', 'email', 'website', 'number']);

/**
 * What a form's hand off means for a page's questions (spec 0057, AC-5713): the keys of the questions the form already
 * answered onto the same People attribute, which are not asked again, and the form's text answers to questions this
 * page asks by the same key, which start them filled in.
 */
export function handedOver(
  questions: BookingQuestions,
  handed: readonly {
    readonly key: string;
    readonly value: unknown;
    readonly filedOn?: { objectId: string; attributeId: string };
  }[],
  people: string | undefined,
): { readonly skip: readonly string[]; readonly answers: Readonly<Record<string, string>> } {
  const filed = new Set(
    handed.flatMap((each) =>
      each.filedOn !== undefined && each.filedOn.objectId === people ? [each.filedOn.attributeId] : [],
    ),
  );
  const skip = questions.flatMap((question) =>
    question.filedOn !== undefined && filed.has(question.filedOn.attributeId) ? [question.key] : [],
  );
  // Only words a question of this page takes as they are: text for a text question, one of its own choices for a
  // choice question. A phone, a tick or a country by the same key starts empty rather than holding the wrong shape.
  const asked = new Map(
    questions.filter((question) => !skip.includes(question.key)).map((question) => [question.key, question]),
  );
  const takes = (question: BookingQuestions[number], value: string) =>
    PREFILLED_AS_TEXT.has(question.answerType) ||
    ((question.answerType === 'dropdown' || question.answerType === 'choice') &&
      (question.choices ?? []).includes(value));
  const answers = Object.fromEntries(
    handed.flatMap((each) => {
      const question = asked.get(each.key);
      return question !== undefined &&
        typeof each.value === 'string' &&
        each.value.trim() !== '' &&
        takes(question, each.value)
        ? [[each.key, each.value]]
        : [];
    }),
  );
  return { skip, answers };
}

/**
 * Which of the bookings' stored answers the reader may see (AC-5714, hidden means absent): one filed on a field of
 * People hidden from them is left out, as a submission's is. Reads People's id only when some answer was filed.
 */
export async function shownAnswers(
  tx: WorkspaceTx,
  access: Access,
  stored: readonly unknown[],
): Promise<(stored: unknown) => BookingAnswer[]> {
  const filed = stored.some((each) => storedBookingAnswers(each).some((answer) => answer.attributeId !== undefined));
  const people = filed ? await peopleObjectId(tx) : undefined;
  return (each) =>
    storedBookingAnswers(each).filter(
      (answer) =>
        answer.attributeId === undefined ||
        (people !== undefined && fieldLevel(access, { id: answer.attributeId, objectId: people }) !== 'hidden'),
    );
}

/** An answer as words, for an email (AC-5714): text as typed, Yes or No, a phone's number; nothing for anything else. */
export function answerWords(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'number' in value && typeof value.number === 'string') {
    return value.number;
  }
  return '';
}

/** A booking's stored answers read back (`bookings.answers.questions`), each checked; anything else is left out. */
export function storedBookingAnswers(stored: unknown): BookingAnswer[] {
  if (typeof stored !== 'object' || stored === null || !('questions' in stored) || !Array.isArray(stored.questions)) {
    return [];
  }
  return stored.questions.flatMap((each: unknown) => {
    const parsed = BookingAnswer.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}
