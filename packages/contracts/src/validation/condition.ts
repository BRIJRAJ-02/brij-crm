// A rule's condition (Only when…) on one record (spec 0013): the filter
// operators worked out over the record's values, exactly as the engine's
// reference evaluator does (`packages/core/src/engine/query/evaluate.ts`; a
// test runs both on the same samples). Same record only: a condition never
// follows a relationship. Pure and total: anything malformed is no match.
import type { AttributeType } from '../values/attribute-values.ts';
import type { FilterCondition, FilterGroup } from '../values/filters.ts';
import { dateRange, timeRange, type RuleClock } from './clock.ts';
import { compareDecimal } from './decimal.ts';

/** An attribute as rules see it: its type and whether it holds a list, and whether it is archived. */
export interface ConditionAttributeShape {
  readonly type: AttributeType;
  readonly isMulti: boolean;
  /** An archived attribute reads as empty in a condition (spec 0013). */
  readonly archived: boolean;
}

/** Who is writing, for "is me": a member's id. */
export interface ConditionActor {
  readonly type: 'member' | 'api_key' | 'automation' | 'system' | 'form';
  readonly id: string | null;
}

/** Each negative operator and the positive one it is the NOT of (the compiler's `splitNegation`). */
const NEGATIVES: Partial<Record<FilterCondition['operator'], FilterCondition['operator']>> = {
  is_not: 'is',
  does_not_contain: 'contains',
  neq: 'eq',
  contains_none_of: 'contains_any_of',
  is_empty: 'is_not_empty',
  is_not_checked: 'is_checked',
};

function field(item: unknown, key: string): unknown {
  return typeof item === 'object' && item !== null ? (item as Readonly<Record<string, unknown>>)[key] : undefined;
}

function textOf(item: unknown): string | null {
  if (typeof item === 'string') return item;
  for (const key of ['fullName', 'number', 'name']) {
    const text = field(item, key);
    if (typeof text === 'string') return text;
  }
  return null;
}

/** A value's items: a list as it is, one value as a list of one, empty as none (an unticked checkbox included). */
export function itemsOf(type: AttributeType, value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  if (type === 'checkbox') return value === true ? [true] : [];
  return Array.isArray(value) ? (value as readonly unknown[]) : [value];
}

const key = (text: string): string => text.slice(0, 256).toLowerCase();
const operand = (condition: FilterCondition): unknown => ('value' in condition ? condition.value : undefined);
const operandText = (condition: FilterCondition): string => {
  const value = operand(condition);
  const text = typeof value === 'object' && value !== null && 'number' in value ? value.number : value;
  return typeof text === 'string' ? text.trim() : '';
};
const listOf = (condition: FilterCondition): readonly unknown[] => ('values' in condition ? condition.values : []);
const idOf = (value: unknown): unknown => field(value, 'recordId') ?? value;

function sameActor(a: unknown, b: ConditionActor | undefined): boolean {
  return b !== undefined && field(a, 'type') === b.type && (field(a, 'id') ?? null) === b.id;
}

function asActor(value: unknown): ConditionActor {
  if (typeof value === 'string') return { type: 'member', id: value };
  const type = field(value, 'type');
  const id = field(value, 'id');
  return {
    type: type === 'api_key' || type === 'automation' || type === 'system' || type === 'form' ? type : 'member',
    id: typeof id === 'string' ? id : null,
  };
}

/** A number, an amount or a rating as a decimal string, for an exact comparison. */
function decimalOf(value: unknown): string | undefined {
  const raw = typeof value === 'object' && value !== null ? field(value, 'amount') : value;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return typeof raw === 'string' ? raw : undefined;
}

function compareNumbers(a: unknown, b: unknown): number | undefined {
  const x = decimalOf(a);
  const y = decimalOf(b);
  return x === undefined || y === undefined ? undefined : compareDecimal(x, y);
}

function itemMatches(
  type: AttributeType,
  item: unknown,
  condition: FilterCondition,
  clock: RuleClock,
  actor: ConditionActor | undefined,
): boolean {
  const op = condition.operator;
  const text = textOf(item);
  switch (op) {
    case 'is':
      if (type === 'select' || type === 'status') return item === idOf(operand(condition));
      if (type === 'record_reference') return field(item, 'recordId') === idOf(operand(condition));
      if (type === 'date') return item === operand(condition);
      if (type === 'actor_reference') return sameActor(item, asActor(operand(condition)));
      if (type === 'phone') return text === operandText(condition);
      return text !== null && key(text) === key(operandText(condition));
    case 'contains':
    case 'name_contains':
      return text !== null && text.slice(0, 2048).toLowerCase().includes(operandText(condition).toLowerCase());
    case 'eq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'at_least':
    case 'at_most': {
      if (type === 'currency' && field(item, 'currency') !== field(operand(condition), 'currency')) return false;
      const order = compareNumbers(item, operand(condition));
      if (order === undefined) return false;
      return {
        eq: order === 0,
        gt: order > 0,
        gte: order >= 0,
        lt: order < 0,
        lte: order <= 0,
        at_least: order >= 0,
        at_most: order <= 0,
      }[op];
    }
    case 'between': {
      if (!('from' in condition)) return false;
      if (type === 'currency' && field(item, 'currency') !== field(condition.from, 'currency')) return false;
      const low = compareNumbers(item, condition.from);
      const high = compareNumbers(item, condition.to);
      return low !== undefined && high !== undefined && low >= 0 && high <= 0;
    }
    case 'before':
    case 'after': {
      const value = operand(condition);
      if (type === 'date') {
        if (typeof item !== 'string' || typeof value !== 'string') return false;
        return op === 'before' ? item < value : item > value;
      }
      const at = Date.parse(String(field(item, 'at') ?? item));
      const bound = Date.parse(String(value));
      if (Number.isNaN(at) || Number.isNaN(bound)) return false;
      return op === 'before' ? at < bound : at > bound;
    }
    case 'within':
    case 'within_last': {
      if (!('range' in condition)) return false;
      const last = op === 'within_last';
      if (type === 'date') {
        if (typeof item !== 'string') return false;
        const [start, end] = dateRange(clock, condition.range, last);
        return item >= start && item < end;
      }
      const at = Date.parse(String(field(item, 'at') ?? item));
      if (Number.isNaN(at)) return false;
      const [start, end, exclusive] = timeRange(clock, condition.range, last);
      return at >= start && (exclusive ? at < end : at <= end);
    }
    case 'is_any_of':
    case 'contains_any_of': {
      const wanted = listOf(condition);
      if (type === 'actor_reference') return wanted.some((each) => sameActor(item, asActor(each)));
      const id = type === 'record_reference' ? field(item, 'recordId') : item;
      return wanted.map(idOf).includes(id);
    }
    case 'is_me':
      return sameActor(item, actor);
    case 'is_checked':
      return item === true;
    case 'country_is':
      return type === 'phone'
        ? String(field(item, 'country')).toUpperCase() === operandText(condition).toUpperCase()
        : String(field(item, 'countryCode')) === operandText(condition).toUpperCase();
    case 'locality_is':
    case 'region_is':
    case 'first_name_is':
    case 'last_name_is': {
      const part = {
        locality_is: 'locality',
        region_is: 'region',
        first_name_is: 'firstName',
        last_name_is: 'lastName',
      }[op];
      const value = field(item, part);
      return typeof value === 'string' && value.toLowerCase() === operandText(condition).toLowerCase();
    }
    case 'kind_is':
      return field(item, 'kind') === operandText(condition);
    case 'has_files':
    case 'is_not_empty':
      return true;
    default:
      return false;
  }
}

/** What a condition is checked against: the record's values, its attributes, the clock and the writer. */
export interface ConditionInput {
  readonly values: Readonly<Record<string, unknown>>;
  readonly attributes: ReadonlyMap<string, ConditionAttributeShape>;
  readonly clock: RuleClock;
  readonly actor?: ConditionActor;
}

function leafMatches(condition: FilterCondition, input: ConditionInput): boolean {
  if (condition.operator === 'through') return false;
  const positive = NEGATIVES[condition.operator];
  const leaf = positive === undefined ? condition : ({ ...condition, operator: positive } as FilterCondition);
  if (leaf.operator === 'through') return false;
  const attribute = input.attributes.get(leaf.attributeId.toLowerCase());
  if (attribute === undefined) return false;
  const value = attribute.archived ? null : input.values[leaf.attributeId.toLowerCase()];
  const items = itemsOf(attribute.type, value);
  const found =
    leaf.operator === 'contains_all_of'
      ? listOf(leaf).every((each) => items.includes(idOf(each)))
      : items.some((item) => itemMatches(attribute.type, item, leaf, input.clock, input.actor));
  return positive === undefined ? found : !found;
}

/**
 * Whether a record's values meet a same record condition (spec 0013): every
 * operator the filters offer, relative dates resolved in the clock's time
 * zone, an archived attribute read as empty, and an empty group met.
 */
export function matchesCondition(group: FilterGroup, input: ConditionInput): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((item) =>
    'conjunction' in item ? matchesCondition(item, input) : leafMatches(item, input),
  );
  return group.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean);
}

/** The attribute ids a condition names, lower case, each once. */
export function conditionAttributeIds(group: FilterGroup | undefined): readonly string[] {
  if (group === undefined) return [];
  const ids = new Set<string>();
  const walk = (inner: FilterGroup) => {
    for (const item of inner.conditions) {
      if ('conjunction' in item) walk(item);
      else if (item.operator !== 'through') ids.add(item.attributeId.toLowerCase());
    }
  };
  walk(group);
  return [...ids];
}
