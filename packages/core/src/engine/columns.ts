// How each attribute type's value maps onto value rows (spec 0004, the type
// mapping table): one row per item, each type in its own columns. Record
// references are the exception; they live in record_links (milestone 3).
import { toCanonicalDecimal, type AttributeType } from '@crm/contracts/values';
import type { Actor } from './scope.ts';

/** The value columns of one item row. Columns a type doesn't use stay null. */
export interface ItemColumns {
  readonly textValue: string | null;
  readonly numberValue: string | null;
  readonly dateValue: string | null;
  readonly timestampValue: string | null;
  readonly boolValue: boolean | null;
  readonly optionId: string | null;
  readonly actorType: Actor['type'] | null;
  readonly actorId: string | null;
  readonly jsonValue: unknown;
}

const EMPTY: ItemColumns = {
  textValue: null,
  numberValue: null,
  dateValue: null,
  timestampValue: null,
  boolValue: null,
  optionId: null,
  actorType: null,
  actorId: null,
  jsonValue: null,
};

/** The text like types: their value is the text itself. */
const TEXT_TYPES = new Set<AttributeType>(['text', 'long_text', 'email', 'domain', 'url']);

/** The types the engine stores as value rows (record references use links). */
export function isStoredAsValues(type: AttributeType): boolean {
  return type !== 'record_reference';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One item of a parsed value as the columns its row stores. */
function encodeItem(type: AttributeType, item: unknown): ItemColumns {
  if (TEXT_TYPES.has(type)) return { ...EMPTY, textValue: text(item) };
  const parts = asRecord(item);
  switch (type) {
    case 'number':
    case 'rating':
      return { ...EMPTY, numberValue: typeof item === 'number' ? String(item) : text(item) };
    case 'currency':
      return { ...EMPTY, numberValue: text(parts.amount), textValue: text(parts.currency) };
    case 'date':
      return { ...EMPTY, dateValue: text(item) };
    case 'timestamp':
      return { ...EMPTY, timestampValue: text(item) };
    case 'checkbox':
      return { ...EMPTY, boolValue: item === true };
    case 'select':
    case 'status':
      return { ...EMPTY, optionId: text(item) };
    case 'phone':
      return { ...EMPTY, textValue: text(parts.number), jsonValue: { country: parts.country } };
    case 'location':
      return { ...EMPTY, textValue: text(parts.countryCode), jsonValue: item };
    case 'personal_name':
      return {
        ...EMPTY,
        textValue: text(parts.fullName),
        jsonValue: { firstName: parts.firstName, lastName: parts.lastName },
      };
    case 'actor_reference':
      return { ...EMPTY, actorType: text(parts.type) as Actor['type'], actorId: text(parts.id) };
    case 'file':
      return { ...EMPTY, textValue: text(parts.name), jsonValue: item };
    case 'interaction':
      return { ...EMPTY, timestampValue: text(parts.at), jsonValue: item };
    default:
      throw new TypeError(`The ${type} type is not stored as value rows.`);
  }
}

/**
 * A parsed value as item rows, in order. `null` (cleared) is no items. A
 * checkbox stores only `true`: unchecked has no row (spec 0004).
 */
export function encodeValue(type: AttributeType, value: unknown): readonly ItemColumns[] {
  if (value === null || value === undefined) return [];
  if (type === 'checkbox' && value !== true) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item: unknown) => encodeItem(type, item));
}

/** One stored item row, as read back (dates and times already as ISO text). */
export type StoredItem = ItemColumns & { readonly position: number };

function decodeItem(type: AttributeType, row: StoredItem): unknown {
  if (TEXT_TYPES.has(type)) return row.textValue;
  const json = asRecord(row.jsonValue);
  switch (type) {
    case 'number':
      return row.numberValue === null ? null : (toCanonicalDecimal(row.numberValue) ?? row.numberValue);
    case 'rating':
      return row.numberValue === null ? null : Number(row.numberValue);
    case 'currency':
      return {
        amount: row.numberValue === null ? null : (toCanonicalDecimal(row.numberValue) ?? row.numberValue),
        currency: row.textValue,
      };
    case 'date':
      return row.dateValue;
    case 'timestamp':
      return row.timestampValue;
    case 'checkbox':
      return row.boolValue === true;
    case 'select':
    case 'status':
      return row.optionId;
    case 'phone':
      return { number: row.textValue, ...(json.country === undefined ? {} : { country: json.country }) };
    case 'location':
    case 'file':
    case 'interaction':
      return row.jsonValue;
    case 'personal_name':
      return {
        ...(json.firstName === undefined ? {} : { firstName: json.firstName }),
        ...(json.lastName === undefined ? {} : { lastName: json.lastName }),
        fullName: row.textValue,
      };
    case 'actor_reference':
      return { type: row.actorType, id: row.actorId };
    default:
      throw new TypeError(`The ${type} type is not stored as value rows.`);
  }
}

/**
 * The value item rows hold, in the shape its schema parses: a list for a
 * multi valued attribute, one value otherwise, `null` when there are none
 * (`false` for a checkbox).
 */
export function decodeValue(type: AttributeType, isMulti: boolean, rows: readonly StoredItem[]): unknown {
  if (type === 'checkbox') return rows.some((row) => row.boolValue === true);
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  if (isMulti) return sorted.map((row) => decodeItem(type, row));
  const [first] = sorted;
  return first === undefined ? null : decodeItem(type, first);
}

/** True when two encodings hold the same value, so a write can be skipped. */
export function sameItems(a: readonly ItemColumns[], b: readonly ItemColumns[]): boolean {
  return stableText(a.map(normalised)) === stableText(b.map(normalised));
}

/** JSON with object keys in order, so jsonb's own key order never makes equal values differ. */
function stableText(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableText(item)}`).join(',')}}`;
}

function normalised(item: ItemColumns): ItemColumns {
  return {
    ...item,
    numberValue: item.numberValue === null ? null : (toCanonicalDecimal(item.numberValue) ?? item.numberValue),
  };
}
