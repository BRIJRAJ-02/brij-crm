// The answer types a form question takes (spec 0023, 0023-experience.md), as
// plain lists with no Zod, so the hosted page, the builder and the server
// share them. Every type yields exactly one value: that is the test for any
// new one. Each files onto the attribute types listed in `FILES_ONTO`.
import type { AttributeType } from '../values/attribute-values.ts';

// What the hosted page itself needs lives in `answer-keys.ts` (spec 0063, AC-6331): a module the page and the
// builder share ships whole in the page's first load, so the builder's lists and words stay here.
export * from './answer-keys.ts';

/** Every answer type, in the order the builder lists them. */
export const ANSWER_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'website',
  'number',
  'dropdown',
  'choice',
  'checkbox',
  'yes_no',
  'country',
  'file',
  // Spec 0063, batch one (AC-6307).
  'date',
  'time',
  'datetime',
  'rating',
  'scale',
  'multi_select',
  'address',
  'hidden',
] as const;
/** One answer type. */
export type AnswerType = (typeof ANSWER_TYPES)[number];

/** The types answered by picking from the question's own choices. */
export const CHOICE_TYPES: readonly AnswerType[] = ['dropdown', 'choice', 'multi_select'];

/**
 * The types a booking page's questions may take (spec 0063, AC-6311): those it had before the new types arrived,
 * which only the form builder offers until a later spec opens them to booking pages.
 */
export const BOOKING_ANSWER_TYPES: readonly AnswerType[] = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'website',
  'number',
  'dropdown',
  'choice',
  'checkbox',
  'yes_no',
  'country',
  'file',
];

/** The types answered yes or no (a boolean). */
export const BOOLEAN_TYPES: readonly AnswerType[] = ['checkbox', 'yes_no'];

/** The types that take no placeholder: their control shows no empty box to hint inside. */
export const NO_PLACEHOLDER_TYPES: readonly AnswerType[] = [
  'dropdown',
  'choice',
  'checkbox',
  'yes_no',
  'country',
  'file',
  'date',
  'time',
  'datetime',
  'rating',
  'scale',
  'multi_select',
  'address',
  'hidden',
];

/** The attribute types each answer type may be filed onto (spec 0023, Answer types). */
export const FILES_ONTO: Readonly<Record<AnswerType, readonly AttributeType[]>> = {
  // A name answer files onto a person's name too, split into first and last.
  short_text: ['text', 'personal_name'],
  long_text: ['text', 'long_text'],
  email: ['email'],
  phone: ['phone'],
  website: ['url', 'domain'],
  number: ['number'],
  dropdown: ['select', 'status'],
  choice: ['select', 'status'],
  checkbox: ['checkbox'],
  yes_no: ['checkbox'],
  country: ['text', 'select'],
  file: ['file'],
  date: ['date'],
  // A time of day as `HH:MM`: no attribute holds one, so it files as text.
  time: ['text'],
  // In the visitor's time zone, which stays with the answer on the submission.
  datetime: ['timestamp'],
  rating: ['rating', 'number'],
  scale: ['number'],
  // The several choices picked; what Other's box says stays on the submission (AC-6310).
  multi_select: ['select'],
  address: ['location'],
  hidden: ['text', 'select', 'number'],
};

/** Whether an answer of `answerType` may be filed onto an attribute of `attributeType` (AC-658). */
export function fitsAttribute(answerType: AnswerType, attributeType: AttributeType): boolean {
  return FILES_ONTO[answerType].includes(attributeType);
}

/** True when `value` is one of the answer types. */
export function isAnswerType(value: unknown): value is AnswerType {
  return typeof value === 'string' && (ANSWER_TYPES as readonly string[]).includes(value);
}

/** The most questions one form holds. */
export const FORM_QUESTIONS_MAX = 50;

/** The most choices one choice question holds. */
export const FORM_CHOICES_MAX = 40;

/** The least time from the page loading to a submit, below which it is spam. */
export const MIN_FILL_MS = 2_000;

/** A form's public address: 2 to 40 lowercase letters, numbers or hyphens, not starting or ending with one. */
export const FORM_SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/** A question's key: lowercase, snake case, 1 to 40, starting with a letter (an input name, a JSON key). */
export const QUESTION_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** The address a new form gets: `form-` and six random letters or digits. */
export function generatedSlug(random: (bytes: number) => Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `form-${[...random(6)].map((byte) => alphabet[byte % alphabet.length] ?? 'a').join('')}`;
}

/** An address suggested from a name: lowercased, words joined by hyphens, cut to 40. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** A question key made from a label: `What is your budget?` gives `what_is_your_budget`. */
export function keyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return /^[a-z]/.test(key) ? key : `q_${key}`.slice(0, 40).replace(/_+$/g, '') || 'question';
}
