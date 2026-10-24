// The answer types a form question takes (spec 0023, 0023-experience.md), as
// plain lists with no Zod, so the hosted page, the builder and the server
// share them. Every type yields exactly one value: that is the test for any
// new one. Each files onto the attribute types listed in `FILES_ONTO`.
import type { AttributeType } from '../values/attribute-values.ts';

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
] as const;
/** One answer type. */
export type AnswerType = (typeof ANSWER_TYPES)[number];

/** The types answered by picking one of the question's own choices. */
export const CHOICE_TYPES: readonly AnswerType[] = ['dropdown', 'choice'];

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
export const FORM_QUESTIONS_MAX = 30;

/** The most choices one choice question holds. */
export const FORM_CHOICES_MAX = 40;

/** The longest short text answer. */
export const SHORT_ANSWER_MAX = 200;

/** The longest long text answer. */
export const LONG_ANSWER_MAX = 2_000;

/** The honeypot's key in a submission's body: a person never fills it (spec 0023, bots and abuse). */
export const HONEYPOT_KEY = 'company_url';

/**
 * The honeypot input's `name` and the root of its `id` on every page we draw.
 * Never a word autofill knows (company, url, name, email...): Chrome ignores
 * `autocomplete="off"` on those and filled `company_url`, refusing real
 * bookings as bots (25 Oct 2026). The hyphen keeps it out of the question key
 * pattern, so it never meets a real question.
 */
export const HONEYPOT_INPUT_NAME = 'tf-trap';

/** What keeps password managers out of the honeypot: 1Password, LastPass, Bitwarden and Dashlane's own skip marks. */
export const HONEYPOT_IGNORE_ATTRIBUTES = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

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

/** A key not yet in `taken`: `key`, else `key_2`, `key_3`, … */
export function freeKey(key: string, taken: ReadonlySet<string>): string {
  if (!taken.has(key)) return key;
  const stem = key.replace(/_\d+$/, '').slice(0, 36);
  for (let n = 2; ; n += 1) {
    const next = `${stem}_${String(n)}`;
    if (!taken.has(next)) return next;
  }
}

/** A choice's key: lowercase, snake case, 1 to 40, a letter or digit first (an option value a site's own form posts). */
export const OPTION_KEY = /^[a-z0-9][a-z0-9_]{0,39}$/;

/** A choice key made from its words: `Under $5k` gives `under_5k`, `10 to 50` gives `10_to_50`, nothing gives `option`. */
export function optionKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return key === '' ? 'option' : key;
}

/**
 * Each choice's stable key, in the choices' order: the stored key where the
 * question has one, else one made from the choice's words, never two alike.
 * A question saved before keys existed reads the same keys every time, until
 * the builder stores them.
 */
export function choiceKeysOf(question: {
  readonly choices?: readonly string[] | undefined;
  readonly choiceKeys?: readonly string[] | undefined;
}): string[] {
  const choices = question.choices ?? [];
  const stored = question.choiceKeys ?? [];
  const taken = new Set<string>();
  return choices.map((label, index) => {
    const given = stored[index];
    const key =
      given !== undefined && OPTION_KEY.test(given) && !taken.has(given)
        ? given
        : freeKey(optionKeyFromLabel(label), taken);
    taken.add(key);
    return key;
  });
}
