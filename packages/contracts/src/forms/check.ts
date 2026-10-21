// The one answer check (spec 0023, AC-553, AC-556, AC-660): the hosted page
// runs it on submit and on each change of a field with an error, and the
// submit endpoint runs it again on the published version, so a visitor sees
// the message the server would give. Plain TypeScript, no Zod and no I/O: the
// hosted page's bundle carries it. Answers are keyed by question key; anything
// else is dropped. Each answer comes back in its canonical shape: text for
// most types, `true` or `false` for the yes or no types, and a phone as its
// number in E.164 with the country it was dialled from.
import { choiceKeysOf, LONG_ANSWER_MAX, SHORT_ANSWER_MAX, type AnswerType } from './answer-types.ts';
import { countryOfE164 } from './dial-codes.ts';
import type { FormLanguage, PublicQuestion } from './public.ts';
import { formStrings, type FormStrings } from './strings.ts';

/** What the check needs from a form: its questions and its language. */
export interface CheckedForm {
  readonly language: FormLanguage;
  readonly questions: readonly Pick<PublicQuestion, 'key' | 'answerType' | 'required' | 'choices' | 'choiceKeys'>[];
}

/** A phone answer: the number in E.164 and the country whose code was picked. */
export interface PhoneAnswer {
  readonly number: string;
  readonly country: string;
}

/** The outcome: the answers in their canonical shapes, by key, or each failing question's message by key. */
export type AnswerCheck =
  | { readonly ok: true; readonly answers: Readonly<Record<string, string | boolean | PhoneAnswer>> }
  | { readonly ok: false; readonly fields: Readonly<Record<string, string>> };

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
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

/** True for an answer that says nothing: absent, null, blank text. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') {
    const number = (value as { readonly number?: unknown }).number;
    return typeof number !== 'string' || number.replace(/^\+\d{1,4}/, '').trim() === '';
  }
  return false;
}

function text(value: unknown, max: number, words: FormStrings): { value?: string; error?: string } {
  if (typeof value !== 'string') return { error: words.required };
  const trimmed = value.trim();
  return trimmed.length > max ? { error: words.tooLong } : { value: trimmed };
}

/** One answer, checked and made canonical; `error` when it can't be taken. */
function checkOne(
  answerType: AnswerType,
  choices: readonly string[] | undefined,
  choiceKeys: readonly string[] | undefined,
  raw: unknown,
  words: FormStrings,
): { value?: string | boolean | PhoneAnswer; error?: string } {
  switch (answerType) {
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
      const value = String(raw).trim().replaceAll(',', '');
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
      return { error: words.fileLater };
  }
}

/**
 * Checks a visitor's answers against a form (AC-553): each question's answer
 * made canonical, required ones present (a required checkbox must be ticked;
 * a yes or no is always an answer), choices among the question's own. Answers
 * to anything but a question of the form are dropped.
 */
export function checkAnswers(form: CheckedForm, answers: Readonly<Record<string, unknown>>): AnswerCheck {
  const words = formStrings(form.language);
  const values: Record<string, string | boolean | PhoneAnswer> = {};
  const fields: Record<string, string> = {};
  for (const question of form.questions) {
    const raw = Object.hasOwn(answers, question.key) ? answers[question.key] : undefined;
    if (question.answerType === 'checkbox' || question.answerType === 'yes_no') {
      const ticked = raw === true || raw === 'yes' || raw === 'true';
      if (question.answerType === 'checkbox' && question.required && !ticked)
        fields[question.key] = words.requiredCheckbox;
      else values[question.key] = ticked;
      continue;
    }
    if (isBlank(raw)) {
      if (question.required) fields[question.key] = words.required;
      continue;
    }
    const checked = checkOne(question.answerType, question.choices, choiceKeysOf(question), raw, words);
    if (checked.error !== undefined) fields[question.key] = checked.error;
    else if (checked.value !== undefined) values[question.key] = checked.value;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, answers: values };
}
