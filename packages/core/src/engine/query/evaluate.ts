// The reference evaluator (spec 0004, AC-14): the same filters and sorts the
// compiler turns into SQL, worked out over plain objects. Tests run both on
// the same sample and expect the same ids in the same order, so the compiler
// can't quietly drift from what each operator means.
import type { FilterCondition, FilterGroup, RelativeRange, SortRule } from '@crm/contracts/values';
import type { Actor } from '../scope.ts';
import type { AttributeDef } from '../values.ts';
import { splitNegation, type WeekStart } from './compile.ts';

/**
 * A row as the evaluator sees it: a record (or a list entry, whose values
 * then hold the entry's and its record's), its record's system columns
 * (times as Postgres text), and current values by attribute id.
 */
export interface PlainRecord {
  readonly id: string;
  readonly recordId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy?: Actor;
  readonly updatedBy?: Actor;
  readonly values: Readonly<Record<string, unknown>>;
}

/** What the evaluator looks things up in, mirroring the database. */
export interface EvaluateContext {
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** Every live record, for filters through relationships and sorts by a linked record's name. */
  readonly records: ReadonlyMap<string, PlainRecord & { readonly objectId: string }>;
  /** Each object's primary attribute. */
  readonly primaryAttributes: ReadonlyMap<string, string>;
  readonly optionPositions: ReadonlyMap<string, number>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly now: string;
  readonly timeZone: string;
  readonly weekStart: WeekStart;
  readonly actor: Actor;
}

const collator = new Intl.Collator('und');

function textOf(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    if ('fullName' in item && typeof item.fullName === 'string') return item.fullName;
    if ('number' in item && typeof item.number === 'string') return item.number;
    if ('name' in item && typeof item.name === 'string') return item.name;
  }
  return null;
}

function field(item: unknown, key: string): unknown {
  return typeof item === 'object' && item !== null ? (item as Record<string, unknown>)[key] : undefined;
}

function itemsOf(attribute: AttributeDef, value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  if (attribute.type === 'checkbox') return value === true ? [true] : [];
  return Array.isArray(value) ? value : [value];
}

function key(text: string): string {
  return text.slice(0, 256).toLowerCase();
}

const operand = (condition: FilterCondition): unknown => ('value' in condition ? condition.value : undefined);
const operandText = (condition: FilterCondition): string => {
  const value = operand(condition);
  const text = typeof value === 'object' && value !== null && 'number' in value ? value.number : value;
  return typeof text === 'string' ? text.trim() : '';
};
const listOf = (condition: FilterCondition): readonly unknown[] => ('values' in condition ? condition.values : []);
const idOf = (value: unknown): unknown => field(value, 'recordId') ?? value;

// ---- dates ---------------------------------------------------------------

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return format(Date.UTC(y, m - 1, d + days));
}

/** Adds months the way Postgres does: the day is clamped to the month's last. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = ymd(date);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return format(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

function shiftDate(date: string, range: Exclude<RelativeRange, string>, sign: 1 | -1): string {
  const n = range.amount * sign;
  if (range.unit === 'day') return addDays(date, n);
  if (range.unit === 'week') return addDays(date, 7 * n);
  return addMonths(date, range.unit === 'month' ? n : 12 * n);
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}

/** The instant a local date's midnight falls at in a time zone. */
function zonedMidnight(date: string, timeZone: string): number {
  const [y, m, d] = ymd(date);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

function dateRange(context: EvaluateContext, range: RelativeRange, last: boolean): [string, string] {
  const today = localDate(Date.parse(context.now), context.timeZone);
  if (typeof range === 'string') {
    const [y, m] = ymd(today);
    const month = format(Date.UTC(y, m - 1, 1));
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const week = addDays(today, context.weekStart === 'sunday' ? -dow : -((dow + 6) % 7));
    switch (range) {
      case 'today':
        return [today, addDays(today, 1)];
      case 'this_week':
        return [week, addDays(week, 7)];
      case 'this_month':
        return [month, addMonths(month, 1)];
      case 'last_month':
        return [addMonths(month, -1), month];
    }
  }
  return last ? [shiftDate(today, range, -1), addDays(today, 1)] : [today, addDays(shiftDate(today, range, 1), 1)];
}

function shiftInstant(ms: number, range: Exclude<RelativeRange, string>, sign: 1 | -1): number {
  const iso = new Date(ms).toISOString();
  const moved = shiftDate(iso.slice(0, 10), range, sign);
  return Date.parse(`${moved}${iso.slice(10)}`);
}

/** A relative range as instants, and whether its end is excluded. */
function timeRange(context: EvaluateContext, range: RelativeRange, last: boolean): [number, number, boolean] {
  if (typeof range === 'string') {
    const [start, end] = dateRange(context, range, last);
    return [zonedMidnight(start, context.timeZone), zonedMidnight(end, context.timeZone), true];
  }
  const now = Date.parse(context.now);
  return last ? [shiftInstant(now, range, -1), now, false] : [now, shiftInstant(now, range, 1), false];
}

function inTime(context: EvaluateContext, at: number, condition: FilterCondition): boolean {
  if (!('range' in condition)) return false;
  const [start, end, exclusive] = timeRange(context, condition.range, condition.operator === 'within_last');
  return at >= start && (exclusive ? at < end : at <= end);
}

// ---- conditions ----------------------------------------------------------

function sameActor(a: unknown, b: Actor): boolean {
  return field(a, 'type') === b.type && (field(a, 'id') ?? null) === b.id;
}

function asActor(value: unknown): Actor {
  if (typeof value === 'string') return { type: 'member', id: value };
  return { type: field(value, 'type') as Actor['type'], id: (field(value, 'id') as string | null | undefined) ?? null };
}

function itemMatches(
  context: EvaluateContext,
  attribute: AttributeDef,
  item: unknown,
  condition: FilterCondition,
): boolean {
  const op = condition.operator;
  const text = textOf(item);
  const number = (value: unknown) => Number(typeof value === 'object' ? field(value, 'amount') : value);
  switch (op) {
    case 'is':
      if (['select', 'status', 'record_reference'].includes(attribute.type)) {
        return (attribute.type === 'record_reference' ? field(item, 'recordId') : item) === idOf(operand(condition));
      }
      if (attribute.type === 'date') return item === operand(condition);
      if (attribute.type === 'actor_reference') return sameActor(item, asActor(operand(condition)));
      if (attribute.type === 'phone') return text === operandText(condition);
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
      if (attribute.type === 'currency' && field(item, 'currency') !== field(operand(condition), 'currency')) {
        return false;
      }
      const a = number(item);
      const b = number(operand(condition));
      return { eq: a === b, gt: a > b, gte: a >= b, lt: a < b, lte: a <= b, at_least: a >= b, at_most: a <= b }[op];
    }
    case 'between': {
      if (!('from' in condition)) return false;
      if (attribute.type === 'currency' && field(item, 'currency') !== field(condition.from, 'currency')) return false;
      const a = number(item);
      return a >= number(condition.from) && a <= number(condition.to);
    }
    case 'before':
    case 'after': {
      const at = attribute.type === 'date' ? item : (field(item, 'at') ?? item);
      const value = operand(condition);
      if (attribute.type === 'date')
        return op === 'before' ? (at as string) < (value as string) : (at as string) > (value as string);
      const ms = Date.parse(at as string);
      const bound = Date.parse(value as string);
      return op === 'before' ? ms < bound : ms > bound;
    }
    case 'within':
    case 'within_last': {
      if (!('range' in condition)) return false;
      if (attribute.type === 'date') {
        const [start, end] = dateRange(context, condition.range, op === 'within_last');
        return (item as string) >= start && (item as string) < end;
      }
      return inTime(context, Date.parse((field(item, 'at') ?? item) as string), condition);
    }
    case 'is_any_of':
    case 'contains_any_of': {
      const wanted = listOf(condition);
      if (attribute.type === 'actor_reference') return wanted.some((each) => sameActor(item, asActor(each)));
      const id = attribute.type === 'record_reference' ? field(item, 'recordId') : item;
      return wanted.map(idOf).includes(id);
    }
    case 'is_me':
      return sameActor(item, context.actor);
    case 'is_checked':
      return item === true;
    case 'country_is':
      return attribute.type === 'phone'
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
      throw new Error(`The evaluator has no ${op}.`);
  }
}

function systemMatches(
  context: EvaluateContext,
  attribute: AttributeDef,
  row: PlainRecord,
  condition: FilterCondition,
): boolean {
  const op = condition.operator;
  if (op === 'is_not_empty') return true;
  switch (attribute.systemColumn) {
    case 'id': {
      const id = row.recordId ?? row.id;
      return op === 'is' ? id === idOf(operand(condition)) : listOf(condition).map(idOf).includes(id);
    }
    case 'created_at':
    case 'updated_at': {
      const at = Date.parse(String(row.values[attribute.id]));
      if (op === 'before') return at < Date.parse(String(operand(condition)));
      if (op === 'after') return at > Date.parse(String(operand(condition)));
      return inTime(context, at, condition);
    }
    case 'created_by':
    case 'updated_by': {
      const actor = attribute.systemColumn === 'created_by' ? row.createdBy : row.updatedBy;
      if (op === 'is_me') return sameActor(actor, context.actor);
      if (op === 'is') return sameActor(actor, asActor(operand(condition)));
      return listOf(condition).some((each) => sameActor(actor, asActor(each)));
    }
    default:
      return false;
  }
}

function positiveMatches(context: EvaluateContext, row: PlainRecord, condition: FilterCondition): boolean {
  if (condition.operator === 'through') return throughMatches(context, row, condition);
  const attribute = context.attributes.get(condition.attributeId);
  if (attribute === undefined) throw new Error('Unknown attribute.');
  if (attribute.systemColumn !== null) return systemMatches(context, attribute, row, condition);
  const items = itemsOf(attribute, row.values[attribute.id]);
  if (condition.operator === 'contains_all_of') {
    return listOf(condition).every((each) => items.includes(idOf(each)));
  }
  return items.some((item) => itemMatches(context, attribute, item, condition));
}

function flatten(condition: FilterCondition): { path: readonly string[]; leaf: FilterCondition } {
  if (condition.operator !== 'through') return { path: [], leaf: condition };
  const inner = flatten(condition.condition);
  return { path: [...condition.path, ...inner.path], leaf: inner.leaf };
}

function throughMatches(context: EvaluateContext, row: PlainRecord, condition: FilterCondition): boolean {
  const { path, leaf } = flatten(condition);
  const { positive, negated } = splitNegation(leaf);
  const objectOf = (id: string) => context.attributes.get(id)?.objectId;
  const walk = (at: PlainRecord, steps: readonly string[]): boolean => {
    const [first, ...rest] = steps;
    if (first === undefined) return positiveMatches(context, at, positive);
    const nextId = rest[0] ?? (positive.operator === 'through' ? '' : positive.attributeId);
    const objectId = objectOf(nextId);
    const hop = context.attributes.get(first);
    if (hop === undefined) return false;
    return itemsOf(hop, at.values[first]).some((item) => {
      const far = context.records.get(String(field(item, 'recordId')));
      return far !== undefined && far.objectId === objectId && walk(far, rest);
    });
  };
  const found = walk(row, path);
  return negated ? !found : found;
}

function matches(context: EvaluateContext, row: PlainRecord, condition: FilterCondition): boolean {
  if (condition.operator === 'through') return throughMatches(context, row, condition);
  const { positive, negated } = splitNegation(condition);
  const found = positiveMatches(context, row, positive);
  return negated ? !found : found;
}

function inGroup(context: EvaluateContext, row: PlainRecord, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((item) =>
    'conjunction' in item ? inGroup(context, row, item) : matches(context, row, item),
  );
  return group.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean);
}

// ---- sorts ---------------------------------------------------------------

type Key = { readonly kind: 'text' | 'raw' | 'number'; readonly value: string | number } | null;

const text = (value: string | null | undefined): Key =>
  value === null || value === undefined ? null : { kind: 'text', value: key(value) };
const rawKey = (value: unknown): Key =>
  typeof value === 'string' || typeof value === 'number' ? { kind: 'raw', value: String(value) } : null;
const numeric = (value: unknown): Key =>
  value === null || value === undefined ? null : { kind: 'number', value: Number(value) };

function sortKeys(context: EvaluateContext, row: PlainRecord, rule: SortRule): readonly Key[] {
  const attribute = context.attributes.get(rule.attributeId);
  if (attribute === undefined) return [null];
  const memberName = (actor: unknown) =>
    field(actor, 'type') === 'member' ? text(context.memberNames.get(String(field(actor, 'id')))) : null;
  switch (attribute.systemColumn) {
    case 'created_at':
      return [rawKey(row.createdAt)];
    case 'updated_at':
      return [rawKey(row.updatedAt)];
    case 'id':
      return [rawKey(row.recordId ?? row.id)];
    case 'created_by':
      return [memberName(row.createdBy)];
    case 'updated_by':
      return [memberName(row.updatedBy)];
    default:
      break;
  }
  const first = itemsOf(attribute, row.values[attribute.id])[0];
  if (first === undefined)
    return attribute.type === 'currency' || attribute.type === 'location' ? [null, null] : [null];
  switch (attribute.type) {
    case 'number':
    case 'rating':
      return [numeric(first)];
    case 'currency':
      return [rawKey(field(first, 'currency')), numeric(field(first, 'amount'))];
    case 'location':
      return [rawKey(field(first, 'countryCode')), text(field(first, 'locality') as string | undefined)];
    case 'date':
    case 'timestamp':
      return [rawKey(first)];
    case 'interaction':
      return [rawKey(field(first, 'at'))];
    case 'checkbox':
      return [rawKey(first === true ? 'true' : null)];
    case 'select':
    case 'status':
      return [numeric(typeof first === 'string' ? context.optionPositions.get(first) : undefined)];
    case 'actor_reference':
      return [memberName(first)];
    case 'record_reference': {
      const far = context.records.get(String(field(first, 'recordId')));
      const primary = far === undefined ? undefined : context.primaryAttributes.get(far.objectId);
      return [text(primary === undefined || far === undefined ? null : textOf(far.values[primary]))];
    }
    default:
      return [text(textOf(first))];
  }
}

function compareKeys(x: Key, y: Key): number {
  if (x === null || y === null) return 0;
  if (x.kind === 'number' && y.kind === 'number') return (x.value as number) - (y.value as number);
  if (x.kind === 'text') return collator.compare(String(x.value), String(y.value));
  return String(x.value) < String(y.value) ? -1 : String(x.value) > String(y.value) ? 1 : 0;
}

/** The ids of the rows that match, in the view's order: empties last in both directions, then by id. */
export function evaluate(
  context: EvaluateContext,
  rows: readonly PlainRecord[],
  filter: FilterGroup | undefined,
  sorts: readonly SortRule[],
): readonly string[] {
  const kept = rows.filter((row) => filter === undefined || inGroup(context, row, filter));
  const keyed = kept.map((row) => ({
    row,
    keys: sorts.flatMap((rule) => sortKeys(context, row, rule).map((value) => ({ value, rule }))),
  }));
  keyed.sort((a, b) => {
    for (const [index, { value: x, rule }] of a.keys.entries()) {
      const y = b.keys[index]?.value ?? null;
      if (x === null && y === null) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const order = compareKeys(x, y);
      if (order !== 0) return rule.direction === 'ascending' ? order : -order;
    }
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  });
  return keyed.map(({ row }) => row.id);
}
