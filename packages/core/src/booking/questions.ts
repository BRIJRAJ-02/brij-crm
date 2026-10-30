// A booking page's own questions (spec 0057): where their answers may be filed, the check a save runs, the answers
// a booking keeps, and their filing onto a record of the page's object. Everything about a question comes from
// forms (spec 0023): the schema, the answer check, the public shape, the match and the record write; this file only
// says which object the page files onto and keeps a booking's answers with the labels they had (AC-5711).
//
// Spec 0057 pinned every page to People. A page now names its own object (booking answers parity, 27 October 2026):
// null is People, which is what every page did before, and a page pointed elsewhere files onto a record of that
// object found or made by the visitor's email, the way a form does it. The booking still matches or makes the
// visitor's Person either way; only where the answers land moves.
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
import { ANONYMOUS, isUnfillableRequired } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { fieldLevel, objectLevel, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';
import { encodeValue } from '../engine/columns.ts';
import { parseAttributeInput } from '../engine/parse-value.ts';
import type { EngineScope } from '../engine/scope.ts';
import { refuseOn } from '../engine/refusals.ts';
import { uniqueKeyOf } from '../engine/unique.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { requiredFilings } from '../forms/dependencies.ts';
import { targetChoices } from '../forms/forms.ts';
import { fileOntoRecord, matchedRecord, optionsFor, plan } from '../forms/process.ts';
import { fileable, publicQuestionOf, publishAttributes } from '../forms/shared.ts';
import { insertWithAnswers } from './visitor.ts';

const { objects } = schema;

/** The workspace's People object, live, or undefined: the object a page files answers onto unless it names another. */
export async function peopleObjectId(tx: WorkspaceTx): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(sql`${objects.standardKey} = 'people'`, isNull(objects.archivedAt)));
  return row?.id;
}

/**
 * The object a page's answers are filed onto: the one it names, else the workspace's People (null means People, so
 * every page made before this setting behaves exactly as it did). Undefined when neither is there.
 */
export async function answersObjectOf(tx: WorkspaceTx, named: string | null | undefined): Promise<string | undefined> {
  return named ?? (await peopleObjectId(tx));
}

/** The api slug of the person's email, which the booking writes itself: no question files onto it (AC-5703). */
const VISITOR_EMAIL_SLUG = 'email_addresses';

/** What a save refuses a question set to overwrite with: a booking page only fills an empty value. */
const ONLY_FILL = 'A booking page only fills empty fields: anyone can type an email, so it never overwrites one.';

/** What a save refuses a question's filing with, naming nothing about the attribute it asked for. */
const NOT_FILEABLE = 'A question can only be filed onto a field of the page’s object that you can change.';

/**
 * The attribute a page matches the visitor on, as a form matches its record (`matchOf`): the object's first unique
 * email. Only an email can find a visitor by what they typed, so an object without one is refused on save.
 */
export function visitorMatchOf(attributes: ReadonlyMap<string, AttributeDef>): AttributeDef | undefined {
  return fileable(attributes).find((attribute) => attribute.isUnique && attribute.type === 'email');
}

/** What choosing an object a visitor can't be matched on refuses with: plain, and it says what is missing. */
export const NO_VISITOR_EMAIL =
  'This object has no unique email field, so a booking can’t find or make the visitor’s record in it. Add one first.';

/**
 * The attributes a booking writes on the record it makes, whatever the page asks: the unique email it matches the
 * visitor on, and the object's name attribute where `nameValueFor` fills one (a text or a personal name).
 */
async function bookingFills(
  tx: WorkspaceTx,
  objectId: string,
  attributes: ReadonlyMap<string, AttributeDef>,
): Promise<ReadonlySet<string>> {
  const match = visitorMatchOf(attributes);
  const [row] = await tx
    .select({ primary: objects.primaryAttributeId })
    .from(objects)
    .where(sql`${objects.id} = ${objectId}::uuid`);
  const primary = row?.primary === null || row?.primary === undefined ? undefined : attributes.get(row.primary);
  // `nameValueFor` fills a text or a personal name and nothing else, so only those count as written.
  const named =
    primary === undefined || (primary.type !== 'text' && primary.type !== 'personal_name') ? undefined : primary.id;
  return new Set([match?.id, named].filter((id): id is string => id !== undefined));
}

/**
 * The required fields of `objectId` a booking could never fill on a record it makes: not written by the booking
 * itself, with no default a guest gets, and not asked of every guest by a required question filed on them
 * (`requiredFilings`: an optional question can be skipped, so it fills nothing for sure).
 */
async function wallsOn(
  tx: WorkspaceTx,
  objectId: string,
  questions: BookingQuestions,
): Promise<readonly AttributeDef[]> {
  const attributes = await loadAttributes(tx, objectId);
  // The booking fills these two itself, whatever the questions are: the email it matches on, and the object's
  // name, where it takes one (`answersRecord`). Required on them is no wall.
  const written = await bookingFills(tx, objectId, attributes);
  // The record is made with these answers (`requiredAnswerValues`), so they are no wall either.
  const asked = requiredFilings(questions);
  // A guest is nobody: a Current user default fills nothing for them, as `ANONYMOUS` says.
  return fileable(attributes).filter(
    (attribute) => !written.has(attribute.id) && !asked.has(attribute.id) && isUnfillableRequired(attribute, ANONYMOUS),
  );
}

/** The refusal for `walls`: each named when the saver may see it, counted generically when not (spec 0009, AC-144). */
function wallMessage(access: Access, walls: readonly AttributeDef[]): string {
  const named = walls.filter((attribute) => attributeVisible(access, attribute)).map((attribute) => attribute.title);
  const hidden = walls.length - named.length;
  const subjects = [
    ...named,
    ...(hidden === 0 ? [] : [hidden === 1 ? 'one field you can’t see' : `${String(hidden)} fields you can’t see`]),
  ];
  const one = subjects.length === 1;
  const subject = one
    ? (subjects[0] ?? '')
    : `${subjects.slice(0, -1).join(', ')} and ${subjects[subjects.length - 1] ?? ''}`;
  const fix =
    named.length === 0
      ? `Ask a workspace admin to give ${one ? 'it a default' : 'them defaults'} or make ${one ? 'it' : 'them'} optional.`
      : `Give ${one ? 'it a default' : 'them defaults'}, ask for ${one ? 'it' : 'them'} with a required question, or make ${one ? 'it' : 'them'} optional.`;
  return `${subject} ${one ? 'is' : 'are'} required there, and nothing fills ${one ? 'it' : 'them'}, so a booking could never make the record. ${fix}`;
}

/**
 * Why a booking page can't file answers onto this object: one of its fields is required and nothing fills it, so
 * the guest's record could never be made (27 October 2026, the same wall a form's publish refuses). A field the
 * page's `questions` ask every guest for with a required question is filled. Named when the saver may see the
 * field, counted generically when not (spec 0009, AC-144). Undefined when the object is fine.
 */
export async function requiredWall(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  questions: BookingQuestions = [],
): Promise<string | undefined> {
  const walls = await wallsOn(tx, objectId, questions);
  return walls.length === 0 ? undefined : wallMessage(access, walls);
}

/**
 * Checks the object a page files its answers onto, as a form's publish checks its target: it has to be live here
 * (row level security keeps another workspace's away), and it has to carry a unique email attribute, since the
 * visitor's email is all a booking knows them by. Refused `CONFIG_INVALID` on `answersObjectId`, so the choice is
 * refused when it is made rather than silently failing at booking time. People passes: it owns a unique email.
 * `questions` are the page's as they will be filed there: a required one fills its field.
 */
export async function checkAnswersObject(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  questions: BookingQuestions = [],
): Promise<void> {
  const [row] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(sql`${objects.id} = ${objectId}::uuid`, isNull(objects.archivedAt)));
  if (row === undefined || objectLevel(scope.access, objectId) !== 'write') {
    throw refuseOn('CONFIG_INVALID', 'Pick an object you can change.', 'answersObjectId');
  }
  if (visitorMatchOf(await loadAttributes(tx, objectId)) === undefined) {
    throw refuseOn('CONFIG_INVALID', NO_VISITOR_EMAIL, 'answersObjectId');
  }
  const wall = await requiredWall(tx, scope.access, objectId, questions);
  if (wall !== undefined) throw refuseOn('CONFIG_INVALID', wall, 'answersObjectId');
}

/**
 * Refuses a page going live onto an object whose record a booking could never make (27 October 2026). Only a page
 * that files answers somewhere is checked: one with no filed question writes nothing there, so nothing can fail.
 * A required field one of its required questions files on is filled. Refused on `status`, the switch the writer
 * just flicked.
 */
export async function checkPageCanGoLive(
  tx: WorkspaceTx,
  scope: EngineScope,
  questions: BookingQuestions,
  named: string | null,
): Promise<void> {
  if (named === null && !questions.some((question) => question.filedOn !== undefined)) return;
  const target = await answersObjectOf(tx, named);
  if (target === undefined) return;
  const wall = await requiredWall(tx, scope.access, target, questions);
  if (wall !== undefined) throw refuseOn('CONFIG_INVALID', wall, 'status');
}

/**
 * Refuses a live page's question edit that would open a wall it didn't have: a required field it filled through a
 * required question, now made optional, given a Show when, filed elsewhere or removed. Settings let the field turn
 * Required because the page asked for it (`livePagesWalledBy`), so dropping the question would quietly leave every
 * new guest out of the CRM. A wall the page already had stays its own business, so an unrelated edit still saves.
 * Refused on `questions`.
 */
export async function checkNoNewWall(
  tx: WorkspaceTx,
  scope: EngineScope,
  before: BookingQuestions,
  after: BookingQuestions,
  named: string | null,
): Promise<void> {
  const target = await answersObjectOf(tx, named);
  if (target === undefined) return;
  const had = new Set((await wallsOn(tx, target, before)).map((attribute) => attribute.id));
  const opened = (await wallsOn(tx, target, after)).filter((attribute) => !had.has(attribute.id));
  if (opened.length > 0) throw refuseOn('CONFIG_INVALID', wallMessage(scope.access, opened), 'questions');
}

/** The attributes a question may never be filed onto: the one the visitor is matched on, and People's own email. */
async function writtenByTheBooking(tx: WorkspaceTx, objectId: string): Promise<ReadonlySet<string>> {
  const attributes = await loadAttributes(tx, objectId);
  const match = visitorMatchOf(attributes);
  const slugged = [...attributes.values()].find((each) => each.apiSlug === VISITOR_EMAIL_SLUG);
  return new Set([match?.id, slugged?.id].filter((id): id is string => id !== undefined));
}

/**
 * Checks a page's questions as a save sends them (AC-5706, AC-5717): each one as a form's publish checks it
 * (`questionsProblem`: a label, choices for a choice question, a Show when that reads only earlier questions), and
 * each filing that changed since `before` onto a live, non system attribute of the page's object that fits its
 * answer type and that the writer may write, never the attribute the booking writes itself (AC-5703). A filing the
 * page already had stays as it is, so a writer who can't write that field (an admin on a teammate's page) still
 * saves their other changes. Anything else, another object's attribute or another workspace's id included, is
 * refused as `CONFIG_INVALID` on `questions`; a filing refusal says nothing of what the id names.
 */
export async function checkPageQuestions(
  tx: WorkspaceTx,
  scope: EngineScope,
  questions: BookingQuestions,
  before: BookingQuestions = [],
  named: string | null = null,
): Promise<void> {
  // A booking page only fills an empty value (owner, 26 Oct 2026): the visitor's email is unverified, so a booking
  // never overwrites what a record already holds.
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
  const target = questions.some((question) => question.filedOn !== undefined)
    ? await answersObjectOf(tx, named)
    : undefined;
  if (changed.length > 0 && (target === undefined || objectLevel(scope.access, target) !== 'write')) {
    throw refuseOn('CONFIG_INVALID', NOT_FILEABLE, 'questions');
  }
  // Only the target's own attributes are loaded, under row level security: an id of another object or workspace is absent.
  const attributes: ReadonlyMap<string, PublishAttribute> =
    target === undefined ? new Map() : await publishAttributes(tx, scope.access, target);
  const byTheBooking = target === undefined ? new Set<string>() : await writtenByTheBooking(tx, target);
  for (const question of changed) {
    const attribute = question.filedOn === undefined ? undefined : attributes.get(question.filedOn.attributeId);
    if (
      attribute === undefined ||
      byTheBooking.has(attribute.id) ||
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
 * A reader's view of a page's questions (hidden means absent): a filing onto a field of the page's object hidden
 * from them loses its `filedOn`, so its attribute's id never reaches them. The object is read once, before any page
 * is shown; a list of pages that file onto different objects reads each one it meets.
 */
export async function questionsSeenBy(
  tx: WorkspaceTx,
  access: Access,
): Promise<(questions: BookingQuestions, named?: string | null) => BookingQuestions> {
  const people = await peopleObjectId(tx);
  return (questions, named) => {
    const target = named ?? people;
    return questions.map((question) => {
      if (question.filedOn === undefined) return question;
      const isHidden =
        target === undefined || fieldLevel(access, { id: question.filedOn.attributeId, objectId: target }) === 'hidden';
      if (!isHidden) return question;
      const { filedOn: _hidden, ...rest } = question;
      return rest;
    });
  };
}

/**
 * A save's questions with the filings its writer can't see put back (hidden means absent, and never erased): a
 * question they received without `filedOn` because its field is hidden from them keeps the filing it had.
 */
export function withHiddenFilings(
  before: BookingQuestions,
  incoming: BookingQuestions,
  shownBefore: BookingQuestions,
): BookingQuestions {
  const shown = new Map(shownBefore.map((question) => [question.id, question]));
  const had = new Map(before.map((question) => [question.id, question]));
  return incoming.map((question) => {
    const previous = had.get(question.id);
    if (question.filedOn !== undefined || previous?.filedOn === undefined) return question;
    // Hidden from this writer: they never saw the filing, so leaving it out isn't taking it off.
    return shown.get(question.id)?.filedOn === undefined ? { ...question, filedOn: previous.filedOn } : question;
  });
}

/**
 * The questions a page keeps when it is pointed at another object, as a form's `setFormTarget` keeps them: a filing
 * onto an attribute the new object also has stays, every other filing is cleared, since an attribute id belongs to
 * one object. The questions themselves are never lost, only where their answers would go.
 */
export function refiledOnto(questions: BookingQuestions, attributeIds: ReadonlySet<string>): BookingQuestions {
  return questions.map((question) => {
    if (question.filedOn === undefined || attributeIds.has(question.filedOn.attributeId)) return question;
    const { filedOn: _cleared, ...rest } = question;
    return rest;
  });
}

/** The ids of the attributes the page's object has, for keeping the filings that survive a move to it. */
export async function attributeIdsOf(tx: WorkspaceTx, named: string | null): Promise<ReadonlySet<string>> {
  const target = await answersObjectOf(tx, named);
  return target === undefined ? new Set<string>() : new Set((await loadAttributes(tx, target)).keys());
}

/**
 * Where a page's answers may be filed (AC-5706): the page's object and its attributes as a form's Where it goes
 * lists them, the one the booking writes itself left out (AC-5703). Empty when the workspace has no object for it.
 */
export async function questionTargets(
  tx: WorkspaceTx,
  scope: EngineScope,
  named: string | null = null,
): Promise<FormTargetChoices> {
  const target = await answersObjectOf(tx, named);
  if (target === undefined) return { items: [] };
  const choices = await targetChoices(tx, scope, target);
  const byTheBooking = await writtenByTheBooking(tx, target);
  return { ...choices, items: choices.items.filter((item) => !byTheBooking.has(item.attributeId)) };
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
 * question's key, label and type as they are now, so a later rename never changes what they answered. A filed one
 * names its attribute and the object it belongs to, so a later read knows whose field it is without the page.
 */
export function bookingAnswersOf(
  questions: BookingQuestions,
  answers: Readonly<Record<string, string | boolean | PhoneAnswer>>,
  objectId?: string,
): BookingAnswer[] {
  return questions.flatMap((question): BookingAnswer[] => {
    if (!Object.hasOwn(answers, question.key)) return [];
    return [
      {
        questionId: question.id,
        key: question.key,
        label: question.label,
        answerType: question.answerType,
        ...(question.filedOn === undefined
          ? {}
          : {
              attributeId: question.filedOn.attributeId,
              ...(objectId === undefined ? {} : { objectId }),
            }),
        value: answers[question.key],
      },
    ];
  });
}

/**
 * The values a record of `objectId` made now takes from the visitor's answers: the planned answer (`plan`, exactly
 * as `fileBookingAnswers` files it) of each required field a question is filed on, so a required field the page asks
 * for never stops the record being made (late trap #11's real fix, 30 October 2026). Only required ones: an optional
 * answer waits for the fill after it, where a value the record refuses only marks itself not saved and never costs
 * the guest their record. Attribute ids to values, as `insertRecord` takes them; empty when nothing is filed.
 */
export async function requiredAnswerValues(
  tx: WorkspaceTx,
  input: {
    readonly objectId: string;
    readonly questions: BookingQuestions;
    readonly answers: Readonly<Record<string, string | boolean | PhoneAnswer>>;
  },
): Promise<Readonly<Record<string, unknown>>> {
  if (
    !input.questions.some((question) => question.filedOn !== undefined && Object.hasOwn(input.answers, question.key))
  ) {
    return {};
  }
  const attributes = await loadAttributes(tx, input.objectId);
  // Fill only, as the filing after it: a made record holds nothing yet, so this changes only what `plan` reads.
  const document = { questions: input.questions.map((question) => ({ ...question, update: 'fill' as const })) };
  const options = await optionsFor(tx, document, attributes);
  const { planned } = plan(document, attributes, options, input.answers);
  return Object.fromEntries(
    planned.filter((each) => each.attribute.isRequired).map((each) => [each.attribute.id, each.value]),
  );
}

/**
 * The record a booking's answers are filed onto, in the caller's savepoint: the live record of `objectId` holding
 * the visitor's email on its unique email attribute, else one made now with that email (and the object's primary
 * text or name attribute, where it takes what the visitor typed) and the `answers` its required fields take
 * (`requiredAnswerValues`; a found record is never written here). An advisory lock on the match key first, so two
 * bookings by one new visitor make one record, as a form's filing does. Undefined when the object has no unique
 * email to match on, which a save refuses, or the email isn't one that attribute takes.
 */
export async function answersRecord(
  context: WriteContext,
  input: {
    readonly objectId: string;
    readonly email: string;
    readonly name: string;
    readonly timeZone: string;
    readonly answers?: Readonly<Record<string, unknown>>;
  },
): Promise<string | undefined> {
  const { tx } = context;
  const attributes = await loadAttributes(tx, input.objectId);
  const match = visitorMatchOf(attributes);
  if (match === undefined) return undefined;
  const parsed = parseAttributeInput(match, match.isMulti ? [input.email] : input.email);
  if (!parsed.ok || parsed.value === null) return undefined;
  const [first] = encodeValue(match.type, parsed.value);
  const key = first === undefined ? null : uniqueKeyOf(match.type, first);
  if (key === null) return undefined;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`booking-answers:${input.objectId}:${match.id}:${key}`}, 0))`,
  );
  const found = await matchedRecord(tx, input.objectId, match.id, key);
  if (found !== undefined) return found;
  const [row] = await tx
    .select({ primary: objects.primaryAttributeId })
    .from(objects)
    .where(sql`${objects.id} = ${input.objectId}::uuid`);
  const primary = row?.primary === null || row?.primary === undefined ? undefined : attributes.get(row.primary);
  const named =
    primary === undefined || primary.id === match.id || input.name.trim() === ''
      ? undefined
      : nameValueFor(primary, input.name);
  // The booking's own values win over an answer filed on the same field.
  const made = await insertWithAnswers(context, {
    objectId: input.objectId,
    answers: input.answers ?? {},
    values: { [match.id]: parsed.value, ...named },
    timeZone: input.timeZone,
  });
  return made.recordId;
}

/** The visitor's name as the object's primary attribute takes it: text as typed, a personal name split in two. */
function nameValueFor(primary: AttributeDef, name: string): Readonly<Record<string, unknown>> | undefined {
  const words = name.trim().split(/\s+/);
  if (primary.type === 'text') return { [primary.id]: primary.isMulti ? [name.trim()] : name.trim() };
  if (primary.type !== 'personal_name') return undefined;
  const last = words.length > 1 ? words.at(-1) : undefined;
  return {
    [primary.id]: {
      firstName: words.slice(0, words.length > 1 ? -1 : undefined).join(' '),
      ...(last === undefined ? {} : { lastName: last }),
      fullName: name.trim(),
    },
  };
}

/**
 * Files a booking's answers onto the record it matched or made (AC-5712), through forms' record write
 * (`fileOntoRecord`), as the booking's own actor, in the caller's savepoint. Answers back what it kept, each filed
 * one marked `saved`; one the record refused is kept with `saved: false`, and the booking stands.
 */
export async function fileBookingAnswers(
  context: WriteContext,
  input: {
    readonly objectId: string;
    readonly recordId: string;
    readonly questions: BookingQuestions;
    readonly answers: Readonly<Record<string, string | boolean | PhoneAnswer>>;
    readonly kept: readonly BookingAnswer[];
  },
): Promise<BookingAnswer[]> {
  if (!input.kept.some((answer) => answer.attributeId !== undefined)) return [...input.kept];
  const filed = await fileOntoRecord(context, {
    recordId: input.recordId,
    // Fill only, whatever is stored (a page saved before the rule): a booking never overwrites a record's value.
    questions: input.questions.map((question) => ({ ...question, update: 'fill' as const })),
    attributes: await loadAttributes(context.tx, input.objectId),
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
 * What a form's hand off means for a page's questions (spec 0057, AC-5713): the keys of the questions the form
 * already answered onto the same attribute of the page's own object, which are not asked again, and the form's text
 * answers to questions this page asks by the same key, which start them filled in.
 */
export function handedOver(
  questions: BookingQuestions,
  handed: readonly {
    readonly key: string;
    readonly value: unknown;
    readonly filedOn?: { objectId: string; attributeId: string };
  }[],
  objectId: string | undefined,
): { readonly skip: readonly string[]; readonly answers: Readonly<Record<string, string>> } {
  const filed = new Set(
    handed.flatMap((each) =>
      each.filedOn !== undefined && each.filedOn.objectId === objectId ? [each.filedOn.attributeId] : [],
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
 * Which of the bookings' stored answers the reader may see (AC-5714, hidden means absent): one filed on a field
 * hidden from them is left out, as a submission's is. An answer names its own object (one stored before that did
 * is People's, which is where every page filed then), so this never reads the pages back. People's id is read only
 * when some answer was filed without one.
 */
export async function shownAnswers(
  tx: WorkspaceTx,
  access: Access,
  stored: readonly unknown[],
): Promise<(stored: unknown) => BookingAnswer[]> {
  const filed = stored.flatMap((each) =>
    storedBookingAnswers(each).filter((answer) => answer.attributeId !== undefined),
  );
  const people = filed.some((answer) => answer.objectId === undefined) ? await peopleObjectId(tx) : undefined;
  return (each) =>
    storedBookingAnswers(each).filter((answer) => {
      if (answer.attributeId === undefined) return true;
      const objectId = answer.objectId ?? people;
      return objectId !== undefined && fieldLevel(access, { id: answer.attributeId, objectId }) !== 'hidden';
    });
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
