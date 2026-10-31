// What the builder and the server say and read about conditions (spec 0043, AC-1603, AC-1605): record facts, the
// visit's hidden fields and a condition's words in a summary. Apart from `show-when.ts` on purpose: the hosted page
// evaluates conditions over answers only and never words one, and a module the page and the builder share ships
// whole in the page's first load (spec 0063, AC-6331).
import { VALUELESS_OPS, type ConditionOp, type Facts, type ShowWhen } from './show-when.ts';

/**
 * A record fact's key (AC-1603): `person.` or `company.`, then the field's attribute id as a uuid in its one
 * canonical spelling (lower case, 8-4-4-4-12 digits), the second group. Anything else is no record fact: it fails
 * `FactKey` at the boundary, so a malformed id (36 dashes once answered 500) never reaches the database's uuid cast.
 */
export const RECORD_FACT = /^(person|company)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** True when a key names a record field, not an answer. */
export function isRecordFact(key: string): boolean {
  return RECORD_FACT.test(key);
}

/**
 * The hidden fields a visit brings (spec 0023, AC-591): its UTM tags, the
 * page it was on and the referrer, as a form's submission keeps them
 * (`SubmitHidden`). Routing rules read them as `hidden.<name>`; a question's
 * Show when doesn't, since the hosted page decides it from answers alone.
 */
export const HIDDEN_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'page',
  'referrer',
] as const;
/** One hidden field. */
export type HiddenField = (typeof HIDDEN_FIELDS)[number];

/** The fact key of a hidden field: `hidden.utm_source`. */
export function hiddenFactKey(field: HiddenField): string {
  return `hidden.${field}`;
}

/** True when a key names one of the visit's hidden fields (`hidden.utm_source`), not an answer. */
export function isHiddenFact(key: string): boolean {
  return key.startsWith('hidden.') && (HIDDEN_FIELDS as readonly string[]).includes(key.slice('hidden.'.length));
}

/** Where each hidden field sits in a submission's stored context (`SubmissionContext`): the page is `page_url`. */
const CONTEXT_KEYS: Readonly<Record<HiddenField, string>> = {
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_term: 'utm_term',
  utm_content: 'utm_content',
  page: 'page_url',
  referrer: 'referrer',
};

/** The text an object holds at `key`, or undefined (not an object, not text, or blank). */
function textAt(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source) || !Object.hasOwn(source, key)) {
    return undefined;
  }
  const value: unknown = (source as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * A visit's hidden fields as facts, under their `hidden.<name>` keys: from a
 * submission's stored context first, then its older hidden fields, as the
 * submission's Came from reads them. A field the visit didn't bring is left
 * out, so a rule over it reads it as empty.
 */
export function hiddenFacts(hidden: unknown, context?: unknown): Facts {
  return Object.fromEntries(
    HIDDEN_FIELDS.flatMap((field) => {
      const value = textAt(context, CONTEXT_KEYS[field]) ?? textAt(hidden, field);
      return value === undefined ? [] : [[hiddenFactKey(field), value]];
    }),
  );
}

/** The words of an operator in a summary ("Budget is Over $10k"). */
const OP_WORDS: Readonly<Record<ConditionOp, string>> = {
  is: 'is',
  is_not: 'is not',
  is_any_of: 'is any of',
  contains: 'contains',
  is_answered: 'is answered',
  is_empty: 'is empty',
  more_than: 'is more than',
  less_than: 'is less than',
};

/** The words of an operator. */
export function opWords(op: ConditionOp): string {
  return OP_WORDS[op];
}

/**
 * One line for a Show when or a rule ("Budget is Over $10k and Team size is
 * more than 50"), naming facts by `labelOf` and values by `valueOf` (a record
 * field's option id as its option's name).
 */
export function summarizeShowWhen(
  showWhen: ShowWhen,
  labelOf: (key: string) => string,
  valueOf: (key: string, value: string) => string = (_key, value) => value,
): string {
  const parts = showWhen.rules.map((condition) => {
    const values =
      condition.value === undefined ? [] : typeof condition.value === 'string' ? [condition.value] : condition.value;
    const value =
      values.length === 0 ? '' : ` ${values.map((each) => valueOf(condition.key, each.trim())).join(' or ')}`;
    return `${labelOf(condition.key)} ${opWords(condition.op)}${VALUELESS_OPS.includes(condition.op) ? '' : value}`;
  });
  return parts.join(showWhen.join === 'all' ? ' and ' : ' or ');
}
