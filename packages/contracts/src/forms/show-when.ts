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
