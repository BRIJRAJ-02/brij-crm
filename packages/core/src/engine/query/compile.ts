// Turns a saved filter and sort into SQL (spec 0004, AC-14). Every user value
// becomes a parameter; only fixed fragments are written into the SQL text.
//
// A query reads rows aliased `r`: records for an object view, entries for a
// list view (then the entry's record is `rec`). Each condition compiles to
// EXISTS over the attribute's current value rows (or its live links), so a
// multi valued attribute matches when any item does. A negative operator is
// NOT of its positive twin, so it also matches rows with no value. A filter
// through a relationship walks at most 2 hops, one EXISTS per hop, and a
// negative one means "no linked record matches".
import { sql, type SQL } from 'drizzle-orm';
import {
  ActorReferenceValue,
  CurrencyValue,
  DateValue,
  FilterGroup,
  SortRules,
  toCanonicalDecimal,
  type FilterCondition,
  type RelativeRange,
  type SortRule,
} from '@crm/contracts/values';
import { uuidArray, uuidList } from '../ids.ts';
import { refuse } from '../refusals.ts';
import { hasSortKey } from '../sort-keys.ts';
import type { RelationshipDef } from '../relationships.ts';
import type { Actor } from '../scope.ts';
import type { AttributeDef } from '../values.ts';

/** The day a week starts on, for "this week". */
export type WeekStart = 'monday' | 'sunday';

/** What a filter is resolved against: "now" (the database's when absent), the viewer's time zone and week start. */
export interface QueryClock {
  readonly now?: string;
  readonly timeZone?: string;
  readonly weekStart?: WeekStart;
}

/** Everything the compiler looks up: the attributes a query names, their relationships, and who is asking. */
export interface CompileContext {
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  readonly relationships: ReadonlyMap<string, RelationshipDef>;
  readonly clock: QueryClock;
  readonly actor: Actor;
  /**
   * Keep each condition a per row check (an OFFSET 0 fence stops Postgres
   * turning EXISTS into a join), for pages that scan rows in sort order and
   * stop at the limit.
   */
  readonly fence?: boolean;
  /**
   * What the search function found for each contains it could answer
   * completely (`searchKey` to owner ids); a contains missing here takes the
   * narrowed path, a LIKE checked row by row.
   */
  readonly searches?: ReadonlyMap<string, readonly string[]>;
}

/** Where a condition stands: the row alias, the record alias that holds system columns, and what's in reach. */
export interface Level {
  readonly row: string;
  readonly record: string;
  readonly objectId: string;
  readonly listId: string | null;
  readonly hops: number;
}

/** The base level of an object view (records `r`) or a list view (entries `r`, their records `rec`). */
export function baseLevel(base: { readonly objectId: string; readonly listId?: string }): Level {
  return base.listId === undefined
    ? { row: 'r', record: 'r', objectId: base.objectId, listId: null, hops: 0 }
    : { row: 'r', record: 'rec', objectId: base.objectId, listId: base.listId, hops: 0 };
}

/** The most relationship hops a filter may walk. */
const MAX_HOPS = 2;
/** The longest text a condition may search for. */
const MAX_OPERAND = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sort and filter key of a text column: its first 256 characters, lowercased, in the pinned collation. */
const textKey = (column: SQL) => sql`(lower(left(${column}, 256)) collate "und-x-icu")`;
const TEXT_KEY = textKey(sql.raw('v.text_value'));

const raw = (alias: string) => sql.raw(alias);

function invalid(message: string): never {
  throw refuse('FILTER_INVALID', message);
}

/** True for a well formed uuid, so a malformed id is refused before it reaches Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function attributeFor(context: CompileContext, attributeId: string): AttributeDef {
  const attribute = context.attributes.get(attributeId);
  if (attribute === undefined) invalid('A filter or sort names an attribute that is not on this object.');
  return attribute;
}

/** How an attribute's owner is written at a level: the entry for a list attribute, else the record. */
function ownerOf(level: Level, attribute: AttributeDef): SQL {
  if (attribute.listId !== null) {
    if (attribute.listId !== level.listId) invalid('A filter or sort names an attribute of another list.');
    return sql`${raw(level.row)}.id`;
  }
  if (attribute.objectId !== level.objectId) invalid('A filter or sort names an attribute that is not on this object.');
  return sql`${raw(level.record)}.id`;
}

// ---- operands ------------------------------------------------------------

function operandText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_OPERAND) {
    invalid(`Give the text to compare, up to ${String(MAX_OPERAND)} characters.`);
  }
  return value.trim();
}

/** `value` with LIKE's wildcards escaped, so it matches literally. */
function likeLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function containsPattern(value: unknown): string {
  return `%${likeLiteral(operandText(value).toLowerCase())}%`;
}

/**
 * The most rows a contains asks the search function for. Fewer back means
 * every match came back (a rare match, so the page filters those ids first);
 * a full answer means a common match, and the page takes its usual path.
 */
export const SEARCH_CAP = 5000;
/** A run of 3 letters or digits: the shortest text with a trigram the index can look up. */
const TRIGRAM_RUN = /[\p{L}\p{N}]{3}/u;

/** A contains the search function can answer: the attribute, and the text lowercased as the compiler matches it. */
export interface SearchTerm {
  readonly attributeId: string;
  readonly text: string;
}

/** The key a search's result is kept under in `CompileContext.searches`. */
export function searchKey(term: SearchTerm): string {
  return `${term.attributeId}:${term.text}`;
}

function numberOperand(value: unknown): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  const canonical = typeof text === 'string' ? toCanonicalDecimal(text) : undefined;
  if (canonical === undefined) invalid('Give a number to compare, such as 12.5.');
  return canonical;
}

/** A canonical decimal times 10,000, as the stored number key holds it (exact: 4 decimals at most). */
function scaled(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const digits = `${whole}${fraction.padEnd(4, '0')}`.replace(/^0+(?=\d)/, '');
  return negative && digits !== '0' ? `-${digits}` : digits;
}

function currencyOperand(value: unknown): { amount: string; currency: string } {
  const parsed = CurrencyValue.safeParse(value);
  if (!parsed.success) invalid('Give an amount and its currency, such as USD 100.');
  return { amount: numberOperand(parsed.data.amount), currency: parsed.data.currency };
}

function dateOperand(value: unknown): string {
  const parsed = DateValue.safeParse(value);
  if (!parsed.success) invalid('Give a date, such as 2026-10-08.');
  return parsed.data;
}

function timestampOperand(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid('Give a moment as an ISO timestamp.');
  return new Date(value).toISOString();
}

function idOperand(value: unknown, what: string): string {
  const id = typeof value === 'object' && value !== null && 'recordId' in value ? value.recordId : value;
  if (!isUuid(id)) invalid(`Give ${what} by its id.`);
  return id;
}

function actorOperand(value: unknown): Actor {
  if (isUuid(value)) return { type: 'member', id: value };
  const parsed = ActorReferenceValue.safeParse(value);
  if (!parsed.success || (parsed.data.id !== null && !isUuid(parsed.data.id))) invalid('Give a member by their id.');
  return parsed.data;
}

function listOperand<T>(condition: FilterCondition, each: (value: unknown) => T): readonly T[] {
  if (!('values' in condition) || condition.values.length === 0 || condition.values.length > 100) {
    invalid('Give 1 to 100 values to match.');
  }
  return condition.values.map(each);
}

function valueOf(condition: FilterCondition): unknown {
  return 'value' in condition ? condition.value : undefined;
}

function inList(column: SQL, items: readonly string[], cast: string): SQL {
  return sql`${column} in (${sql.join(
    items.map((item) => sql`${item}::${raw(cast)}`),
    sql`, `,
  )})`;
}

// ---- relative time --------------------------------------------------------

/** A period as SQL bounds: `[start, end)` when `endExclusive`, else `[start, end]`. */
interface Period {
  readonly start: SQL;
  readonly end: SQL;
  readonly endExclusive: boolean;
}

function nowOf(clock: QueryClock): SQL {
  return clock.now === undefined ? sql`now()` : sql`${timestampOperand(clock.now)}::timestamptz`;
}

/** Today in the viewer's time zone, as a date. */
function todayOf(clock: QueryClock): SQL {
  return sql`((${nowOf(clock)}) at time zone ${clock.timeZone ?? 'UTC'})::date`;
}

function intervalOf(range: Exclude<RelativeRange, string>): SQL {
  return sql`${`${String(range.amount)} ${range.unit}`}::interval`;
}

/**
 * A relative range as dates `[start, end)`. A named range is that day, week
 * or month. An amount is the next N units from today (`within`) or the last N
 * up to today (`within_last`), both ends included.
 */
function dateRange(clock: QueryClock, range: RelativeRange, last: boolean): { start: SQL; end: SQL } {
  const today = todayOf(clock);
  if (typeof range === 'string') {
    const month = sql`date_trunc('month', ${today})::date`;
    const week =
      clock.weekStart === 'sunday'
        ? sql`(${today} - extract(dow from ${today})::int)`
        : sql`(${today} - (extract(isodow from ${today})::int - 1))`;
    switch (range) {
      case 'today':
        return { start: today, end: sql`(${today} + 1)` };
      case 'this_week':
        return { start: week, end: sql`(${week} + 7)` };
      case 'this_month':
        return { start: month, end: sql`(${month} + interval '1 month')::date` };
      case 'last_month':
        return { start: sql`(${month} - interval '1 month')::date`, end: month };
    }
  }
  const span = intervalOf(range);
  return last
    ? { start: sql`(${today} - ${span})::date`, end: sql`(${today} + 1)` }
    : { start: today, end: sql`((${today} + ${span})::date + 1)` };
}

/** A relative range as moments. Named ranges are whole local days; amounts run from or to now. */
function timeRange(clock: QueryClock, range: RelativeRange, last: boolean): Period {
  if (typeof range === 'string') {
    const days = dateRange(clock, range, last);
    const zone = clock.timeZone ?? 'UTC';
    return {
      start: sql`(${days.start}::timestamp at time zone ${zone})`,
      end: sql`(${days.end}::timestamp at time zone ${zone})`,
      endExclusive: true,
    };
  }
  const now = nowOf(clock);
  const span = intervalOf(range);
  // Months and years step in UTC, so the session's time zone never moves the bound.
  const shifted = (sign: string) => sql`(((${now}) at time zone 'UTC') ${sql.raw(sign)} ${span}) at time zone 'UTC'`;
  return last
    ? { start: shifted('-'), end: now, endExclusive: false }
    : { start: now, end: shifted('+'), endExclusive: false };
}

function relativeRange(condition: FilterCondition): { range: RelativeRange; last: boolean } {
  if (!('range' in condition)) invalid('Give the span of time.');
  return { range: condition.range, last: condition.operator === 'within_last' };
}

function within(column: SQL, period: Period): SQL {
  return sql`${column} >= ${period.start} and ${column} ${raw(period.endExclusive ? '<' : '<=')} ${period.end}`;
}

/** Before, after, within and within the last, on a timestamp column. */
function timeCondition(context: CompileContext, column: SQL, condition: FilterCondition): SQL | undefined {
  switch (condition.operator) {
    case 'before':
      return sql`${column} < ${timestampOperand(valueOf(condition))}::timestamptz`;
    case 'after':
      return sql`${column} > ${timestampOperand(valueOf(condition))}::timestamptz`;
    case 'within':
    case 'within_last': {
      const { range, last } = relativeRange(condition);
      return within(column, timeRange(context.clock, range, last));
    }
    default:
      return undefined;
  }
}

// ---- conditions -----------------------------------------------------------

/** Each negative operator and the positive one it is the NOT of. */
const NEGATIVES: Partial<Record<FilterCondition['operator'], FilterCondition['operator']>> = {
  is_not: 'is',
  does_not_contain: 'contains',
  neq: 'eq',
  contains_none_of: 'contains_any_of',
  is_empty: 'is_not_empty',
  is_not_checked: 'is_checked',
};

/** A condition as its positive form, and whether the result is negated. */
export function splitNegation(condition: FilterCondition): { positive: FilterCondition; negated: boolean } {
  const positive = NEGATIVES[condition.operator];
  if (positive === undefined) return { positive: condition, negated: false };
  return { positive: { ...condition, operator: positive } as FilterCondition, negated: true };
}

const fenceOf = (context: CompileContext) => (context.fence === true ? sql` offset 0` : sql``);

/** EXISTS over the attribute's current, non cleared value rows, with an extra condition on `v`. */
function valueExists(context: CompileContext, level: Level, attribute: AttributeDef, condition?: SQL): SQL {
  return sql`exists (select 1 from "values" v where v.workspace_id = ${raw(level.record)}.workspace_id and v.owner_id = ${ownerOf(level, attribute)} and v.attribute_id = ${attribute.id} and v.active_until is null and not v.is_cleared${
    condition === undefined ? sql`` : sql` and ${condition}`
  }${fenceOf(context)})`;
}

function relationshipOf(context: CompileContext, attribute: AttributeDef): RelationshipDef {
  const relationship =
    attribute.relationshipId === null ? undefined : context.relationships.get(attribute.relationshipId);
  if (relationship === undefined) invalid(`${attribute.title} has no relationship to follow.`);
  return relationship;
}

/** The link columns for one end of a relationship. */
function linkColumns(relationship: RelationshipDef, attributeId: string) {
  const isFrom = relationship.fromAttributeId === attributeId;
  return {
    mine: raw(isFrom ? 'from_record_id' : 'to_record_id'),
    far: raw(isFrom ? 'to_record_id' : 'from_record_id'),
    position: raw(isFrom ? 'position' : 'to_position'),
    allowed: isFrom ? relationship.toObjectIds : [relationship.fromObjectId],
  };
}

/**
 * EXISTS over a reference attribute's current links to live records, with a
 * condition on the far record (aliased `fN` for hop N). `farObjectId` narrows
 * a one way reference that may point at several objects.
 */
function hopExists(
  context: CompileContext,
  level: Level,
  attribute: AttributeDef,
  inner: (far: string) => SQL,
  farObjectId?: string,
  farIds?: readonly string[],
): SQL {
  const relationship = relationshipOf(context, attribute);
  const columns = linkColumns(relationship, attribute.id);
  const hop = level.hops + 1;
  const link = raw(`l${String(hop)}`);
  const far = `f${String(hop)}`;
  const narrow =
    farObjectId !== undefined && columns.allowed.length > 1 ? sql` and ${raw(far)}.object_id = ${farObjectId}` : sql``;
  // The search's far record ids, on the link itself, so the link index finds the few that point at them.
  const onLink = farIds === undefined ? sql`` : sql` and ${link}.${columns.far} = any(${uuidList(farIds)})`;
  return sql`exists (select 1 from record_links ${link} join records ${raw(far)} on ${raw(far)}.workspace_id = ${link}.workspace_id and ${raw(far)}.id = ${link}.${columns.far} and ${raw(far)}.deleted_at is null where ${link}.workspace_id = ${raw(level.record)}.workspace_id and ${link}.relationship_id = ${relationship.id} and ${link}.${columns.mine} = ${ownerOf(level, attribute)} and ${link}.active_until is null${narrow}${onLink} and ${inner(far)}${fenceOf(context)})`;
}

/** A `through` condition flattened: every hop's attribute, then the far condition. */
function flatten(condition: FilterCondition): { path: readonly string[]; leaf: FilterCondition } {
  if (condition.operator !== 'through') return { path: [], leaf: condition };
  const inner = flatten(condition.condition);
  return { path: [...condition.path, ...inner.path], leaf: inner.leaf };
}

function compileThrough(context: CompileContext, level: Level, condition: FilterCondition): SQL {
  const { path, leaf } = flatten(condition);
  if (path.length === 0 || level.hops + path.length > MAX_HOPS) {
    invalid(`Follow 1 to ${String(MAX_HOPS)} relationships in a filter.`);
  }
  if (leaf.operator === 'through') invalid('That filter path is not valid.');
  const { positive, negated } = splitNegation(leaf);
  if (positive.operator === 'through') invalid('That filter path is not valid.');
  const leafAttributeId = positive.attributeId;
  const walk = (at: Level, steps: readonly string[]): SQL => {
    const [first, ...rest] = steps;
    if (first === undefined) return compilePositive(context, at, positive);
    const hop = attributeFor(context, first);
    if (hop.type !== 'record_reference') invalid(`${hop.title} is not a relationship to follow.`);
    const nextId = rest[0] ?? leafAttributeId;
    const next = attributeFor(context, nextId);
    const allowed = linkColumns(relationshipOf(context, hop), hop.id).allowed;
    if (next.objectId === null || !allowed.includes(next.objectId)) {
      invalid(`${next.title} is not on the records ${hop.title} links to.`);
    }
    const objectId = next.objectId;
    // On the last hop, a search's far ids go on the link alone; the join to the far record already holds them.
    const farIds = rest.length === 0 ? searchHit(context, positive) : undefined;
    return hopExists(
      context,
      at,
      hop,
      (far) =>
        farIds === undefined
          ? walk({ row: far, record: far, objectId, listId: null, hops: at.hops + 1 }, rest)
          : sql`true`,
      objectId,
      farIds,
    );
  };
  const body = walk(level, path);
  return negated ? sql`not ${body}` : body;
}

/** A condition on a system attribute, read from the record's own columns. */
function systemCondition(
  context: CompileContext,
  level: Level,
  attribute: AttributeDef,
  condition: FilterCondition,
): SQL | undefined {
  const record = raw(level.record);
  if (condition.operator === 'is_not_empty') return sql`true`;
  switch (attribute.systemColumn) {
    case 'id':
      if (condition.operator === 'is') return sql`${record}.id = ${idOperand(valueOf(condition), 'a record')}::uuid`;
      if (condition.operator === 'is_any_of') {
        return inList(
          sql`${record}.id`,
          listOperand(condition, (value) => idOperand(value, 'a record')),
          'uuid',
        );
      }
      return undefined;
    case 'created_at':
    case 'updated_at':
      return timeCondition(context, sql`${record}.${raw(attribute.systemColumn)}`, condition);
    case 'created_by':
    case 'updated_by': {
      const prefix = attribute.systemColumn;
      const matchActor = (actor: Actor) =>
        sql`(${record}.${raw(`${prefix}_type`)} = ${actor.type} and ${record}.${raw(`${prefix}_id`)} is not distinct from ${actor.id}::uuid)`;
      if (condition.operator === 'is') return matchActor(actorOperand(valueOf(condition)));
      if (condition.operator === 'is_me') return matchActor(context.actor);
      if (condition.operator === 'is_any_of') {
        return sql`(${sql.join(listOperand(condition, actorOperand).map(matchActor), sql` or `)})`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

const TEXT_IS = new Set(['text', 'email', 'domain', 'url']);
const CONTAINS = new Set(['text', 'long_text', 'email', 'domain', 'url', 'personal_name', 'phone']);
const NUMBER_OPS = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=', at_least: '>=', at_most: '<=' } as const;

/**
 * For a number, rating or currency: the predicate on stored key row `k`
 * (int8 and C text comparisons, which are leakproof, so the key index serves
 * the filter under row level security). Undefined for anything else.
 */
function keyPredicate(attribute: AttributeDef, condition: FilterCondition): SQL | undefined {
  const { type } = attribute;
  const op = condition.operator;
  const number = (value: unknown) => sql`${scaled(numberOperand(value))}::bigint`;
  if (type === 'number' || type === 'rating') {
    const allowed = type === 'rating' ? ['at_least', 'at_most'] : ['eq', 'gt', 'gte', 'lt', 'lte'];
    if (allowed.includes(op) && op in NUMBER_OPS) {
      return sql`k.number_key ${raw(NUMBER_OPS[op as keyof typeof NUMBER_OPS])} ${number(valueOf(condition))}`;
    }
    if (op === 'between' && type === 'number' && 'from' in condition) {
      return sql`k.number_key between ${number(condition.from)} and ${number(condition.to)}`;
    }
    return undefined;
  }
  if (type === 'currency') {
    if (op === 'between' && 'from' in condition) {
      const from = currencyOperand(condition.from);
      const to = currencyOperand(condition.to);
      if (from.currency !== to.currency) invalid('Compare amounts within one currency.');
      return sql`k.code_key = ${from.currency} and k.number_key between ${number(from.amount)} and ${number(to.amount)}`;
    }
    if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(op)) {
      const operand = currencyOperand(valueOf(condition));
      return sql`k.code_key = ${operand.currency} and k.number_key ${raw(NUMBER_OPS[op as keyof typeof NUMBER_OPS])} ${number(operand.amount)}`;
    }
  }
  return undefined;
}

/** EXISTS over the attribute's live stored key row, with a condition on `k`. */
function keyExists(context: CompileContext, level: Level, attribute: AttributeDef, condition: SQL): SQL {
  return sql`exists (select 1 from sort_keys k where k.workspace_id = ${raw(level.record)}.workspace_id and k.owner_id = ${ownerOf(level, attribute)} and k.attribute_id = ${attribute.id} and k.live and ${condition}${fenceOf(context)})`;
}

/** The predicate on value row `v` for one positive operator, or undefined when the type doesn't offer it. */
function valuePredicate(context: CompileContext, attribute: AttributeDef, condition: FilterCondition): SQL | undefined {
  const { type } = attribute;
  const op = condition.operator;
  const json = (key: string) => sql`lower(v.json_value->>${key})`;
  if (op === 'contains' && CONTAINS.has(type)) {
    return sql`lower(left(v.text_value, 2048)) like ${containsPattern(valueOf(condition))}`;
  }
  switch (type) {
    case 'text':
    case 'email':
    case 'domain':
    case 'url':
      if (op === 'is' && TEXT_IS.has(type)) {
        return sql`${TEXT_KEY} = (lower(left(${operandText(valueOf(condition))}, 256)) collate "und-x-icu")`;
      }
      return undefined;
    case 'date':
      switch (op) {
        case 'is':
          return sql`v.date_value = ${dateOperand(valueOf(condition))}::date`;
        case 'before':
          return sql`v.date_value < ${dateOperand(valueOf(condition))}::date`;
        case 'after':
          return sql`v.date_value > ${dateOperand(valueOf(condition))}::date`;
        case 'within':
        case 'within_last': {
          const { range, last } = relativeRange(condition);
          const days = dateRange(context.clock, range, last);
          return within(sql`v.date_value`, { ...days, endExclusive: true });
        }
        default:
          return undefined;
      }
    case 'timestamp':
    case 'interaction':
      if (type === 'interaction' && op === 'kind_is')
        return sql`v.json_value->>'kind' = ${operandText(valueOf(condition))}`;
      return timeCondition(context, sql`v.timestamp_value`, condition);
    case 'checkbox':
      return op === 'is_checked' ? sql`v.bool_value` : undefined;
    case 'select':
    case 'status': {
      if (op === 'is') return sql`v.option_id = ${idOperand(valueOf(condition), 'an option')}::uuid`;
      if (op === 'is_any_of' || (op === 'contains_any_of' && attribute.isMulti)) {
        return inList(
          sql`v.option_id`,
          listOperand(condition, (value) => idOperand(value, 'an option')),
          'uuid',
        );
      }
      return undefined;
    }
    case 'phone':
      if (op === 'is') {
        const number =
          typeof valueOf(condition) === 'object'
            ? (valueOf(condition) as { number?: unknown }).number
            : valueOf(condition);
        return sql`v.text_value = ${operandText(number)}`;
      }
      if (op === 'country_is') return sql`upper(v.json_value->>'country') = upper(${operandText(valueOf(condition))})`;
      return undefined;
    case 'location':
      if (op === 'country_is') return sql`v.text_value = upper(${operandText(valueOf(condition))})`;
      if (op === 'locality_is') return sql`${json('locality')} = lower(${operandText(valueOf(condition))})`;
      if (op === 'region_is') return sql`${json('region')} = lower(${operandText(valueOf(condition))})`;
      return undefined;
    case 'personal_name':
      if (op === 'first_name_is') return sql`${json('firstName')} = lower(${operandText(valueOf(condition))})`;
      if (op === 'last_name_is') return sql`${json('lastName')} = lower(${operandText(valueOf(condition))})`;
      return undefined;
    case 'actor_reference': {
      const matchActor = (actor: Actor) =>
        sql`(v.actor_type = ${actor.type} and v.actor_id is not distinct from ${actor.id}::uuid)`;
      if (op === 'is') return matchActor(actorOperand(valueOf(condition)));
      if (op === 'is_me') return matchActor(context.actor);
      if (op === 'is_any_of')
        return sql`(${sql.join(listOperand(condition, actorOperand).map(matchActor), sql` or `)})`;
      return undefined;
    }
    case 'file':
      if (op === 'name_contains')
        return sql`lower(left(v.text_value, 2048)) like ${containsPattern(valueOf(condition))}`;
      if (op === 'has_files') return sql`true`;
      return undefined;
    default:
      return undefined;
  }
}

/** The search a contains (or its negative) would ask for, or undefined when the search function can't serve it. */
function searchTermOf(context: CompileContext, condition: FilterCondition): SearchTerm | undefined {
  if (condition.operator === 'through') return undefined;
  const { positive } = splitNegation(condition);
  if (positive.operator === 'through') return undefined;
  const attribute = context.attributes.get(positive.attributeId);
  if (attribute === undefined || attribute.systemColumn !== null) return undefined;
  const searchable =
    (positive.operator === 'contains' && CONTAINS.has(attribute.type)) ||
    (positive.operator === 'name_contains' && attribute.type === 'file');
  const value = valueOf(positive);
  if (!searchable || typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (text === '' || value.length > MAX_OPERAND || !TRIGRAM_RUN.test(text)) return undefined;
  return { attributeId: attribute.id, text };
}

/** The ids the search function found for a contains, when it found them all. */
function searchHit(context: CompileContext, condition: FilterCondition): readonly string[] | undefined {
  const term = searchTermOf(context, condition);
  return term === undefined ? undefined : context.searches?.get(searchKey(term));
}

/** A search worth running, and whether its answer alone can narrow the page (a direct contains under "and"s). */
export interface PlannedSearch extends SearchTerm {
  readonly narrows: boolean;
}

/**
 * The searches worth running for a filter, the ones that can narrow the page
 * first: positive contains reached from the top through "and"s (directly, or
 * at the end of a path), and the parts of an "or" made only of direct
 * positive contains. A negative or a contains beside other conditions in an
 * "or" is cheap row by row and gains nothing from the ids, so it isn't asked.
 */
export function searchTermsOf(context: CompileContext, group: FilterGroup | undefined): readonly PlannedSearch[] {
  const planned = new Map<string, PlannedSearch>();
  const add = (condition: FilterCondition, narrows: boolean) => {
    const leaf = flatten(condition).leaf;
    if (splitNegation(leaf).negated) return;
    const term = searchTermOf(context, leaf);
    if (term === undefined) return;
    const key = searchKey(term);
    planned.set(key, { ...term, narrows: narrows || (planned.get(key)?.narrows ?? false) });
  };
  const direct = (item: FilterCondition | FilterGroup): item is FilterCondition =>
    !('conjunction' in item) && item.operator !== 'through' && searchTermOf(context, item) !== undefined;
  const visit = (item: FilterCondition | FilterGroup): void => {
    if (!('conjunction' in item)) {
      add(item, item.operator !== 'through');
      return;
    }
    if (item.conjunction === 'and' || item.conditions.length === 1) {
      item.conditions.forEach(visit);
      return;
    }
    if (item.conditions.every(direct)) item.conditions.forEach((condition) => add(condition, false));
  };
  if (group !== undefined) visit(group);
  return [...planned.values()].sort((left, right) => Number(right.narrows) - Number(left.narrows));
}

/** True for a positive, direct (not through) contains the search function answered in full. */
function isSearchHit(context: CompileContext, item: FilterCondition | FilterGroup): boolean {
  return (
    !('conjunction' in item) &&
    item.operator !== 'through' &&
    !splitNegation(item).negated &&
    searchHit(context, item) !== undefined
  );
}

/**
 * True when every row the filter keeps must be among a search's few ids: an
 * "and" with a narrowed part, or an "or" whose parts are all narrowed, down to
 * a positive, direct contains the search function answered in full. Then the
 * page filters first instead of reading rows in sort order. A contains through
 * a relationship never narrows here: a few far records can link to very many.
 */
export function narrowedBySearch(context: CompileContext, group: FilterGroup | undefined): boolean {
  const narrows = (item: FilterCondition | FilterGroup): boolean => {
    if (!('conjunction' in item)) return isSearchHit(context, item);
    if (item.conditions.length === 0) return false;
    return item.conjunction === 'and' ? item.conditions.some(narrows) : item.conditions.every(narrows);
  };
  return group !== undefined && narrows(group);
}

/** One positive condition (no negative operator, no path) at a level. */
function compilePositive(context: CompileContext, level: Level, condition: FilterCondition): SQL {
  if (condition.operator === 'through') return compileThrough(context, level, condition);
  const attribute = attributeFor(context, condition.attributeId);
  const unsupported = () =>
    invalid(`A ${attribute.type.replaceAll('_', ' ')} attribute can't be filtered with "${condition.operator}".`);
  if (attribute.systemColumn !== null) {
    return systemCondition(context, level, attribute, condition) ?? unsupported();
  }
  if (attribute.type === 'record_reference') {
    if (condition.operator === 'is_not_empty') return hopExists(context, level, attribute, () => sql`true`);
    if (condition.operator === 'is' || condition.operator === 'is_any_of') {
      const ids =
        condition.operator === 'is'
          ? [idOperand(valueOf(condition), 'a record')]
          : listOperand(condition, (value) => idOperand(value, 'a record'));
      return hopExists(context, level, attribute, (far) => inList(sql`${raw(far)}.id`, ids, 'uuid'));
    }
    return unsupported();
  }
  if (condition.operator === 'is_not_empty') {
    if (attribute.type === 'checkbox') return unsupported();
    return valueExists(context, level, attribute);
  }
  // Contains all of: one EXISTS per option, all of them.
  if (condition.operator === 'contains_all_of' && attribute.type === 'select' && attribute.isMulti) {
    const ids = listOperand(condition, (value) => idOperand(value, 'an option'));
    return sql`(${sql.join(
      ids.map((id) => valueExists(context, level, attribute, sql`v.option_id = ${id}::uuid`)),
      sql` and `,
    )})`;
  }
  // A contains the search function answered in full: the owner is one of its ids.
  const found = searchHit(context, condition);
  if (found !== undefined) {
    // On a list's entries, a record attribute's ids go on the entry's own record column, which its index covers.
    const owner = ownerOf(level, attribute);
    const column = level.row !== level.record && attribute.listId === null ? sql`${raw(level.row)}.record_id` : owner;
    return sql`${column} = any(${uuidList(found)})`;
  }
  const onKey = keyPredicate(attribute, condition);
  if (onKey !== undefined) return keyExists(context, level, attribute, onKey);
  const predicate = valuePredicate(context, attribute, condition);
  return predicate === undefined ? unsupported() : valueExists(context, level, attribute, predicate);
}

function compileCondition(context: CompileContext, level: Level, condition: FilterCondition): SQL {
  if (condition.operator === 'through') return compileThrough(context, level, condition);
  const { positive, negated } = splitNegation(condition);
  const body = compilePositive(context, level, positive);
  return negated ? sql`not ${body}` : body;
}

function compileGroup(context: CompileContext, level: Level, group: FilterGroup): SQL {
  if (group.conditions.length === 0) return sql`true`;
  const parts = group.conditions.map((item) =>
    'conjunction' in item ? compileGroup(context, level, item) : compileCondition(context, level, item),
  );
  return sql`(${sql.join(parts, group.conjunction === 'and' ? sql` and ` : sql` or `)})`;
}

/**
 * A filter group as one SQL condition on the level's rows; an empty group
 * matches everything. The group is checked against its schema first (nesting
 * at most 3 deep, 1 to 100 values per list).
 */
export function compileFilter(context: CompileContext, level: Level, group: FilterGroup | undefined): SQL {
  if (group === undefined) return sql`true`;
  const parsed = FilterGroup.safeParse(group);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'That filter is not valid.');
  return compileGroup(context, level, parsed.data);
}

/** Every attribute id a filter or sort names, through paths included, for loading the catalog. */
export function attributeIdsOf(group: FilterGroup | undefined, sorts: readonly SortRule[]): readonly string[] {
  const ids = new Set(sorts.map((rule) => rule.attributeId));
  const visit = (item: FilterCondition | FilterGroup): void => {
    if ('conjunction' in item) {
      item.conditions.forEach(visit);
      return;
    }
    if (item.operator === 'through') {
      item.path.forEach((id) => ids.add(id));
      visit(item.condition);
      return;
    }
    ids.add(item.attributeId);
  };
  if (group !== undefined) visit(group);
  return [...ids].filter(isUuid);
}

// ---- sorts ----------------------------------------------------------------

/** How a sort key's text (in a cursor) turns back into its type. */
type KeyKind = 'text' | 'numeric' | 'date' | 'timestamptz' | 'boolean' | 'int' | 'bigint' | 'uuid';

/** One compiled sort key: how to select it, order by it, and compare a cursor value with it. */
export interface SortKey {
  readonly direction: SortRule['direction'];
  /** A lateral join that brings the key in, when it comes from value rows or links. */
  readonly join?: SQL;
  /** The key as an expression on the joined row (`kN.key`) or the record (`r.created_at`). */
  readonly expression: SQL;
  /** The key's type, for the cursor. */
  readonly kind: KeyKind;
  /** False for a column that is never empty (the system times and id), so ORDER BY can match its index. */
  readonly nullable?: boolean;
}

/** A lateral join over the attribute's position 0 value row, selecting `columns` (each aliased `key0`, `key1`). */
function valueJoin(level: Level, attribute: AttributeDef, alias: string, columns: readonly SQL[], extra?: SQL): SQL {
  const selected = sql.join(
    columns.map((column, index) => sql`${column} as ${raw(`key${String(index)}`)}`),
    sql`, `,
  );
  return sql`left join lateral (select ${selected} from "values" v${extra ?? sql``} where v.workspace_id = ${raw(level.record)}.workspace_id and v.owner_id = ${ownerOf(level, attribute)} and v.attribute_id = ${attribute.id} and v.position = 0 and v.active_until is null and not v.is_cleared) ${raw(alias)} on true`;
}

/** A lateral join over the attribute's live stored key row, selecting `columns` of `k` (each aliased `key0`, `key1`). */
function keyJoin(level: Level, attribute: AttributeDef, alias: string, columns: readonly SQL[]): SQL {
  const selected = sql.join(
    columns.map((column, index) => sql`${column} as ${raw(`key${String(index)}`)}`),
    sql`, `,
  );
  return sql`left join lateral (select ${selected} from sort_keys k where k.workspace_id = ${raw(level.record)}.workspace_id and k.owner_id = ${ownerOf(level, attribute)} and k.attribute_id = ${attribute.id} and k.live) ${raw(alias)} on true`;
}

function keysFrom(alias: string, direction: SortRule['direction'], kinds: readonly KeyKind[]): readonly SortKey[] {
  return kinds.map((kind, index) => ({
    direction,
    expression: sql`${raw(alias)}.${raw(`key${String(index)}`)}`,
    kind,
  }));
}

/**
 * Compiles the sorts, in order, each into one key or two (currency sorts by
 * code then amount, location by country then locality). Selects and statuses
 * sort by their options' order, references by the linked record's name and
 * members by name (best effort).
 */
export function compileSorts(context: CompileContext, level: Level, sorts: readonly SortRule[]): readonly SortKey[] {
  const parsed = SortRules.safeParse(sorts);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Those sorts are not valid.');
  return parsed.data.flatMap((rule, index): readonly SortKey[] => {
    const attribute = attributeFor(context, rule.attributeId);
    const alias = `k${String(index)}`;
    const { direction } = rule;
    const one = (join: SQL, kind: KeyKind) => [{ ...keysFrom(alias, direction, [kind])[0], join } as SortKey];
    const record = raw(level.record);
    ownerOf(level, attribute);
    switch (attribute.systemColumn) {
      case 'created_at':
      case 'updated_at':
        return [
          {
            direction,
            expression: sql`${record}.${raw(attribute.systemColumn)}`,
            kind: 'timestamptz',
            nullable: false,
          },
        ];
      case 'id':
        return [{ direction, expression: sql`${record}.id`, kind: 'uuid', nullable: false }];
      case 'created_by':
      case 'updated_by':
        return one(
          sql`left join lateral (select ${textKey(sql.raw('m.name'))} as key0 from members m where m.workspace_id = ${record}.workspace_id and m.id = ${record}.${raw(`${attribute.systemColumn}_member_id`)}) ${raw(alias)} on true`,
          'text',
        );
      default:
        break;
    }
    switch (attribute.type) {
      case 'text':
      case 'email':
      case 'domain':
      case 'url':
      case 'personal_name':
      case 'phone':
      case 'file':
        // The stored key: the same expression, from a narrow table that stays cached better than the history.
        return one(keyJoin(level, attribute, alias, [sql`k.text_key`]), 'text');
      // Numbers sort by their stored key (the value times 10,000), so every path's cursor holds the same text.
      case 'number':
      case 'rating':
        return one(keyJoin(level, attribute, alias, [sql`k.number_key`]), 'bigint');
      case 'currency':
        return [
          {
            ...keysFrom(alias, direction, ['text', 'bigint'])[0],
            join: keyJoin(level, attribute, alias, [sql`k.code_key`, sql`k.number_key`]),
          } as SortKey,
          ...keysFrom(alias, direction, ['text', 'bigint']).slice(1),
        ];
      case 'location':
        return [
          {
            ...keysFrom(alias, direction, ['text', 'text'])[0],
            join: valueJoin(level, attribute, alias, [
              sql`(v.text_value collate "C")`,
              textKey(sql.raw(`(v.json_value->>'locality')`)),
            ]),
          } as SortKey,
          ...keysFrom(alias, direction, ['text', 'text']).slice(1),
        ];
      case 'date':
        return one(valueJoin(level, attribute, alias, [sql`v.date_value`]), 'date');
      case 'timestamp':
      case 'interaction':
        return one(valueJoin(level, attribute, alias, [sql`v.timestamp_value`]), 'timestamptz');
      case 'checkbox':
        return one(valueJoin(level, attribute, alias, [sql`v.bool_value`]), 'boolean');
      case 'select':
      case 'status':
        return one(
          valueJoin(
            level,
            attribute,
            alias,
            [sql`o.position`],
            sql` join attribute_options o on o.workspace_id = v.workspace_id and o.id = v.option_id`,
          ),
          'int',
        );
      case 'actor_reference':
        return one(
          valueJoin(
            level,
            attribute,
            alias,
            [textKey(sql.raw('m.name'))],
            sql` left join members m on m.workspace_id = v.workspace_id and m.id = v.actor_member_id`,
          ),
          'text',
        );
      case 'record_reference': {
        const relationship = relationshipOf(context, attribute);
        const columns = linkColumns(relationship, attribute.id);
        return one(
          sql`left join lateral (select ${textKey(sql.raw('pv.text_value'))} as key0 from record_links sl join records fr on fr.workspace_id = sl.workspace_id and fr.id = sl.${columns.far} and fr.deleted_at is null join objects fo on fo.workspace_id = fr.workspace_id and fo.id = fr.object_id left join "values" pv on pv.workspace_id = fr.workspace_id and pv.owner_id = fr.id and pv.attribute_id = fo.primary_attribute_id and pv.position = 0 and pv.active_until is null and not pv.is_cleared where sl.workspace_id = ${record}.workspace_id and sl.relationship_id = ${relationship.id} and sl.${columns.mine} = ${ownerOf(level, attribute)} and sl.active_until is null order by sl.${columns.position}, sl.active_from, sl.id limit 1) ${raw(alias)} on true`,
          'text',
        );
      }
      default:
        return invalid(`A ${attribute.type.replaceAll('_', ' ')} attribute can't be sorted.`);
    }
  });
}

/** The direction the row id breaks ties in: the first sort's, so one index scan can serve both. */
export function tieDirection(keys: readonly SortKey[]): SortRule['direction'] {
  return keys[0]?.direction ?? 'ascending';
}

/** The ORDER BY for the keys: empties last in both directions, then the row id in the first sort's direction. */
export function orderBy(keys: readonly SortKey[], tie: SortRule['direction'] = tieDirection(keys)): SQL {
  const parts = keys.map(
    (key) =>
      sql`${key.expression} ${raw(key.direction === 'ascending' ? 'asc' : 'desc')}${raw(key.nullable === false ? '' : ' nulls last')}`,
  );
  return sql.join([...parts, sql`r.id ${raw(tie === 'ascending' ? 'asc' : 'desc')}`], sql`, `);
}

/** A key as text, for the cursor. */
export function keyText(key: SortKey): SQL {
  return sql`${key.expression}::text`;
}

/** The shape of each key kind's text, as Postgres writes it, so a tampered cursor is refused before the cast. */
const KEY_SHAPES: { readonly [K in Exclude<KeyKind, 'text' | 'uuid'>]: RegExp } = {
  numeric: /^-?\d{1,40}(\.\d{1,40})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  timestamptz: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/,
  boolean: /^(true|false)$/,
  int: /^-?\d{1,9}$/,
  bigint: /^-?\d{1,19}$/,
};

const INT8_MAX = 9_223_372_036_854_775_807n;

/** True for a real calendar day (no 30th of February), from text already in the date shape. */
function isCalendarDay(text: string): boolean {
  const [year = 0, month = 0, day = 0] = text.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True when text in a key's shape is also in its range, so the cast can't fail. */
function inRange(kind: KeyKind, value: string): boolean {
  switch (kind) {
    case 'bigint':
      return BigInt(value) <= INT8_MAX && BigInt(value) >= -INT8_MAX - 1n;
    case 'date':
      return isCalendarDay(value);
    case 'timestamptz': {
      const [hours = 99, minutes = 99, seconds = 99] = value.slice(11, 19).split(':').map(Number);
      return isCalendarDay(value) && hours < 24 && minutes < 60 && seconds < 60;
    }
    default:
      return true;
  }
}

/** A cursor's text for a key, turned back into the key's type. Refuses text that isn't that type's shape or range. */
export function fromText(key: SortKey, value: string): SQL {
  if (key.kind === 'text') return sql`${value}`;
  const fits = key.kind === 'uuid' ? isUuid(value) : KEY_SHAPES[key.kind].test(value) && inRange(key.kind, value);
  if (!fits) invalid('That page cursor is not valid. Start from the first page.');
  return sql`${value}::${raw(key.kind)}`;
}

/** Where a page starts: the previous page's last sort keys (as text, null for empty) and row id. */
export interface Cursor {
  readonly keys: readonly (string | null)[];
  readonly id: string;
}

/**
 * The rows after a cursor, as an expanded OR chain so mixed directions and
 * empty keys page correctly: for each key, every earlier key equal and this
 * one past the cursor, or every key equal and a later id (in the tie's direction). Empties sort last,
 * so nothing is "past" an empty key except later empties by id.
 */
export function afterCursor(
  keys: readonly SortKey[],
  cursor: Cursor,
  tieOrder: SortRule['direction'] = tieDirection(keys),
): SQL {
  if (cursor.keys.length !== keys.length) invalid('That page cursor belongs to a different sort.');
  if (!isUuid(cursor.id)) invalid('That page cursor is not valid. Start from the first page.');
  const equal = (index: number): SQL => {
    const key = keys[index];
    const value = cursor.keys[index];
    if (key === undefined) return sql`true`;
    return value === null || value === undefined
      ? sql`${key.expression} is null`
      : sql`${key.expression} = ${fromText(key, value)}`;
  };
  const past = (index: number): SQL | undefined => {
    const key = keys[index];
    const value = cursor.keys[index];
    if (key === undefined || value === null || value === undefined) return undefined;
    const op = raw(key.direction === 'ascending' ? '>' : '<');
    return sql`(${key.expression} ${op} ${fromText(key, value)} or ${key.expression} is null)`;
  };
  const branches: SQL[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const step = past(index);
    if (step === undefined) continue;
    const before = Array.from({ length: index }, (_, earlier) => equal(earlier));
    branches.push(sql`(${sql.join([...before, step], sql` and `)})`);
  }
  const allEqual = keys.map((_, index) => equal(index));
  const tie = raw(tieOrder === 'ascending' ? '>' : '<');
  branches.push(sql`(${sql.join([...allEqual, sql`r.id ${tie} ${cursor.id}::uuid`], sql` and `)})`);
  return sql`(${sql.join(branches, sql` or `)})`;
}

/**
 * When a view's first sort has stored keys (`sort_keys`), the page starts from
 * that attribute's key index instead of computing the key for every row:
 * `rows` reads the keys (aliased `d`, the row's id as `rowId`) in key order,
 * `source` joins them to the view's rows, and the rows with no value come
 * after, as their own branch (`empty`). Selects and statuses walk their
 * options in order, one index range each. Undefined when the first sort can't
 * drive (a linked record's or member's name, a location, a system column).
 */
export interface DrivingSort {
  /** Joins the keys to the view's rows `r` (aliased `d`). */
  readonly source: SQL;
  /** The keys on their own, as `from … where …` over `d`, for reading them in key order first. */
  readonly rows: SQL;
  /** The view's row id for a key row: `d.owner_id`, or the list entry `le.id` when the key is its record's. */
  readonly rowId: SQL;
  /** The sort's keys on `d`, one or two (currency sorts by code, then amount). */
  readonly keys: readonly SortKey[];
  /**
   * For a select or status: each option's own key rows (`from … where …` over
   * `d`), in option order, so a page can walk them one index range at a time.
   */
  readonly options?: readonly SQL[];
  /** For a select or status jump: each option's live key count, as `(id, n)` rows. */
  readonly optionCount?: (optionId: string) => SQL;
  /** True on rows that have no value for the first sort. */
  readonly empty: SQL;
  /** The same, kept a per row check (an OFFSET 0 fence), for reading rows in id order and stopping at the limit. */
  readonly emptyFenced: SQL;
  /** A per row check (fenced) that row `r`'s keys equal these key texts (an option's index, for a select). */
  readonly equals: (values: readonly string[]) => SQL;
  /** The same as a condition on the key row `d`, to read one group of equal keys from the key index. */
  readonly within: (values: readonly string[]) => SQL;
  /**
   * How many live rows have a value (exact, index only), so a position can
   * jump straight to its row by offset. Absent for a list sorted by its
   * record's attribute, whose rows aren't one per key.
   */
  readonly count?: SQL;
}

/** Each kind's stored key columns, in sort order. */
const STORED_KEYS: Partial<Record<AttributeDef['type'], readonly { column: string; kind: KeyKind }[]>> = {
  text: [{ column: 'text_key', kind: 'text' }],
  email: [{ column: 'text_key', kind: 'text' }],
  domain: [{ column: 'text_key', kind: 'text' }],
  url: [{ column: 'text_key', kind: 'text' }],
  personal_name: [{ column: 'text_key', kind: 'text' }],
  phone: [{ column: 'text_key', kind: 'text' }],
  file: [{ column: 'text_key', kind: 'text' }],
  number: [{ column: 'number_key', kind: 'bigint' }],
  rating: [{ column: 'number_key', kind: 'bigint' }],
  currency: [
    { column: 'code_key', kind: 'text' },
    { column: 'number_key', kind: 'bigint' },
  ],
  date: [{ column: 'date_key', kind: 'date' }],
  timestamp: [{ column: 'time_key', kind: 'timestamptz' }],
  interaction: [{ column: 'time_key', kind: 'timestamptz' }],
  checkbox: [{ column: 'bool_key', kind: 'boolean' }],
};

/** The driving form of a view's first sort, or undefined. `optionIds` are a select's or status's options in order. */
export function drivingSort(
  context: CompileContext,
  level: Level,
  rule: SortRule | undefined,
  optionIds: readonly string[],
): DrivingSort | undefined {
  if (rule === undefined) return undefined;
  const attribute = context.attributes.get(rule.attributeId);
  if (attribute === undefined || !hasSortKey(attribute)) return undefined;
  const isOption = attribute.type === 'select' || attribute.type === 'status';
  const stored = isOption ? [{ column: 'option_id', kind: 'uuid' as const }] : STORED_KEYS[attribute.type];
  if (stored === undefined || (isOption && optionIds.length === 0)) return undefined;
  // The row's own attribute (its owner is r.id), or, on a list, its record's (the owner is r.record_id).
  const own = level.listId === null ? attribute.objectId === level.objectId : attribute.listId === level.listId;
  const ofRecord = !own && level.listId !== null && attribute.objectId === level.objectId;
  if (!own && !ofRecord) return undefined;
  const owner = ofRecord ? sql`r.record_id` : sql`r.id`;
  const { direction } = rule;
  const held = (alias: string) =>
    sql`${raw(alias)}.attribute_id = ${attribute.id} and ${raw(alias)}.live and ${sql.join(
      stored.map((key) => sql`${raw(`${alias}.${key.column}`)} is not null`),
      sql` and `,
    )}`;
  const fromKeys = (condition: SQL) =>
    ofRecord
      ? sql`from sort_keys d join list_entries le on le.workspace_id = d.workspace_id and le.record_id = d.owner_id and le.list_id = ${level.listId} and le.deleted_at is null where ${condition}`
      : sql`from sort_keys d where ${condition}`;
  const noKey = (fence: SQL) =>
    sql`not exists (select 1 from sort_keys k where k.workspace_id = r.workspace_id and k.owner_id = ${owner} and k.attribute_id = ${attribute.id}${fence})`;
  const keyRow = (condition: SQL) =>
    sql`exists (select 1 from sort_keys k where k.workspace_id = r.workspace_id and k.owner_id = ${owner} and ${held('k')} and ${condition} offset 0)`;
  const base = {
    source: sql`join sort_keys d on d.workspace_id = r.workspace_id and d.owner_id = ${owner} and ${held('d')}`,
    rows: fromKeys(held('d')),
    rowId: ofRecord ? sql`le.id` : sql`d.owner_id`,
    empty: noKey(sql``),
    emptyFenced: noKey(sql` offset 0`),
    ...(ofRecord ? {} : { count: sql`select count(*)::int as n from sort_keys d where ${held('d')}` }),
  };
  const optionAt = (index: string | undefined) => {
    const optionId = optionIds[Number(index)];
    if (optionId === undefined) invalid('That page cursor is not valid. Start from the first page.');
    return optionId;
  };
  if (isOption) {
    return {
      ...base,
      // The walk compares option positions (0, 1, 2), so the key is the option's index in the walk.
      keys: [
        {
          direction,
          expression: sql`(array_position(${uuidArray(optionIds)}, d.option_id) - 1)`,
          kind: 'int',
          nullable: false,
        },
      ],
      options: optionIds.map((optionId) => fromKeys(sql`${held('d')} and d.option_id = ${optionId}::uuid`)),
      ...(ofRecord
        ? {}
        : {
            optionCount: (optionId: string) =>
              sql`select count(*)::int as n from sort_keys d where ${held('d')} and d.option_id = ${optionId}::uuid`,
          }),
      equals: (values) => keyRow(sql`k.option_id = ${optionAt(values[0])}::uuid`),
      within: (values) => sql`d.option_id = ${optionAt(values[0])}::uuid`,
    };
  }
  const keys = stored.map((key) => ({
    direction,
    expression: sql`${raw(`d.${key.column}`)}`,
    kind: key.kind,
    nullable: false,
  }));
  const equalTo = (alias: string, values: readonly string[]) =>
    sql.join(
      stored.map((key, index) => {
        const value = values[index];
        if (value === undefined) invalid('That page cursor is not valid. Start from the first page.');
        return sql`${raw(`${alias}.${key.column}`)} = ${fromText({ direction, expression: sql``, kind: key.kind }, value)}`;
      }),
      sql` and `,
    );
  return {
    ...base,
    keys,
    equals: (values) => keyRow(equalTo('k', values)),
    within: (values) => equalTo('d', values),
  };
}
