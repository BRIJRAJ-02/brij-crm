// Bulk edit operations (spec 0022, AC-529): which attributes a bulk edit may
// change, which operations each type takes, and the one pure function that
// computes a record's new value from its current one. The engine runs it
// under each record's lock and the browser runs the same function on the rows
// it holds, so both agree. No Zod and no imports: it sits in the first load.

/** Every operation a bulk edit names. */
export const BULK_OPS = ['set', 'clear', 'add', 'remove', 'replace'] as const;

/** One bulk edit operation: Set or Clear a single value; Add, Remove, Replace or Clear a list. */
export type BulkOp = (typeof BULK_OPS)[number];

/** The parts of an attribute the bulk edit rules read: its definition as any screen or the engine holds it. */
export interface BulkAttribute {
  readonly type: string;
  readonly isMulti: boolean;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly isSystem: boolean;
  readonly isPrimary: boolean;
  readonly isArchived: boolean;
  /** Set when the reader may only read its values (a field rule, spec 0009). */
  readonly isReadOnly?: boolean;
}

/**
 * The types a bulk edit never offers in v1 (spec 0022): files, interactions
 * and system only timestamps, and record references (owner decision 3, which
 * waits for spec 0014's link deltas in batches).
 */
const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['file', 'interaction', 'timestamp', 'record_reference']);

/** The types that hold a list when the attribute allows several values. */
const LIST_TYPES: ReadonlySet<string> = new Set(['select', 'email', 'phone', 'domain', 'url', 'actor_reference']);

/** Why an attribute is left out of bulk edit, or undefined when it may be edited. */
export type BulkExclusion = 'primary' | 'system' | 'archived' | 'read-only' | 'type';

/**
 * Why the edit dialog leaves an attribute out (AC-529): the primary
 * attribute, a system one, an archived one, one the reader may only read, or
 * a type bulk edit doesn't take. Undefined for an attribute it offers.
 */
export function bulkExclusion(attribute: BulkAttribute): BulkExclusion | undefined {
  if (attribute.isPrimary) return 'primary';
  if (attribute.isSystem) return 'system';
  if (attribute.isArchived) return 'archived';
  if (attribute.isReadOnly === true) return 'read-only';
  if (EXCLUDED_TYPES.has(attribute.type)) return 'type';
  return undefined;
}

/** Whether the attribute holds a list (a multi select, several emails, several members). */
export function holdsList(attribute: Pick<BulkAttribute, 'type' | 'isMulti'>): boolean {
  return attribute.isMulti && LIST_TYPES.has(attribute.type);
}

/**
 * The operations a bulk edit offers for an attribute, in the order the dialog
 * shows them: a checkbox is Set only (checked or unchecked, never empty); a
 * list takes Add, Remove, Replace and Clear; any other value Set and Clear.
 * Clear is left out on a required attribute. Empty for an excluded attribute.
 */
export function bulkOpsFor(attribute: BulkAttribute): readonly BulkOp[] {
  if (bulkExclusion(attribute) !== undefined) return [];
  if (attribute.type === 'checkbox') return ['set'];
  const ops: readonly BulkOp[] = holdsList(attribute) ? ['add', 'remove', 'replace', 'clear'] : ['set', 'clear'];
  return attribute.isRequired ? ops.filter((op) => op !== 'clear') : ops;
}

/** Whether an operation takes a value (every one but Clear). */
export function opTakesValue(op: BulkOp): boolean {
  return op !== 'clear';
}

/** A value's identity, ignoring object key order, so `{ number, country }` and its reordered twin compare equal. */
function identityOf(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(identityOf).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${identityOf(item)}`).join(',')}}`;
}

/** A value as a list of items: a list as it is, one value as a list of one, empty as none. */
function itemsOf(value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A record's new value for one attribute (spec 0022, value sourcing): Set
 * and Replace give `value`; Clear gives empty (`false` for a checkbox); Add
 * keeps the existing items in their order, then the new ones not already
 * there; Remove keeps the existing items minus those given. A list left with
 * nothing is empty (`null`). Pure: the engine runs it under each record's
 * lock, the browser on the rows it holds.
 */
export function applyOp(
  attribute: Pick<BulkAttribute, 'type' | 'isMulti'>,
  op: BulkOp,
  current: unknown,
  value: unknown,
): unknown {
  if (op === 'clear') return attribute.type === 'checkbox' ? false : null;
  if (op === 'set' || op === 'replace') return value ?? (attribute.type === 'checkbox' ? false : null);
  const held = itemsOf(current);
  const given = itemsOf(value);
  if (op === 'add') {
    const seen = new Set(held.map(identityOf));
    const added: unknown[] = [];
    for (const item of given) {
      const key = identityOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(item);
    }
    const next = [...held, ...added];
    return next.length === 0 ? null : next;
  }
  const gone = new Set(given.map(identityOf));
  const kept = held.filter((item) => !gone.has(identityOf(item)));
  return kept.length === 0 ? null : kept;
}

/** Whether two values are the same for a bulk edit: an unchanged record writes nothing (AC-540). */
export function sameBulkValue(a: unknown, b: unknown): boolean {
  const empty = (value: unknown) =>
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty(a) && empty(b)) return true;
  return identityOf(a) === identityOf(b);
}
