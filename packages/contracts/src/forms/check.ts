// The one answer check (spec 0023, AC-553, AC-556, AC-660): the hosted page
// runs it on submit and on each change of a field with an error, and the
// submit endpoint runs it again on the published version, so a visitor sees
// the message the server would give. Plain TypeScript, no Zod and no I/O: the
// hosted page's bundle carries it. Answers are keyed by question key; anything
// else is dropped. Each answer comes back in its canonical shape: text for
// most types, `true` or `false` for the yes or no types, and a phone as its
// number in E.164 with the country it was dialled from.
import { choiceKeysOf, LONG_ANSWER_MAX, SHORT_ANSWER_MAX } from './answer-keys.ts';
import type { AnswerType } from './answer-types.ts';
import { countryOfE164, DIAL_CODES } from './dial-codes.ts';
import { walkPath, type FormLayout, type PathStep } from './path.ts';
import type { FormLanguage, PublicQuestion } from './public.ts';
import { matchesShowWhen } from './show-when.ts';
import { formStrings, type FormStrings } from './strings.ts';

/** What the check needs from a form: its questions and its language, and with Steps its steps (spec 0063). */
export interface CheckedForm {
  readonly language: FormLanguage;
  readonly layout?: FormLayout | undefined;
  readonly steps?: readonly PathStep[] | undefined;
  readonly questions: readonly Pick<
    PublicQuestion,
    'key' | 'answerType' | 'required' | 'choices' | 'choiceKeys' | 'showWhen' | 'options'
  >[];
}

/** A file answer as the page sends it: the id of an upload the server holds. */
export interface FileAnswer {
  readonly fileId: string;
}

/** A phone answer: the number in E.164 and the country whose code was picked. */
export interface PhoneAnswer {
  readonly number: string;
  readonly country: string;
}

/** A multi select's answer (spec 0063): the choices picked, by their words, and what Other's box says. */
export interface MultiAnswer {
  readonly picked: readonly string[];
  readonly other?: string;
}

/** An address's answer (spec 0063): each part as typed, the country as its two letter code. */
export interface AddressAnswer {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postcode?: string;
  readonly country?: string;
}

/** A date and time's answer (spec 0063): the moment in UTC, and the visitor's time zone it was given in. */
export interface DateTimeAnswer {
  readonly at: string;
  readonly timeZone: string;
}

/** A ranking's answer (spec 0063): every choice, by its words, in the visitor's order, first is most. */
export type RankingAnswer = readonly string[];

/** One answer in its canonical shape. */
export type CheckedAnswer =
  string | number | boolean | PhoneAnswer | FileAnswer | MultiAnswer | AddressAnswer | DateTimeAnswer | RankingAnswer;

/** The outcome: the answers in their canonical shapes, by key, or each failing question's message by key. */
export type AnswerCheck =
  | { readonly ok: true; readonly answers: Readonly<Record<string, CheckedAnswer>> }
  | { readonly ok: false; readonly fields: Readonly<Record<string, string>> };

/** The parts of an address answer, in the order they are read. */
export const ADDRESS_PARTS = ['line1', 'line2', 'city', 'region', 'postcode', 'country'] as const;

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{6,14}$/;

/** A web address as typed, made absolute: `acme.com` becomes `https://acme.com`. Undefined when it isn't one. */
export function websiteOf(text: string): string | undefined {
  const value = text.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const labels = url.hostname.split('.');
    if (labels.length < 2 || labels.some((label) => label === '')) return undefined;
    if (candidate.length > 2_048) return undefined;
    // A bare host reads back as typed, with no trailing slash.
    return url.pathname === '/' && url.search === '' && url.hash === '' ? url.href.slice(0, -1) : url.href;
  } catch {
    return undefined;
  }
}

/**
 * True for an answer that says nothing: absent, null, blank text, or a phone holding nothing, a lone "+" or only its
 * country's dial code.
 * A phone's digits after the code are an answer, however few, so a short number is refused as a number rather than
 * dropped as empty (QA Q82: "+112" with US was read as blank).
 */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every((each) => isBlank(each));
  if (typeof value === 'object') {
    // A file answer is held as the upload it names.
    if (typeof (value as { readonly fileId?: unknown }).fileId === 'string') return false;
    // A multi select: nothing picked and no Other ticked (an Other ticked with an empty box is an answer to refuse).
    if ('picked' in value) {
      const { picked, other } = value as { readonly picked?: unknown; readonly other?: unknown };
      return (Array.isArray(picked) ? picked.length === 0 : true) && typeof other !== 'string';
    }
    if ('at' in value) return isBlank((value as { readonly at?: unknown }).at);
    // An address: its parts (a phone, which also names a country, is read below by its number).
    // A country alone is no answer: the page guesses one before a word is typed.
    if (!('number' in value) && ADDRESS_PARTS.some((part) => part in value)) {
      return ADDRESS_PARTS.every(
        (part) => part === 'country' || isBlank((value as Readonly<Record<string, unknown>>)[part]),
      );
    }
    const { number, country } = value as { readonly number?: unknown; readonly country?: unknown };
    if (typeof number !== 'string') return true;
    const code = typeof country === 'string' ? DIAL_CODES.get(country) : undefined;
    if (code === undefined) return number.replace(/^\+\d{1,4}/, '').trim() === '';
    // Only nothing, a lone "+" or the code itself says nothing: letters such as "abc" are an answer, refused as a number.
    const typed = number.trim();
    return typed === '' || typed === '+' || number.replace(/\D/g, '') === code;
  }
  return false;
}

function text(value: unknown, max: number, words: FormStrings): { value?: string; error?: string } {
  if (typeof value !== 'string') return { error: words.required };
  const trimmed = value.trim();
  return trimmed.length > max ? { error: words.tooLong } : { value: trimmed };
}

/** True for a real calendar day written `YYYY-MM-DD`. */
function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.toISOString().slice(0, 10) === text;
}

/** A time zone's name the platform knows, or undefined. */
function zoneOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) {
    return undefined;
  }
  try {
    // Known to the platform; kept as the visitor's browser named it (Asia/Kolkata, not its older alias).
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return value;
  } catch {
    return undefined;
  }
}

/** A date and time: the moment (an ISO time with its offset) and the zone it was given in, UTC when none came. */
function dateTimeOf(raw: unknown, words: FormStrings): { value?: DateTimeAnswer; error?: string } {
  const given =
    typeof raw === 'string' ? { at: raw, timeZone: 'UTC' } : typeof raw === 'object' && raw !== null ? raw : {};
  const { at, timeZone } = given as { readonly at?: unknown; readonly timeZone?: unknown };
  // An offset is required: a moment with none would be read in the server's zone, not the visitor's.
  if (typeof at !== 'string' || at.length > 40 || !/(Z|[+-]\d{2}:\d{2})$/.test(at.trim()))
    return { error: words.datetime };
  const moment = Date.parse(at.trim());
  const zone = zoneOf(timeZone ?? 'UTC');
  if (!Number.isFinite(moment) || zone === undefined) return { error: words.datetime };
  return { value: { at: new Date(moment).toISOString(), timeZone: zone } };
}

/** A multi select: each pick one of the question's choices (by its words or its key), Other's words, the counts. */
function multiOf(
  raw: unknown,
  choices: readonly string[] | undefined,
  choiceKeys: readonly string[] | undefined,
  options: Partial<NonNullable<PublicQuestion['options']>>,
  words: FormStrings,
): { value?: MultiAnswer; error?: string } {
  const given =
    typeof raw === 'string' ? { picked: [raw] } : Array.isArray(raw) ? { picked: raw } : ((raw as object | null) ?? {});
  const { picked, other } = given as { readonly picked?: unknown; readonly other?: unknown };
  if (!Array.isArray(picked) || picked.length > FORM_PICKS_MAX) return { error: words.pickOption };
  const labels: string[] = [];
  for (const each of picked) {
    if (typeof each !== 'string') return { error: words.pickOption };
    const value = each.trim();
    const at = (choiceKeys ?? []).indexOf(value);
    const label = (choices ?? []).includes(value) ? value : at === -1 ? undefined : choices?.[at];
    if (label === undefined) return { error: words.pickOption };
    if (!labels.includes(label)) labels.push(label);
  }
  let said: string | undefined;
  if (typeof other === 'string' && options.other === true) {
    const typed = text(other, SHORT_ANSWER_MAX, words);
    if (typed.value === undefined) return { error: typed.error ?? words.tooLong };
    if (typed.value === '') return { error: words.otherMissing };
    said = typed.value;
  }
  const count = labels.length + (said === undefined ? 0 : 1);
  if (count === 0) return { error: words.pickOption };
  if (options.min !== undefined && count < options.min) return { error: words.pickAtLeast(options.min) };
  if (options.max !== undefined && count > options.max) return { error: words.pickAtMost(options.max) };
  return { value: { picked: labels, ...(said === undefined ? {} : { other: said }) } };
}

/** An address: each part as text, the country as a two letter code, at least the street or the city. */
function addressOf(raw: unknown, words: FormStrings): { value?: AddressAnswer; error?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: words.address };
  const parts: Record<string, string> = {};
  for (const part of ADDRESS_PARTS) {
    const value: unknown = (raw as Readonly<Record<string, unknown>>)[part];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.trim().length > SHORT_ANSWER_MAX) return { error: words.address };
    if (value.trim() !== '') parts[part] = value.trim();
  }
  if (parts.country !== undefined) {
    // A country a record's location takes too: one the dialling codes know.
    parts.country = parts.country.toUpperCase();
    if (!DIAL_CODES.has(parts.country)) return { error: words.country };
  }
  if (parts.line1 === undefined && parts.city === undefined) return { error: words.address };
  return { value: parts };
}

/** A ranking: every one of the question's choices once (each by its words or its key), in the visitor's order. */
function rankingOf(
  raw: unknown,
  choices: readonly string[] | undefined,
  choiceKeys: readonly string[] | undefined,
  words: FormStrings,
): { value?: RankingAnswer; error?: string } {
  const offered = (choices ?? []).filter((choice) => choice.trim() !== '');
  if (!Array.isArray(raw) || offered.length === 0 || raw.length !== offered.length) return { error: words.rankAll };
  const order: string[] = [];
  for (const each of raw) {
    if (typeof each !== 'string') return { error: words.rankAll };
    const value = each.trim();
    const at = (choiceKeys ?? []).indexOf(value);
    const label = offered.includes(value) ? value : at === -1 ? undefined : choices?.[at];
    // A blank choice's key names no choice the visitor was shown.
    if (label === undefined || !offered.includes(label) || order.includes(label)) return { error: words.rankAll };
    order.push(label);
  }
  return { value: order };
}

/** The upload a file or a signature names: its id, as the page holds it; the server swaps it for the stored file. */
function uploadOf(raw: unknown, error: string): { value?: FileAnswer; error?: string } {
  const id = typeof raw === 'object' && raw !== null ? (raw as { readonly fileId?: unknown }).fileId : raw;
  return typeof id === 'string' && UUID.test(id) ? { value: { fileId: id.toLowerCase() } } : { error };
}

/** The most choices a multi select answer may name. */
const FORM_PICKS_MAX = 40;

/** One answer, checked and made canonical; `error` when it can't be taken. */
function checkOne(
  answerType: AnswerType,
  choices: readonly string[] | undefined,
  choiceKeys: readonly string[] | undefined,
  raw: unknown,
  words: FormStrings,
  options: Partial<NonNullable<PublicQuestion['options']>> = {},
): { value?: CheckedAnswer; error?: string } {
  switch (answerType) {
    case 'date': {
      const day = typeof raw === 'string' ? raw.trim() : '';
      if (!isDay(day)) return { error: words.date };
      if (options.earliest !== undefined && day < options.earliest) return { error: words.dateFrom(options.earliest) };
      if (options.latest !== undefined && day > options.latest) return { error: words.dateUntil(options.latest) };
      return { value: day };
    }
    case 'time': {
      const match = typeof raw === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(raw.trim()) : null;
      const hours = Number(match?.[1]);
      const minutes = Number(match?.[2]);
      if (match === null || hours > 23 || minutes > 59) return { error: words.time };
      return { value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
    }
    case 'datetime':
      return dateTimeOf(raw, words);
    case 'rating':
    case 'scale': {
      const from = answerType === 'rating' ? 1 : (options.from ?? 0);
      const to = answerType === 'rating' ? 5 : (options.to ?? 10);
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      return Number.isInteger(value) && value >= from && value <= to ? { value } : { error: words.pickOption };
    }
    case 'multi_select':
      return multiOf(raw, choices, choiceKeys, options, words);
    case 'address':
      return addressOf(raw, words);
    case 'hidden':
      return text(typeof raw === 'number' ? String(raw) : raw, SHORT_ANSWER_MAX, words);
    case 'short_text':
      return typeof raw === 'string' && /[\r\n]/.test(raw.trim())
        ? { error: words.tooLong }
        : text(raw, SHORT_ANSWER_MAX, words);
    case 'long_text':
      return text(raw, LONG_ANSWER_MAX, words);
    case 'email': {
      const typed = text(raw, 254, words);
      if (typed.value === undefined) return typed;
      const email = typed.value.toLowerCase();
      return EMAIL.test(email) ? { value: email } : { error: words.email };
    }
    case 'website': {
      if (typeof raw !== 'string') return { error: words.website };
      const url = websiteOf(raw);
      return url === undefined ? { error: words.website } : { value: url };
    }
    case 'number': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: words.number };
      // A comma is a thousands separator only between groups of three digits (1,500); a lone comma is a decimal
      // mark as most of Europe writes it (1,5 is 1.5). Anything else ("1,2,3") is refused, never quietly changed
      // into another number (forms QA, 5 November 2026).
      const typed = String(raw).trim();
      const value = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(typed)
        ? typed.replaceAll(',', '')
        : /^[-+]?\d+,\d+$/.test(typed) && !/^[-+]?\d{1,3},\d{3}$/.test(typed)
          ? typed.replace(',', '.')
          : typed;
      return NUMBER.test(value) && value.length <= 40 ? { value } : { error: words.number };
    }
    case 'dropdown':
    case 'choice':
    case 'country': {
      if (typeof raw !== 'string') return { error: words.pickOption };
      const value = raw.trim();
      if (answerType === 'country')
        return value.length > 0 && value.length <= 100 ? { value } : { error: words.country };
      if ((choices ?? []).includes(value)) return { value };
      // A site's own form posts the choice's key: the answer is still the choice's words.
      const at = (choiceKeys ?? []).indexOf(value);
      const label = at === -1 ? undefined : choices?.[at];
      return label === undefined ? { error: words.pickOption } : { value: label };
    }
    case 'checkbox':
    case 'yes_no':
    case 'consent':
      return { value: raw === true || raw === 'yes' || raw === 'true' };
    case 'phone': {
      // A site's own form posts the number as typed: taken when it is international (+ and the code).
      if (typeof raw === 'string') {
        const compact = raw.replace(/[\s().-]/g, '');
        const country = E164.test(compact) ? countryOfE164(compact) : undefined;
        return country === undefined ? { error: words.phone } : { value: { number: compact, country } };
      }
      if (typeof raw !== 'object' || raw === null) return { error: words.phone };
      const { number, country } = raw as { readonly number?: unknown; readonly country?: unknown };
      if (typeof number !== 'string' || typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
        return { error: words.phone };
      }
      const compact = number.replace(/[\s().-]/g, '');
      return E164.test(compact) ? { value: { number: compact, country } } : { error: words.phone };
    }
    case 'file':
      return uploadOf(raw, words.fileInvalid);
    case 'signature':
      return uploadOf(raw, words.signatureMissing);
    case 'ranking':
      return rankingOf(raw, choices, choiceKeys, words);
  }
}

/**
 * Checks a visitor's answers against a form (AC-553): each question's answer
 * made canonical, required ones present (a required checkbox must be ticked;
 * a yes or no is always an answer), choices among the question's own. Answers
 * to anything but a question of the form are dropped, and so are answers to a
 * question its Show when hides (spec 0043, AC-1614).
 *
 * `absentNotAsked` is for a site's own form (late trap #55): its HTML was
 * copied once, so a question added since has no field there and its key never
 * comes. That question wasn't asked, so it is skipped as a hidden one is,
 * rather than refusing every visitor for a field they were never shown. A key
 * that comes empty was asked, and is held to the question as ever.
 *
 * `requireConsent` goes with it on a site's own form's submit (AC-1053): a
 * required consent is never taken as not asked, since an unticked box posts
 * nothing, so leaving it out is refused rather than filed as if agreed. A save
 * part way (a partial) leaves it off: an untouched consent there is simply not
 * answered yet.
 */
export function checkAnswers(
  form: CheckedForm,
  answers: Readonly<Record<string, unknown>>,
  options: { readonly absentNotAsked?: boolean; readonly requireConsent?: boolean } = {},
): AnswerCheck {
  const words = formStrings(form.language);
  const fields: Record<string, string> = {};
  const byKey = new Map(form.questions.map((question) => [question.key, question]));
  // In the form's order, step by step and jump by jump (spec 0063, AC-6313, AC-6314): `walkPath` owns the order, so
  // a step its Show when hides, a step a jump skipped and an ending left behind all take their questions off the
  // path here exactly as on the page, and those answers are never required and never kept.
  const checkQuestion = (
    question: (typeof form.questions)[number],
    values: Readonly<Record<string, CheckedAnswer>>,
  ): Readonly<Record<string, CheckedAnswer>> | undefined => {
    // A question whose Show when doesn't hold over the answers kept so far is skipped: never required, never kept.
    if (!matchesShowWhen(question.showWhen, values)) return undefined;
    // On a site's own form's submit a required consent is never taken as not asked: left out (an unticked box posts
    // nothing, and so does HTML copied before it was added), it is refused, never filed as if agreed (AC-1053).
    const consentRequired = options.requireConsent === true && question.answerType === 'consent' && question.required;
    if (options.absentNotAsked === true && !consentRequired && !Object.hasOwn(answers, question.key)) return undefined;
    const given = Object.hasOwn(answers, question.key) ? answers[question.key] : undefined;
    // A hidden question takes the link's value, else its default (AC-6309), and is never refused for being empty:
    // a visitor can't see it to answer it.
    const raw = question.answerType === 'hidden' && isBlank(given) ? question.options?.default : given;
    if (question.answerType === 'hidden' && isBlank(raw)) return undefined;
    if (question.answerType === 'checkbox' || question.answerType === 'yes_no' || question.answerType === 'consent') {
      const ticked = raw === true || raw === 'yes' || raw === 'true';
      // A required consent blocks the submit until it is ticked, as a required checkbox does (AC-1053).
      if (question.answerType !== 'yes_no' && question.required && !ticked) {
        fields[question.key] = words.requiredCheckbox;
        return undefined;
      }
      return { ...values, [question.key]: ticked };
    }
    if (isBlank(raw)) {
      if (question.required) fields[question.key] = words.required;
      return undefined;
    }
    const checked = checkOne(
      question.answerType,
      question.choices,
      choiceKeysOf(question),
      raw,
      words,
      question.options ?? {},
    );
    if (checked.error !== undefined) {
      fields[question.key] = checked.error;
      return undefined;
    }
    return checked.value === undefined ? undefined : { ...values, [question.key]: checked.value };
  };
  // The answers kept are the facts the walk gathered: one question's canonical answer is what the next one's Show
  // when, the next step's and the next jump's all read, here and on the page alike.
  let values: Readonly<Record<string, CheckedAnswer>> = {};
  walkPath(form, (key) => {
    const question = byKey.get(key);
    const next = question === undefined ? undefined : checkQuestion(question, values);
    if (next === undefined) return { shown: false, seen: values };
    values = next;
    return { shown: true, seen: next };
  });
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, answers: values };
}
