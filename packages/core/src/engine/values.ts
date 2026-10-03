// Writing and reading one attribute's value (spec 0004, the write protocol):
// the owner row is locked first, an unchanged value writes nothing, and a new
// version's time never runs before the one it replaces.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { parseAttributeValue, type AttributeType } from '@crm/contracts/values';
import { encodeValue, sameItems, type ItemColumns, type StoredItem } from './columns.ts';
import { isUuid, uuidArray } from './ids.ts';
import { postgresError, refuse, writeConflict } from './refusals.ts';
import { syncSortKey } from './sort-keys.ts';
import { UNIQUE_TYPES, uniqueKeyOf } from './unique.ts';
import { actorRow, type Actor } from './scope.ts';
import type { ValueChange, WriteContext } from './write.ts';

const { attributeOptions, attributes, listEntries, members, records, values } = schema;

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
  /** Type specific settings, already parsed by `AttributeConfig[type]` when stored. */
  readonly config: unknown;
  /** The stored `AttributeDefault`, or null. */
  readonly defaultValue: unknown;
  /** For a record reference: the relationship it is one end of. */
  readonly relationshipId: string | null;
}

/** The columns `AttributeDef` reads. */
const DEF_COLUMNS = {
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
  config: attributes.config,
  defaultValue: attributes.defaultValue,
  relationshipId: attributes.relationshipId,
} as const;

/** One attribute by id, or a `NOT_FOUND` refusal. */
export async function loadAttribute(tx: WorkspaceTx, attributeId: string, lock = false): Promise<AttributeDef> {
  const query = tx.select(DEF_COLUMNS).from(attributes).where(eq(attributes.id, attributeId));
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', 'That attribute does not exist.', attributeId);
  return row;
}

/** Every attribute of one object, by id. */
export async function loadAttributes(tx: WorkspaceTx, objectId: string): Promise<ReadonlyMap<string, AttributeDef>> {
  const rows = await tx.select(DEF_COLUMNS).from(attributes).where(eq(attributes.objectId, objectId));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Some attributes by id, wherever they sit (a filter through a relationship names the far object's). */
export async function loadAttributesById(
  tx: WorkspaceTx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, AttributeDef>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select(DEF_COLUMNS)
    .from(attributes)
    .where(inArray(attributes.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Every attribute of one list (an entry's own values), by id. */
export async function loadListAttributes(tx: WorkspaceTx, listId: string): Promise<ReadonlyMap<string, AttributeDef>> {
  const rows = await tx.select(DEF_COLUMNS).from(attributes).where(eq(attributes.listId, listId));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Locks a live entry's row for the rest of the transaction, like `lockRecord`:
 * its record first (share), then the entry, the order every entry write takes.
 * Refuses an entry that is missing or removed, or whose record is in the trash.
 */
export async function lockEntry(tx: WorkspaceTx, entryId: string): Promise<{ listId: string; recordId: string }> {
  const [parents] = await tx
    .select({ recordId: listEntries.recordId })
    .from(listEntries)
    .where(eq(listEntries.id, entryId));
  if (parents === undefined) throw refuse('NOT_FOUND', 'That entry does not exist.');
  const [record] = await tx
    .select({ deletedAt: records.deletedAt })
    .from(records)
    .where(eq(records.id, parents.recordId))
    .for('share');
  const [row] = await tx
    .select({ listId: listEntries.listId, recordId: listEntries.recordId, deletedAt: listEntries.deletedAt })
    .from(listEntries)
    .where(eq(listEntries.id, entryId))
    .for('no key update');
  if (row === undefined) throw refuse('NOT_FOUND', 'That entry does not exist.');
  if (row.deletedAt !== null) throw refuse('RECORD_DELETED', 'That entry was removed from its list. Restore it first.');
  if (record?.deletedAt !== null)
    throw refuse('RECORD_DELETED', "That entry's record is in the trash. Restore it first.");
  return { listId: row.listId, recordId: row.recordId };
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
    // Not FOR UPDATE: a link's foreign key check (FOR KEY SHARE) on this record must not wait for it.
    .for('no key update');
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
  if (attribute.isRequired && parsed.value === null) {
    throw refuse('VALUE_REQUIRED', `${attribute.title} is required. Give it a value.`, attribute.id);
  }
  return parsed.value;
}

/** Refuses option ids that aren't this attribute's live options. Options already held may stay, archived or not. */
async function checkOptions(
  tx: WorkspaceTx,
  attribute: AttributeDef,
  next: readonly ItemColumns[],
  held: readonly ItemColumns[],
): Promise<void> {
  const kept = new Set(held.map((item) => item.optionId));
  const added = [
    ...new Set(next.flatMap((item) => (item.optionId === null || kept.has(item.optionId) ? [] : [item.optionId]))),
  ];
  if (added.length === 0) return;
  const rows = await tx
    .select({ id: attributeOptions.id, archivedAt: attributeOptions.archivedAt })
    .from(attributeOptions)
    .where(and(eq(attributeOptions.attributeId, attribute.id), inArray(attributeOptions.id, added)));
  const found = new Map(rows.map((row) => [row.id, row]));
  for (const id of added) {
    const option = found.get(id);
    if (option === undefined) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `Pick one of ${attribute.title}'s options.`, attribute.id);
    }
    if (option.archivedAt !== null) {
      throw refuse('OPTION_ARCHIVED', `That ${attribute.title} option is archived. Pick another.`, attribute.id);
    }
  }
}

/** Refuses member ids that aren't active members of this workspace. Members already held may stay. */
async function checkMembers(
  tx: WorkspaceTx,
  attribute: AttributeDef,
  next: readonly ItemColumns[],
  held: readonly ItemColumns[],
): Promise<void> {
  const memberIds = (items: readonly ItemColumns[]) =>
    items.flatMap((item) => (item.actorType === 'member' && item.actorId !== null ? [item.actorId] : []));
  const kept = new Set(memberIds(held));
  const added = [...new Set(memberIds(next).filter((id) => !kept.has(id)))];
  if (added.length === 0) return;
  const invalid = () =>
    refuse('ATTRIBUTE_VALUE_INVALID', `Pick a member of this workspace for ${attribute.title}.`, attribute.id);
  if (!added.every(isUuid)) throw invalid();
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, added), eq(members.status, 'active')));
  if (rows.length < added.length) throw invalid();
}

/**
 * Takes a key share lock on the attribute's row, then starts the write again
 * if its unique or archived flag changed since it was read. Turning Unique on
 * or off, and archiving or restoring, lock that row for update before they
 * fill or clear keys, so a value write either lands before they scan the
 * values, or waits for them and writes with the new definition (AC-10).
 */
async function holdDefinition(tx: WorkspaceTx, attribute: AttributeDef): Promise<void> {
  const [row] = await tx
    .select({ isUnique: attributes.isUnique, archivedAt: attributes.archivedAt })
    .from(attributes)
    .where(eq(attributes.id, attribute.id))
    .for('key share');
  if (row === undefined) throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
  if (row.isUnique !== attribute.isUnique || (row.archivedAt === null) !== (attribute.archivedAt === null)) {
    throw writeConflict(`${attribute.title} changed under this write.`);
  }
}

/** The object a record's value belongs to, or the list an entry's does, as a change reports it. */
type OwnerPart =
  | { readonly ownerKind: 'record'; readonly objectId: string }
  | { readonly ownerKind: 'entry'; readonly listId: string };

/** A write's owner part, from the attribute it writes: a record's attributes sit on its object, an entry's on its list. */
function ownerPart(write: AttributeWrite): OwnerPart {
  const { attribute } = write;
  if (write.ownerKind === 'record') {
    if (attribute.objectId === null) throw new Error(`${attribute.title} is not on an object.`);
    return { ownerKind: 'record', objectId: attribute.objectId };
  }
  if (attribute.listId === null) throw new Error(`${attribute.title} is not on a list.`);
  return { ownerKind: 'entry', listId: attribute.listId };
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
  if (UNIQUE_TYPES.includes(attribute.type)) await holdDefinition(tx, attribute);

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
  if (attribute.type === 'select' || attribute.type === 'status') await checkOptions(tx, attribute, next, held);
  if (attribute.type === 'actor_reference') await checkMembers(tx, attribute, next, held);

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
      : next.map((item, position) => ({
          ...base,
          ...itemInsert(item),
          position,
          uniqueKey: attribute.isUnique ? uniqueKeyOf(attribute.type, item) : null,
        }));
  try {
    await tx.insert(values).values(rows);
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'values_unique') {
      throw refuse(
        'UNIQUE_CONFLICT',
        `Another record already has this ${attribute.title}. It must be unique.`,
        attribute.id,
      );
    }
    // A member or option that went away (or never was) after the checks above: refuse it as they would.
    if (pg?.code === '23503' && (pg.constraint === 'values_actor' || pg.constraint === 'values_option')) {
      throw refuse('ATTRIBUTE_VALUE_INVALID', `That ${attribute.title} value is not available any more.`, attribute.id);
    }
    throw error;
  }
  await syncSortKey(tx, ownerId, attribute);

  const before = current[0];
  const replaced =
    write.baseVersionId !== undefined && before !== undefined && before.versionId !== write.baseVersionId
      ? { versionId: before.versionId, setBy: { type: before.setByType, id: before.setById } satisfies Actor }
      : undefined;
  return {
    ownerId,
    ...ownerPart(write),
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

/**
 * Moves the `updated_at` and `updated_by` of the records on the far side of a
 * link write to now and the scope's actor, locking them in id order (AC-7): a
 * company that gains a person changed too.
 */
export async function touchRecords(context: WriteContext, recordIds: readonly string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const by = actorRow(context.scope.actor);
  const ids = uuidArray([...new Set(recordIds)].sort());
  await context.tx.execute(sql`
    update records set updated_at = now(), updated_by_type = ${by.type}, updated_by_id = ${by.id},
      updated_by_member_id = ${by.memberId}
    where id in (select id from records where id = any(${ids}) order by id for no key update)
  `);
}

/** Moves a record's (or entry's) `updated_at` and `updated_by` to now and the scope's actor (AC-7). */
export async function touchOwner(context: WriteContext, ownerKind: 'record' | 'entry', ownerId: string): Promise<void> {
  const by = actorRow(context.scope.actor);
  const set = { updatedAt: sql`now()`, updatedByType: by.type, updatedById: by.id, updatedByMemberId: by.memberId };
  if (ownerKind === 'record') await context.tx.update(records).set(set).where(eq(records.id, ownerId));
  else await context.tx.update(listEntries).set(set).where(eq(listEntries.id, ownerId));
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
