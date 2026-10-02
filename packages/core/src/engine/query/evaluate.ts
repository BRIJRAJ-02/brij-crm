// The reference evaluator (spec 0004, AC-14): the same filters and sorts the
// compiler turns into SQL, worked out over plain objects. Tests run both on
// the same sample and expect the same ids in the same order, so the compiler
// can't quietly drift from what each operator means.
import type { FilterCondition, FilterGroup, SortRule } from '@crm/contracts/values';
import type { AttributeDef } from '../values.ts';

/** A record as the evaluator sees it: its id, its system times as Postgres text, and current values by attribute id. */
export interface PlainRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly values: Readonly<Record<string, unknown>>;
}

const collator = new Intl.Collator('und');

/** The text a value item contributes to text operators: the text itself, a person's full name, a phone number. */
function textOf(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    if ('fullName' in item && typeof item.fullName === 'string') return item.fullName;
    if ('number' in item && typeof item.number === 'string') return item.number;
  }
  return null;
}

function itemsOf(value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function key(text: string): string {
  return text.slice(0, 256).toLowerCase();
}

function matches(record: PlainRecord, condition: FilterCondition): boolean {
  if (condition.operator === 'through') throw new Error('Not in milestone 1.');
  const items = itemsOf(record.values[condition.attributeId]);
  const texts = items.map(textOf).filter((text): text is string => text !== null);
  const operand = 'value' in condition && typeof condition.value === 'string' ? condition.value.trim() : '';
  switch (condition.operator) {
    case 'is':
      return texts.some((text) => key(text) === key(operand));
    case 'is_not':
      return !texts.some((text) => key(text) === key(operand));
    case 'contains':
      return texts.some((text) => text.slice(0, 2048).toLowerCase().includes(operand.toLowerCase()));
    case 'does_not_contain':
      return !texts.some((text) => text.slice(0, 2048).toLowerCase().includes(operand.toLowerCase()));
    case 'is_empty':
      return items.length === 0;
    case 'is_not_empty':
      return items.length > 0;
    default:
      throw new Error(`The evaluator has no ${condition.operator} yet.`);
  }
}

function inGroup(attributes: ReadonlyMap<string, AttributeDef>, record: PlainRecord, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((item) =>
    'conjunction' in item ? inGroup(attributes, record, item) : matches(record, item),
  );
  return group.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean);
}

function sortKey(attributes: ReadonlyMap<string, AttributeDef>, record: PlainRecord, rule: SortRule): string | null {
  const attribute = attributes.get(rule.attributeId);
  if (attribute?.systemColumn === 'created_at') return record.createdAt;
  if (attribute?.systemColumn === 'updated_at') return record.updatedAt;
  const first = itemsOf(record.values[rule.attributeId])[0];
  const text = textOf(first);
  return text === null ? null : key(text);
}

/** The ids of the records that match, in the view's order: empties last in both directions, then by id. */
export function evaluate(
  attributes: ReadonlyMap<string, AttributeDef>,
  records: readonly PlainRecord[],
  filter: FilterGroup | undefined,
  sorts: readonly SortRule[],
): readonly string[] {
  const kept = records.filter((record) => filter === undefined || inGroup(attributes, record, filter));
  const keyed = kept.map((record) => ({ record, keys: sorts.map((rule) => sortKey(attributes, record, rule)) }));
  keyed.sort((a, b) => {
    for (const [index, rule] of sorts.entries()) {
      const x = a.keys[index] ?? null;
      const y = b.keys[index] ?? null;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      // System times are Postgres' own text (microseconds, one zone), which sorts as it reads.
      const isTime = attributes.get(rule.attributeId)?.systemColumn !== null;
      const order = isTime ? (x < y ? -1 : 1) : collator.compare(x, y);
      if (order !== 0) return rule.direction === 'ascending' ? order : -order;
    }
    return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
  });
  return keyed.map(({ record }) => record.id);
}
