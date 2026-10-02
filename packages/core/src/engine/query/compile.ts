// Turns a saved filter and sort into SQL (spec 0004, AC-14). Every user value
// becomes a parameter; only fixed fragments are written into the SQL text.
// Milestone 1 covers the text operators, is empty, sorts on text and the
// system timestamps, and keyset paging; milestone 4 adds every other operator.
import { sql, type SQL } from 'drizzle-orm';
import type { FilterCondition, FilterGroup, SortRule } from '@crm/contracts/values';
import { refuse } from '../refusals.ts';
import type { AttributeDef } from '../values.ts';

/** Types whose `is` compares the text itself. */
const IS_TYPES = new Set(['text', 'email', 'domain', 'url']);
/** Types whose `contains` searches text. */
const CONTAINS_TYPES = new Set(['text', 'long_text', 'email', 'domain', 'url', 'personal_name', 'phone']);
/** Types a sort can order by their first item's text. */
const TEXT_SORT_TYPES = new Set(['text', 'email', 'domain', 'url', 'personal_name']);
/** System columns a sort can order by. */
const TIME_COLUMNS = { created_at: sql.raw('r.created_at'), updated_at: sql.raw('r.updated_at') } as const;

/** The longest text a condition may search for. */
const MAX_OPERAND = 500;

/** The sort and filter key of a text value row: its first 256 characters, lowercased, in the pinned collation. */
const TEXT_KEY = sql.raw(`(lower(left(v.text_value, 256)) collate "und-x-icu")`);

function invalid(message: string): never {
  throw refuse('FILTER_INVALID', message);
}

function attributeFor(attributes: ReadonlyMap<string, AttributeDef>, attributeId: string): AttributeDef {
  const attribute = attributes.get(attributeId);
  if (attribute === undefined) invalid('A filter or sort names an attribute that is not on this object.');
  return attribute;
}

function operandText(condition: FilterCondition): string {
  const value = 'value' in condition ? condition.value : undefined;
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_OPERAND) {
    invalid(`Give the text to compare, up to ${String(MAX_OPERAND)} characters.`);
  }
  return value.trim();
}

/** `value` with LIKE's wildcards escaped, so it matches literally. */
function likeLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/** An EXISTS over the attribute's current, non cleared value rows on record `r`, with an extra condition. */
function currentValueExists(attributeId: string, condition: SQL | undefined): SQL {
  return sql`exists (select 1 from "values" v where v.workspace_id = r.workspace_id and v.owner_id = r.id and v.attribute_id = ${attributeId} and v.active_until is null and not v.is_cleared${
    condition === undefined ? sql`` : sql` and ${condition}`
  })`;
}

function compileCondition(attributes: ReadonlyMap<string, AttributeDef>, condition: FilterCondition): SQL {
  if (condition.operator === 'through') invalid('Filters through relationships arrive with milestone 4.');
  const attribute = attributeFor(attributes, condition.attributeId);
  if (attribute.systemColumn !== null) invalid('Filters on system attributes arrive with milestone 4.');
  const { id, type } = attribute;
  switch (condition.operator) {
    case 'is':
    case 'is_not': {
      if (!IS_TYPES.has(type)) break;
      const match = currentValueExists(id, sql`${TEXT_KEY} = lower(left(${operandText(condition)}, 256))`);
      return condition.operator === 'is' ? match : sql`not ${match}`;
    }
    case 'contains':
    case 'does_not_contain': {
      if (!CONTAINS_TYPES.has(type)) break;
      const pattern = `%${likeLiteral(operandText(condition).toLowerCase())}%`;
      const match = currentValueExists(id, sql`lower(left(v.text_value, 2048)) like ${pattern}`);
      return condition.operator === 'contains' ? match : sql`not ${match}`;
    }
    case 'is_empty':
      return sql`not ${currentValueExists(id, undefined)}`;
    case 'is_not_empty':
      return currentValueExists(id, undefined);
    default:
      break;
  }
  return invalid(`A ${type.replaceAll('_', ' ')} attribute can't be filtered with "${condition.operator}" yet.`);
}

/** A filter group as one SQL condition on records aliased `r`; an empty group matches everything. */
export function compileFilter(attributes: ReadonlyMap<string, AttributeDef>, group: FilterGroup | undefined): SQL {
  if (group === undefined || group.conditions.length === 0) return sql`true`;
  const parts = group.conditions.map((item) =>
    'conjunction' in item ? compileFilter(attributes, item) : compileCondition(attributes, item),
  );
  return sql`(${sql.join(parts, group.conjunction === 'and' ? sql` and ` : sql` or `)})`;
}

/** One compiled sort key: how to select it, order by it, and compare a cursor value with it. */
export interface SortKey {
  readonly direction: SortRule['direction'];
  /** A lateral join that brings the key in, when it comes from value rows. */
  readonly join?: SQL;
  /** The key as an expression on the joined row (`kN.key`) or the record (`r.created_at`). */
  readonly expression: SQL;
  /** The key as text, for the cursor. */
  readonly asText: SQL;
  /** A cursor's text turned back into the key's type. */
  readonly fromText: (value: string) => SQL;
}

/** Compiles the sorts, each into a key, in order. */
export function compileSorts(
  attributes: ReadonlyMap<string, AttributeDef>,
  sorts: readonly SortRule[],
): readonly SortKey[] {
  return sorts.map((rule, index) => {
    const attribute = attributeFor(attributes, rule.attributeId);
    const column = attribute.systemColumn;
    if (column === 'created_at' || column === 'updated_at') {
      const expression = TIME_COLUMNS[column];
      return {
        direction: rule.direction,
        expression,
        asText: sql`${expression}::text`,
        fromText: (value: string) => sql`${value}::timestamptz`,
      };
    }
    if (column !== null || !TEXT_SORT_TYPES.has(attribute.type)) {
      invalid(`Sorting by a ${attribute.type.replaceAll('_', ' ')} attribute arrives with milestone 4.`);
    }
    const alias = sql.raw(`k${String(index)}`);
    return {
      direction: rule.direction,
      join: sql`left join lateral (select ${TEXT_KEY} as key from "values" v where v.workspace_id = r.workspace_id and v.owner_id = r.id and v.attribute_id = ${attribute.id} and v.position = 0 and v.active_until is null and not v.is_cleared) ${alias} on true`,
      expression: sql`${alias}.key`,
      asText: sql`${alias}.key::text`,
      fromText: (value: string) => sql`${value}`,
    };
  });
}

/** The ORDER BY for the keys: empties last in both directions, then the record id. */
export function orderBy(keys: readonly SortKey[]): SQL {
  const parts = keys.map(
    (key) => sql`${key.expression} ${sql.raw(key.direction === 'ascending' ? 'asc' : 'desc')} nulls last`,
  );
  return sql.join([...parts, sql`r.id asc`], sql`, `);
}

/** Where a page starts: the previous page's last sort keys (as text, null for empty) and record id. */
export interface Cursor {
  readonly keys: readonly (string | null)[];
  readonly id: string;
}

/**
 * The rows after a cursor, as an expanded OR chain so mixed directions and
 * empty keys page correctly: for each key, every earlier key equal and this
 * one past the cursor, or every key equal and a later id. Empties sort last,
 * so nothing is "past" an empty key except later empties by id.
 */
export function afterCursor(keys: readonly SortKey[], cursor: Cursor): SQL {
  if (cursor.keys.length !== keys.length) invalid('That page cursor belongs to a different sort.');
  const equal = (index: number): SQL => {
    const key = keys[index];
    const value = cursor.keys[index];
    if (key === undefined) return sql`true`;
    return value === null || value === undefined
      ? sql`${key.expression} is null`
      : sql`${key.expression} = ${key.fromText(value)}`;
  };
  const past = (index: number): SQL | undefined => {
    const key = keys[index];
    const value = cursor.keys[index];
    if (key === undefined || value === null || value === undefined) return undefined;
    const op = sql.raw(key.direction === 'ascending' ? '>' : '<');
    return sql`(${key.expression} ${op} ${key.fromText(value)} or ${key.expression} is null)`;
  };
  const branches: SQL[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const step = past(index);
    if (step === undefined) continue;
    const before = Array.from({ length: index }, (_, earlier) => equal(earlier));
    branches.push(sql`(${sql.join([...before, step], sql` and `)})`);
  }
  const allEqual = keys.map((_, index) => equal(index));
  branches.push(sql`(${sql.join([...allEqual, sql`r.id > ${cursor.id}::uuid`], sql` and `)})`);
  return sql`(${sql.join(branches, sql` or `)})`;
}
