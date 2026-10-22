// Show when and routing conditions (spec 0043, AC-1601 to AC-1603, AC-1614;
// spec 0023, AC-1036, AC-1037): one shape and one evaluator for a question's
// Show when, a form's routing rules and a team page's routing rules. Plain
// TypeScript, no Zod and no I/O: the hosted page, the builder's preview, the
// answer check on the server and the routing decision all run it, so they
// never disagree. The Zod schemas live in `document.ts`.

/** The comparisons a condition makes (AC-1602). */
export const CONDITION_OPS = [
  'is',
  'is_not',
  'is_any_of',
  'contains',
  'is_answered',
  'is_empty',
  'more_than',
  'less_than',
] as const;
/** One comparison. */
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** The comparisons that take no value. */
export const VALUELESS_OPS: readonly ConditionOp[] = ['is_answered', 'is_empty'];

/** The comparisons that compare numbers. */
export const NUMBER_OPS: readonly ConditionOp[] = ['more_than', 'less_than'];

/** At most this many conditions in one Show when or one rule (AC-1036). */
export const CONDITIONS_MAX = 5;

/**
 * One condition: a fact's key (a question key, `person.<attributeId>` /
 * `company.<attributeId>` for a record field, or `hidden.<name>` for one of
 * the visit's hidden fields), a comparison and its value. `is_any_of` takes a
 * list; the number comparisons a number as text.
 */
export interface Condition {
  readonly key: string;
  readonly op: ConditionOp;
  readonly value?: string | readonly string[];
}

/** Conditions joined by all or any (1 to 5). */
export interface ShowWhen {
  readonly join: 'all' | 'any';
  readonly rules: readonly Condition[];
}

/** The facts a condition reads, by key: answers as the answer check made them, record fields as their values. */
export type Facts = Readonly<Record<string, unknown>>;

/** The record facts' key prefixes (AC-1603). */
export const RECORD_FACT = /^(person|company)\.([0-9a-f-]{36})$/;

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

/** A fact's values as comparable text: trimmed, lower case; yes or no for booleans; a phone's number. */
function textsOf(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((each: unknown) => textsOf(each));
  if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
  if (typeof value === 'number') return Number.isFinite(value) ? [String(value)] : [];
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' ? [] : [trimmed];
  }
  if (typeof value === 'object') {
    const { number } = value as { readonly number?: unknown };
    return typeof number === 'string' ? textsOf(number) : [];
  }
  return [];
}

/** The text of a condition's value (or values) as compared. */
function wanted(value: Condition['value']): readonly string[] {
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : value).map((each) => each.trim().toLowerCase());
}

/** A number from text, or undefined. */
function numberOf(text: string): number | undefined {
  const value = Number(text.replaceAll(',', ''));
  return text.trim() !== '' && Number.isFinite(value) ? value : undefined;
}

/**
 * Whether one condition holds over the facts (AC-1602). A missing fact is
 * empty: it is never "is", "contains" or a number, so a rule over a fact that
 * couldn't be read never matches by accident.
 */
export function matchesCondition(condition: Condition, facts: Facts): boolean {
  const have = textsOf(Object.hasOwn(facts, condition.key) ? facts[condition.key] : undefined);
  const want = wanted(condition.value);
  switch (condition.op) {
    case 'is_answered':
      return have.length > 0;
    case 'is_empty':
      return have.length === 0;
    case 'is':
    case 'is_any_of':
      return have.some((each) => want.includes(each));
    case 'is_not':
      return have.length > 0 && !have.some((each) => want.includes(each));
    case 'contains': {
      const [needle] = want;
      return needle !== undefined && needle !== '' && have.some((each) => each.includes(needle));
    }
    case 'more_than':
    case 'less_than': {
      const [first] = want;
      const limit = first === undefined ? undefined : numberOf(first);
      if (limit === undefined) return false;
      return have.some((each) => {
        const number = numberOf(each);
        if (number === undefined) return false;
        return condition.op === 'more_than' ? number > limit : number < limit;
      });
    }
  }
}

/** Whether a Show when (or a rule's `when`) holds: all or any of its conditions; none means it always holds. */
export function matchesShowWhen(showWhen: ShowWhen | undefined, facts: Facts): boolean {
  if (showWhen === undefined || showWhen.rules.length === 0) return true;
  return showWhen.join === 'all'
    ? showWhen.rules.every((condition) => matchesCondition(condition, facts))
    : showWhen.rules.some((condition) => matchesCondition(condition, facts));
}

/** What `visibleQuestions` needs of a question. */
export interface ShownQuestion {
  readonly key: string;
  readonly showWhen?: ShowWhen;
}

/**
 * The keys of the questions that show for these answers (AC-1614), in order.
 * A question's Show when reads only earlier questions that are themselves
 * shown, so hiding one hides those that depend on it too.
 */
export function visibleQuestions(
  questions: readonly ShownQuestion[],
  answers: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const shown = new Set<string>();
  const seen: Record<string, unknown> = {};
  for (const question of questions) {
    if (matchesShowWhen(question.showWhen, seen)) {
      shown.add(question.key);
      if (Object.hasOwn(answers, question.key)) seen[question.key] = answers[question.key];
    }
  }
  return shown;
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
