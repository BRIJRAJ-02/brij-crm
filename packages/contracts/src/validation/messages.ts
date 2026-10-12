// What a refused rule says (spec 0013, the rule kinds table): each kind's
// generated message, and a condition's summary ("Stage is Won"). The
// browser and the server word a refusal with these same functions, so the
// message a person sees first is the one the server would give.
import type { AttributeType } from '../values/attribute-values.ts';
import type { FilterCondition, FilterGroup, RelativeRange } from '../values/filters.ts';
import { formatDay } from './clock.ts';
import type { RuleKindName } from './kinds.ts';

/** An attribute as a message names it: its title, and whether the reader may see it (a hidden one is never named). */
export interface NamedAttribute {
  readonly type: AttributeType;
  readonly title: string;
  readonly visible: boolean;
  /** A select's or status attribute's options, so an operand reads by its label. */
  readonly options?: readonly { readonly id: string; readonly label: string }[];
}

/** Operator phrases, as a sentence reads them (the field set's operator labels, spec 0003). */
export const OPERATOR_PHRASES: Readonly<Record<FilterCondition['operator'], string>> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  within: 'is within',
  within_last: 'is within the last',
  at_least: 'is at least',
  at_most: 'is at most',
  is_any_of: 'is any of',
  contains_any_of: 'contains any of',
  contains_all_of: 'contains all of',
  contains_none_of: 'contains none of',
  is_me: 'is me',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_checked: 'is checked',
  is_not_checked: 'is not checked',
  has_files: 'has files',
  first_name_is: 'first name is',
  last_name_is: 'last name is',
  country_is: 'country is',
  locality_is: 'city is',
  region_is: 'region is',
  name_contains: 'name contains',
  kind_is: 'kind is',
  through: 'where',
};

/** How a condition naming an attribute hidden from the reader reads (spec 0013: "another field", its operand left out). */
export const HIDDEN_CONDITION = 'another field matches';

/** What a summary of more than three conditions, or of nested groups, reads. */
export const MANY_CONDITIONS = 'its conditions are met';

/** What a refusal on an attribute hidden from the writer says, whatever the rule's own message. */
export const HIDDEN_FAILURE = 'A field you can’t see doesn’t meet a rule. Ask a workspace admin.';

const field = (item: unknown, key: string): unknown =>
  typeof item === 'object' && item !== null ? (item as Readonly<Record<string, unknown>>)[key] : undefined;

/** "a, b or c": items joined as a sentence lists them. */
export function listWords(items: readonly string[], last: 'and' | 'or'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1) ?? ''}`;
}

function rangeWords(range: RelativeRange): string {
  if (typeof range === 'string') {
    return { today: 'today', this_week: 'this week', this_month: 'this month', last_month: 'last month' }[range];
  }
  return `${String(range.amount)} ${range.unit}${range.amount === 1 ? '' : 's'}`;
}

/** One operand as text (spec 0013 reads it through `toText`, which moves to contracts in milestone 3). */
function operandWords(attribute: NamedAttribute, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (attribute.type === 'select' || attribute.type === 'status') {
    return attribute.options?.find((option) => option.id === value)?.label ?? 'an option no longer listed';
  }
  if (attribute.type === 'date' && typeof value === 'string') return formatDay(value);
  if (attribute.type === 'currency') {
    const amount = field(value, 'amount');
    const currency = field(value, 'currency');
    return typeof amount === 'string' && typeof currency === 'string' ? `${currency} ${amount}` : '';
  }
  if (attribute.type === 'actor_reference') return 'a member';
  if (attribute.type === 'record_reference') return 'a record';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const number = field(value, 'number');
  return typeof number === 'string' ? number : '';
}

function leafWords(leaf: FilterCondition, attributes: ReadonlyMap<string, NamedAttribute>): string {
  if (leaf.operator === 'through') return HIDDEN_CONDITION;
  const attribute = attributes.get(leaf.attributeId.toLowerCase());
  if (attribute === undefined || !attribute.visible) return HIDDEN_CONDITION;
  const phrase = `${attribute.title} ${OPERATOR_PHRASES[leaf.operator]}`;
  if ('value' in leaf) {
    const words = operandWords(attribute, leaf.value);
    return words === '' ? phrase : `${phrase} ${words}`;
  }
  if ('from' in leaf) return `${phrase} ${operandWords(attribute, leaf.from)} and ${operandWords(attribute, leaf.to)}`;
  if ('values' in leaf) {
    const words = leaf.values.map((each) => operandWords(attribute, each));
    return `${phrase} ${listWords(words, leaf.operator === 'contains_all_of' ? 'and' : 'or')}`;
  }
  if ('range' in leaf) return `${phrase} ${rangeWords(leaf.range)}`;
  return phrase;
}

/**
 * A condition in words (spec 0013): one condition reads "<title> <operator>
 * <operand>" ("Stage is Won"), two or three join by their group's "and" or
 * "or", and more, or any nested group, read "its conditions are met". An
 * attribute hidden from the reader reads "another field", with no operand.
 */
export function summarizeCondition(group: FilterGroup, attributes: ReadonlyMap<string, NamedAttribute>): string {
  const leaves = group.conditions.flatMap((item) => ('conjunction' in item ? [] : [item]));
  if (leaves.length !== group.conditions.length || leaves.length > 3 || leaves.length === 0) return MANY_CONDITIONS;
  return listWords(
    leaves.map((leaf) => leafWords(leaf, attributes)),
    group.conjunction,
  );
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** A country's English name from its code ("United Kingdom"), or the code itself. */
function countryName(code: string): string {
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "a, b or c" for up to three, else `many(n)`. */
function upToThree(items: readonly string[], many: (count: number) => string): string {
  return items.length > 3 ? many(items.length) : listWords(items, 'or');
}

function stringParam(params: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

function listParam(params: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A date bound in words: "8 October 2026", "today", "3 days from today", "3 days before today". */
function dateBoundWords(bound: unknown): string | undefined {
  const date = field(bound, 'date');
  if (typeof date === 'string') return formatDay(date);
  const days = field(bound, 'daysFromToday');
  if (typeof days !== 'number') return undefined;
  if (days === 0) return 'today';
  const count = `${String(Math.abs(days))} day${Math.abs(days) === 1 ? '' : 's'}`;
  return days > 0 ? `${count} from today` : `${count} before today`;
}

/** A pair of bounds in words: "at least", "at most", or "between". */
function boundsWords(
  title: string,
  min: string | undefined,
  max: string | undefined,
  words: {
    atLeast: (min: string) => string;
    atMost: (max: string) => string;
    between: (min: string, max: string) => string;
  },
): string {
  if (min !== undefined && max !== undefined) return `${title} ${words.between(min, max)}`;
  if (min !== undefined) return `${title} ${words.atLeast(min)}`;
  return `${title} ${words.atMost(max ?? '')}`;
}

/**
 * A kind's generated message for an attribute (spec 0013, the rule kinds
 * table), without its condition. `value` is the failing value, for a blocked
 * email domain ("can't be an address at gmail.com").
 */
export function kindMessage(
  kind: RuleKindName,
  title: string,
  params: Readonly<Record<string, unknown>>,
  value?: unknown,
): string {
  const min = stringParam(params, 'min');
  const max = stringParam(params, 'max');
  switch (kind) {
    case 'required_when':
      return `${title} is required`;
    case 'length':
      return boundsWords(title, min, max, {
        atLeast: (low) => `needs at least ${low} characters`,
        atMost: (high) => `can have at most ${high} characters`,
        between: (low, high) => `needs ${low} to ${high} characters`,
      });
    case 'count':
      return boundsWords(title, min, max, {
        atLeast: (low) => `needs at least ${low} values`,
        atMost: (high) => `can hold at most ${high} values`,
        between: (low, high) => `needs ${low} to ${high} values`,
      });
    case 'range':
      return boundsWords(title, min, max, {
        atLeast: (low) => `must be at least ${low}`,
        atMost: (high) => `must be at most ${high}`,
        between: (low, high) => `must be between ${low} and ${high}`,
      });
    case 'date_range':
      return boundsWords(title, dateBoundWords(params.min), dateBoundWords(params.max), {
        atLeast: (low) => `must be on or after ${low}`,
        atMost: (high) => `must be on or before ${high}`,
        between: (low, high) => `must be between ${low} and ${high}`,
      });
    case 'integer':
      return `${title} must be a whole number`;
    case 'pattern': {
      const text = stringParam(params, 'text') ?? '';
      switch (params.preset) {
        case 'digits':
          return `${title} can only contain digits`;
        case 'letters':
          return `${title} can only contain letters`;
        case 'letters_digits':
          return `${title} can only contain letters and digits`;
        case 'no_spaces':
          return `${title} can’t contain spaces`;
        case 'starts_with':
          return `${title} must start with “${text}”`;
        case 'ends_with':
          return `${title} must end with “${text}”`;
        default:
          return `${title} isn’t in the required format`;
      }
    }
    case 'email_domain': {
      const domains = listParam(params, 'domains');
      if (params.mode === 'block') {
        const address = typeof value === 'string' ? value : '';
        const at = address.slice(address.lastIndexOf('@') + 1);
        return `${title} can’t be an address at ${at === '' ? listWords(domains, 'or') : at}`;
      }
      return `${title} must be an address at ${upToThree(domains, (count) => `one of the ${String(count)} allowed domains`)}`;
    }
    case 'phone_country': {
      const countries = listParam(params, 'countries').map(countryName);
      return `${title} must be a number from ${upToThree(countries, (count) => `one of ${String(count)} countries`)}`;
    }
    case 'currency_in': {
      const codes = listParam(params, 'codes');
      return `${title} must be in ${upToThree(codes, (count) => `one of ${String(count)} currencies`)}`;
    }
  }
}

/** The whole generated message: the kind's words, " when <summary>" after a condition, and a full stop. */
export function generatedMessage(
  rule: {
    readonly kind: RuleKindName;
    readonly params: Readonly<Record<string, unknown>>;
    readonly condition?: FilterGroup | undefined;
  },
  title: string,
  attributes: ReadonlyMap<string, NamedAttribute>,
  value?: unknown,
): string {
  const words = kindMessage(rule.kind, title, rule.params, value);
  const when =
    rule.condition === undefined || rule.condition.conditions.length === 0
      ? ''
      : ` when ${summarizeCondition(rule.condition, attributes)}`;
  return `${words}${when}.`;
}
