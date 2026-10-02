// Writing and reading one attribute's value (spec 0004, the write protocol):
// the owner row is locked first, an unchanged value writes nothing, and a new
// version's time never runs before the one it replaces.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { parseAttributeValue, type AttributeType } from '@crm/contracts/values';
import { encodeValue, sameItems, type ItemColumns, type StoredItem } from './columns.ts';
import { refuse } from './refusals.ts';
import { actorRow, type Actor } from './scope.ts';
import type { ValueChange, WriteContext } from './write.ts';

const { attributes, records, values } = schema;

/** The parts of an attribute definition the write and read paths need. */
export interface AttributeDef {
  readonly id: string;
  readonly objectId: string | null;
  readonly listId: string | null;
  readonly apiSlug: string;
  readonly title: string;
  readonly type: AttributeType;
  readonly isMulti: boolean;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly isSystem: boolean;
  readonly systemColumn: 'id' | 'created_at' | 'created_by' | 'updated_at' | 'updated_by' | null;
  readonly archivedAt: Date | null;
}

/** Every attribute of one object, by id. */
export async function loadAttributes(tx: WorkspaceTx, objectId: string): Promise<ReadonlyMap<string, AttributeDef>> {
  const rows = await tx
    .select({
      id: attributes.id,
      objectId: attributes.objectId,
      listId: attributes.listId,
      apiSlug: attributes.apiSlug,
      title: attributes.title,
      type: attributes.type,
      isMulti: attributes.isMulti,
      isRequired: attributes.isRequired,
      isUnique: attributes.isUnique,
      isSystem: attributes.isSystem,
      systemColumn: attributes.systemColumn,
      archivedAt: attributes.archivedAt,
    })
    .from(attributes)
    .where(eq(attributes.objectId, objectId));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Locks a live record's row for the rest of the transaction, so a delete, a
 * restore and every value write on it take turns. Refuses a missing or
 * deleted record.
 */
export async function lockRecord(tx: WorkspaceTx, recordId: string): Promise<{ objectId: string }> {
  const rows = await tx
    .select({ objectId: records.objectId, deletedAt: records.deletedAt })
    .from(records)
    .where(eq(records.id, recordId))
    .for('update');
  const [row] = rows;
  if (row === undefined) throw refuse('NOT_FOUND', 'That record does not exist.');
  if (row.deletedAt !== null) throw refuse('RECORD_DELETED', 'That record is in the trash. Restore it first.');
  return { objectId: row.objectId };
}

/** The columns read back for an item row: dates and times as the ISO text the schemas use. */
export const ITEM_COLUMNS = {
  position: values.position,
  textValue: values.textValue,
  numberValue: sql<string | null>`${values.numberValue}::text`,
  dateValue: sql<string | null>`${values.dateValue}::text`,
  timestampValue: sql<
    string | null
  >`to_char(${values.timestampValue} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  boolValue: values.boolValue,
  optionId: values.optionId,
  actorType: values.actorType,
  actorId: values.actorId,
  jsonValue: values.jsonValue,
} as const;

/** The current item rows of one attribute on one owner, cleared markers included. */
async function currentRows(tx: WorkspaceTx, ownerId: string, attributeId: string) {
  return tx
    .select({
      ...ITEM_COLUMNS,
      versionId: values.versionId,
      isCleared: values.isCleared,
      setByType: values.setByType,
      setById: values.setById,
    })
    .from(values)
    .where(and(eq(values.ownerId, ownerId), eq(values.attributeId, attributeId), isNull(values.activeUntil)))
    .orderBy(values.position);
}

/** What one attribute should become on one owner. */
export interface AttributeWrite {
  readonly ownerId: string;
  readonly ownerKind: 'record' | 'entry';
  readonly attribute: AttributeDef;
  /** The new value as the caller gave it; parsed here by the attribute's schema. */
  readonly value: unknown;
  /** The version the caller's edit started from, to report a replaced save (AC-12). */
  readonly baseVersionId?: string;
}

/** Parses a value for an attribute, or refuses it naming the attribute. */
export function parseFor(attribute: AttributeDef, input: unknown): unknown {
  if (attribute.isSystem) {
    throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title} is set by the system.`, attribute.id);
  }
  if (attribute.archivedAt !== null) {
    throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title} is archived. Restore it to change it.`, attribute.id);
  }
  const parsed = parseAttributeValue(attribute.type, input, { allowMultiple: attribute.isMulti });
  if (!parsed.ok) throw refuse(parsed.error.code, parsed.error.message, attribute.id);
  return parsed.value;
}

/**
 * Writes one attribute's value by the protocol: the owner is already locked by
 * the caller. An unchanged value writes nothing and returns undefined.
 * Otherwise the current rows end at `t` and the new rows (or a cleared marker)
 * start at `t`, all under one new version id.
 */
export async function writeAttribute(context: WriteContext, write: AttributeWrite): Promise<ValueChange | undefined> {
  const { tx, scope } = context;
  const { attribute, ownerId } = write;
  const parsed = parseFor(attribute, write.value);
  const next = encodeValue(attribute.type, parsed);

  const current = await currentRows(tx, ownerId, attribute.id);
  const held: readonly ItemColumns[] = current
    .filter((row) => !row.isCleared)
    .map((row) => ({
      textValue: row.textValue,
      numberValue: row.numberValue,
      dateValue: row.dateValue,
      timestampValue: row.timestampValue,
      boolValue: row.boolValue,
      optionId: row.optionId,
      actorType: row.actorType,
      actorId: row.actorId,
      jsonValue: row.jsonValue,
    }));
  if (sameItems(held, next)) return undefined;

  const stamp = await tx.execute<{ t: string; version: string }>(sql`
    select greatest(
      clock_timestamp(),
      coalesce(max(${values.activeFrom}) + interval '1 microsecond', clock_timestamp())
    )::text as t, uuidv7()::text as version
    from ${values}
    where ${values.ownerId} = ${ownerId} and ${values.attributeId} = ${attribute.id} and ${values.activeUntil} is null
  `);
  const [first] = stamp.rows;
  if (first === undefined) throw new Error('Could not stamp the new version.');
  const at = sql`${first.t}::timestamptz`;

  if (current.length > 0) {
    await tx
      .update(values)
      .set({ activeUntil: sql`${at}` })
      .where(and(eq(values.ownerId, ownerId), eq(values.attributeId, attribute.id), isNull(values.activeUntil)));
  }

  const setBy = actorRow(scope.actor);
  const owner = write.ownerKind === 'record' ? { recordId: ownerId } : { entryId: ownerId };
  const base = {
    workspaceId: scope.workspaceId,
    versionId: first.version,
    attributeId: attribute.id,
    ownerId,
    ...owner,
    activeFrom: sql`${at}`,
    setByType: setBy.type,
    setById: setBy.id,
    setByMemberId: setBy.memberId,
  };
  const rows =
    next.length === 0
      ? [{ ...base, position: 0, isCleared: true }]
      : next.map((item, position) => ({ ...base, ...itemInsert(item), position }));
  await tx.insert(values).values(rows);

  const before = current[0];
  const replaced =
    write.baseVersionId !== undefined && before !== undefined && before.versionId !== write.baseVersionId
      ? { versionId: before.versionId, setBy: { type: before.setByType, id: before.setById } satisfies Actor }
      : undefined;
  return {
    ownerId,
    ownerKind: write.ownerKind,
    attributeId: attribute.id,
    versionId: first.version,
    ...(replaced === undefined ? {} : { replaced }),
  };
}

/** One item's columns as an insert, with the member foreign key column for an actor value. */
function itemInsert(item: ItemColumns) {
  return {
    textValue: item.textValue,
    numberValue: item.numberValue,
    dateValue: item.dateValue,
    timestampValue: item.timestampValue === null ? null : sql`${item.timestampValue}::timestamptz`,
    boolValue: item.boolValue,
    optionId: item.optionId,
    actorType: item.actorType,
    actorId: item.actorId,
    actorMemberId: item.actorType === 'member' ? item.actorId : null,
    jsonValue: item.jsonValue,
  };
}

/** Moves a record's `updated_at` and `updated_by` to now and the scope's actor (AC-7). */
export async function touchRecord(context: WriteContext, recordId: string): Promise<void> {
  const by = actorRow(context.scope.actor);
  await context.tx
    .update(records)
    .set({ updatedAt: sql`now()`, updatedByType: by.type, updatedById: by.id, updatedByMemberId: by.memberId })
    .where(eq(records.id, recordId));
}

/** The current, non cleared item rows of several owners, for reads. */
export async function currentItems(
  tx: WorkspaceTx,
  ownerIds: readonly string[],
  attributeIds?: readonly string[],
): Promise<readonly (StoredItem & { ownerId: string; attributeId: string; versionId: string })[]> {
  if (ownerIds.length === 0) return [];
  return tx
    .select({ ...ITEM_COLUMNS, ownerId: values.ownerId, attributeId: values.attributeId, versionId: values.versionId })
    .from(values)
    .where(
      and(
        inArray(values.ownerId, [...ownerIds]),
        isNull(values.activeUntil),
        eq(values.isCleared, false),
        attributeIds === undefined ? undefined : inArray(values.attributeId, [...attributeIds]),
      ),
    );
}
