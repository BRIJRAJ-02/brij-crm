// Bulk edit (spec 0022, milestone 2): one attribute of many records of one
// object, changed by one operation (Set, Clear, Add, Remove, Replace). Each
// record's new value is computed from its current value under its lock by
// `applyOp` from `@crm/contracts`, the same function the browser runs on the
// rows it holds, then written through the engine's own record write
// (`updateRecord`), so value history, rules, unique holds and the change event
// are exactly a single edit's. A bulk edit names no base version, so it
// replaces values with no "your value was replaced" notice. An unchanged
// record writes nothing and answers no `before`, so a retried edit changes
// nothing twice (AC-540).
//
// Locks follow one order for every caller: the records in id order, then the
// workspace counter row last, as every write takes it.
import { sql } from 'drizzle-orm';
import { applyOp, bulkExclusion, bulkOpsFor, holdsList, opTakesValue, type BulkOp } from '@crm/contracts/bulk-ops';
import type { EngineRefusal } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { decodeValue, encodeValue, sameItems } from './columns.ts';
import { checkId, uuidArray } from './ids.ts';
import { updateRecord } from './records.ts';
import { refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';
import { MAX_INLINE_RECORDS, TOO_MANY_INLINE } from './trash.ts';
import { currentItems, isArchivedNow, loadAttributes, parseFor, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { fieldReadOnlyReason, isOpen } from '../access/policy.ts';
import { attributeLevel, checkObject, UNKNOWN_OBJECT, visibleRecords } from '../access/visibility.ts';

/** What a bulk edit changes: the attribute, the operation, and its value (absent for Clear). */
export interface BulkEditChange {
  readonly attributeId: string;
  readonly op: BulkOp;
  readonly value?: unknown;
}

/** A bulk edit: records of one object, and the change. */
export interface BulkEditInput {
  readonly objectId: string;
  readonly recordIds: readonly string[];
  readonly edit: BulkEditChange;
  /** The writer's time zone, for a rule's relative dates (spec 0013); UTC when absent. */
  readonly timeZone?: string | undefined;
}

/**
 * One record's outcome: changed (with the value read under its lock before
 * the write and the version it made), unchanged (its value already was the
 * result, so nothing was written), or refused with why.
 */
export type BulkEditOutcome =
  | { readonly recordId: string; readonly state: 'changed'; readonly before: unknown; readonly versionId: string }
  | { readonly recordId: string; readonly state: 'unchanged' }
  | { readonly recordId: string; readonly state: 'refused'; readonly refusals: readonly EngineRefusal[] };

/** What naming an attribute the principal can't see, or that isn't the object's, answers. */
const UNKNOWN_ATTRIBUTE = 'That attribute does not exist.';

/** What a record that isn't there (or is hidden, or of another object) answers. */
const UNKNOWN = 'That record does not exist.';

/** What a record in the trash answers. */
const TRASHED = 'That record is in the trash. Restore it first.';

/** The words of a refused bulk edit (AC-529). */
export const BULK_EDIT_WORDS = {
  excluded: (title: string) => `${title} can’t be changed in bulk.`,
  required: (title: string) => `${title} is required, so it can’t be cleared.`,
  wrongOp: (title: string) => `${title} doesn’t take that change.`,
  unique: (title: string) => `${title} is unique, so several records can’t share one value.`,
  noValue: (title: string) => `Give ${title} a value.`,
} as const;

/** The object's primary attribute id, or undefined when it has none. */
async function primaryOf(tx: WorkspaceTx, objectId: string): Promise<string | undefined> {
  const rows = await tx.execute<{ id: string | null }>(
    sql`select primary_attribute_id::text as id from objects where id = ${objectId}::uuid`,
  );
  return rows.rows[0]?.id ?? undefined;
}

/**
 * Checks a bulk edit before any record is touched (AC-529, AC-538): the
 * object at `write` (403 `FORBIDDEN` on one the principal may only read),
 * the attribute on it and visible (`NOT_FOUND`), the field at `write` (403
 * `ATTRIBUTE_READ_ONLY`), not excluded, the operation one its type takes,
 * Set on a unique attribute for at most one record, Clear never on a
 * required one (each 422 `CONFIG_INVALID`), and the value by its type's
 * schema (`ATTRIBUTE_VALUE_INVALID`). Answers the attribute and the value,
 * parsed.
 */
export async function checkBulkEdit(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  change: BulkEditChange,
  count: number,
): Promise<{ readonly attribute: AttributeDef; readonly value: unknown }> {
  await checkObject(tx, scope.access, objectId, 'read');
  await checkObject(tx, scope.access, objectId, 'write');
  const attributeId = checkId(change.attributeId, UNKNOWN_ATTRIBUTE);
  const attribute = (await loadAttributes(tx, objectId)).get(attributeId);
  const level = attribute === undefined || isOpen(scope.access) ? 'write' : attributeLevel(scope.access, attribute);
  if (attribute === undefined || level === 'hidden') throw refuse('NOT_FOUND', UNKNOWN_ATTRIBUTE);
  if (level === 'read') throw refuse('ATTRIBUTE_READ_ONLY', fieldReadOnlyReason(attribute.title), attribute.id);
  return {
    attribute,
    value: checkBulkChange(attribute, attribute.id === (await primaryOf(tx, objectId)), change, count),
  };
}

/**
 * The attribute's own checks of a bulk edit (AC-529), shared by records and a
 * list's entries: not excluded, an operation its type takes, Set on a unique
 * attribute for at most one owner, Clear never on a required one (each 422
 * `CONFIG_INVALID`), and the value by its type's schema
 * (`ATTRIBUTE_VALUE_INVALID`). Answers the value, parsed.
 */
export function checkBulkChange(
  attribute: AttributeDef,
  isPrimary: boolean,
  change: BulkEditChange,
  count: number,
): unknown {
  const rules = {
    type: attribute.type,
    isMulti: attribute.isMulti,
    isRequired: attribute.isRequired,
    isUnique: attribute.isUnique,
    isSystem: attribute.isSystem,
    isPrimary,
    isArchived: isArchivedNow(attribute),
  };
  if (bulkExclusion(rules) !== undefined) throw refuse('CONFIG_INVALID', BULK_EDIT_WORDS.excluded(attribute.title));
  if (!bulkOpsFor(rules).includes(change.op)) {
    throw refuse(
      'CONFIG_INVALID',
      change.op === 'clear' && attribute.isRequired
        ? BULK_EDIT_WORDS.required(attribute.title)
        : BULK_EDIT_WORDS.wrongOp(attribute.title),
      attribute.id,
    );
  }
  if (attribute.isUnique && change.op === 'set' && count > 1) {
    throw refuse('CONFIG_INVALID', BULK_EDIT_WORDS.unique(attribute.title), attribute.id);
  }
  if (!opTakesValue(change.op)) return null;
  if (change.value === undefined || change.value === null) {
    // A checkbox's Set says checked or unchecked; anything else needs a value (Clear empties it).
    if (attribute.type !== 'checkbox')
      throw refuse('ATTRIBUTE_VALUE_INVALID', BULK_EDIT_WORDS.noValue(attribute.title));
  }
  // Add and Remove name items of a list: checked as a list of them, as Replace's value is.
  const given =
    holdsList(attribute) && !Array.isArray(change.value) && change.value !== undefined && change.value !== null
      ? [change.value]
      : change.value;
  return parseFor(attribute, given ?? (attribute.type === 'checkbox' ? false : null));
}

/**
 * A bulk edit inside a write (the inline call's, or one batch of a job's):
 * checks the change, locks the records in id order, reads their current
 * values under the locks, and writes each changed record through
 * `updateRecord` in its own savepoint, so one refused record never stops the
 * rest. Answers each record in the order asked.
 */
export async function updateManyIn(context: WriteContext, input: BulkEditInput): Promise<readonly BulkEditOutcome[]> {
  const { tx, scope } = context;
  const objectId = checkId(input.objectId, UNKNOWN_OBJECT);
  const ids = [...new Set(input.recordIds.map((id) => checkId(id, UNKNOWN)))];
  const { attribute, value } = await checkBulkEdit(tx, scope, objectId, input.edit, ids.length);
  if (ids.length === 0) return [];
  // One order for every caller, so two bulk edits (or an edit and a delete) over the same records never deadlock.
  const locked = await tx.execute<{ id: string; deleted: boolean }>(sql`
    select id::text, deleted_at is not null as deleted from records
    where object_id = ${objectId}::uuid and id = any(${uuidArray(ids)})
    order by id for no key update
  `);
  const visible = await visibleRecords(
    tx,
    scope.access,
    locked.rows.map((row) => ({ objectId, recordId: row.id })),
  );
  const rows = new Map(locked.rows.filter((row) => visible.has(row.id)).map((row) => [row.id, row]));
  const live = [...rows.values()].filter((row) => !row.deleted).map((row) => row.id);
  // Every live record's current value, read once under the locks just taken.
  const items = await currentItems(tx, live, [attribute.id]);
  const byRecord = new Map<string, (typeof items)[number][]>();
  for (const item of items) byRecord.set(item.ownerId, [...(byRecord.get(item.ownerId) ?? []), item]);
  const outcomes = new Map<string, BulkEditOutcome>();
  for (const recordId of live) {
    const current = decodeValue(attribute.type, attribute.isMulti, byRecord.get(recordId) ?? []);
    const next = applyOp(attribute, input.edit.op, current, value);
    if (sameItems(encodeValue(attribute.type, current), encodeValue(attribute.type, next))) {
      outcomes.set(recordId, { recordId, state: 'unchanged' });
      continue;
    }
    const written = await context.perRecord((child) =>
      updateRecord(
        child,
        {
          recordId,
          values: { [attribute.id]: { value: next } },
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        visible,
      ),
    );
    if (!written.ok) {
      outcomes.set(recordId, { recordId, state: 'refused', refusals: written.refusals });
      continue;
    }
    const versionId = written.value[attribute.id]?.versionId;
    outcomes.set(
      recordId,
      versionId === undefined
        ? { recordId, state: 'unchanged' }
        : { recordId, state: 'changed', before: current, versionId },
    );
  }
  return ids.map(
    (recordId): BulkEditOutcome =>
      outcomes.get(recordId) ?? {
        recordId,
        state: 'refused',
        refusals: [
          rows.get(recordId)?.deleted === true
            ? { code: 'RECORD_DELETED', message: TRASHED }
            : { code: 'NOT_FOUND', message: UNKNOWN },
        ],
      },
  );
}

/**
 * Edits one attribute of up to 500 records of one object in one write (spec
 * 0022, AC-530): refusals as `checkBulkEdit`, more than 500 records 422
 * `CONFIG_INVALID`; then each record changed, unchanged or refused on its own
 * (`updateManyIn`). One outbox row per object, as for any write.
 */
export async function updateMany(
  scope: EngineScope,
  input: BulkEditInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{
  readonly outcomes: readonly BulkEditOutcome[];
  readonly attributes: ReadonlyMap<string, ReadonlyMap<string, AttributeDef>>;
}> {
  if (input.recordIds.length === 0) throw refuse('CONFIG_INVALID', 'Choose at least one record.');
  if (new Set(input.recordIds).size > MAX_INLINE_RECORDS) throw refuse('CONFIG_INVALID', TOO_MANY_INLINE);
  const objectId = checkId(input.objectId, UNKNOWN_OBJECT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const outcomes = await updateManyIn(context, input);
      return { outcomes, attributes: new Map([[objectId, await loadAttributes(context.tx, objectId)]]) };
    },
    hooks,
  );
  return result;
}
