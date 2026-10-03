// Writing and reading one attribute's value (spec 0004, the write protocol):
// the owner row is locked first, an unchanged value writes nothing, and a new
// version's time never runs before the one it replaces.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { parseAttributeValue, SYSTEM_ONLY_TYPES, type AttributeType } from '@crm/contracts/values';
import { encodeValue, sameItems, type ItemColumns, type StoredItem } from './columns.ts';
import { canonicalId, checkId, isUuid, uuidArray } from './ids.ts';
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

/** One attribute by id, or a `NOT_FOUND` refusal (a malformed id too, before any query). */
export async function loadAttribute(tx: WorkspaceTx, attributeId: string, lock = false): Promise<AttributeDef> {
  if (!isUuid(attributeId)) throw refuse('NOT_FOUND', 'That attribute does not exist.');
  const id = canonicalId(attributeId);
  const query = tx.select(DEF_COLUMNS).from(attributes).where(eq(attributes.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', 'That attribute does not exist.', id);
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
  checkId(entryId, 'That entry does not exist.');
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
  checkId(recordId, 'That record does not exist.');
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

/**
 * Refuses `ATTRIBUTE_READ_ONLY`, naming the attribute, when `writer` gives a
 * value to a type only the system writes (`SYSTEM_ONLY_TYPES`: timestamps and
 * interactions) and isn't the system. Every write that takes values from a
 * caller checks it before parsing (`parseAll`); a default is the system's.
 */
export function checkWriter(attribute: AttributeDef, writer: Actor): void {
  if (writer.type === 'system') return;
  if ((SYSTEM_ONLY_TYPES as readonly AttributeType[]).includes(attribute.type)) {
    throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title} is set by the system.`, attribute.id);
  }
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
  // A malformed id is no option: refused here, so a batch refuses that record alone instead of failing the cast.
  if (!added.every(isUuid)) {
    throw refuse('ATTRIBUTE_VALUE_INVALID', `Pick one of ${attribute.title}'s options.`, attribute.id);
  }
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

/** One actor a value names: an actor reference's own, or the `by` of an interaction. */
interface NamedActor {
  readonly type: string | null;
  readonly id: string | null;
}

/** The actors an attribute's items name: an actor reference's own columns, an interaction's `by`, or none. */
function namedActors(type: AttributeDef['type'], items: readonly ItemColumns[]): readonly NamedActor[] {
  if (type === 'actor_reference') return items.map((item) => ({ type: item.actorType, id: item.actorId }));
  if (type !== 'interaction') return [];
  const fields = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  return items.map((item) => {
    const by = fields(fields(item.jsonValue).by);
    return { type: typeof by.type === 'string' ? by.type : null, id: typeof by.id === 'string' ? by.id : null };
  });
}

/**
 * Refuses, as `ATTRIBUTE_VALUE_INVALID` naming the attribute, actors a write
 * may not add, whether an actor reference's value or an interaction's `by`:
 * an id that isn't a uuid (refused here, so a batch refuses that record alone
 * instead of failing the cast), a member who isn't an active member of this
 * workspace, and any other kind of actor (an API key, an automation, the
 * system) unless it is the scope's own actor naming itself. Actors already
 * held may stay. Members found active are remembered for the rest of the
 * write, so a batch looks each one up once.
 */
async function checkActors(
  context: WriteContext,
  attribute: AttributeDef,
  nextItems: readonly ItemColumns[],
  heldItems: readonly ItemColumns[],
): Promise<void> {
  const next = namedActors(attribute.type, nextItems);
  const held = namedActors(attribute.type, heldItems);
  const invalid = () =>
    refuse('ATTRIBUTE_VALUE_INVALID', `Pick a member of this workspace for ${attribute.title}.`, attribute.id);
  if (!next.every((item) => item.id === null || isUuid(item.id))) throw invalid();
  const keyOf = (item: NamedActor) => `${item.type ?? ''}:${item.id?.toLowerCase() ?? ''}`;
  const kept = new Set(held.map(keyOf));
  const added = next.filter((item) => item.type !== null && !kept.has(keyOf(item)));
  const self = context.scope.actor;
  const isSelf = (item: NamedActor) => item.type === self.type && item.id?.toLowerCase() === self.id?.toLowerCase();
  if (added.some((item) => item.type !== 'member' && !isSelf(item))) throw invalid();
  const memberIds = added.flatMap((item) =>
    item.type === 'member' && item.id !== null ? [item.id.toLowerCase()] : [],
  );
  const unknown = [...new Set(memberIds)].filter((id) => !context.activeMembers.has(id));
  if (unknown.length === 0) return;
  const rows = await context.tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, unknown), eq(members.status, 'active')));
  if (rows.length < unknown.length) throw invalid();
  for (const row of rows) context.activeMembers.add(row.id);
}

/**
 * A hold on the definitions of the unique capable attributes one `writeAll`
 * writes. The first value that changes takes a key share lock on all of their
 * rows in one query, in id order, then starts the write again if any unique
 * or archived flag changed since it was read; later calls do nothing. Turning
 * Unique on or off, and archiving or restoring, lock that row for update
 * before they fill or clear keys, so a value write either lands before they
 * scan the values, or waits for them and writes with the new definition
 * (AC-10). Each `writeAll` makes its own inside its savepoint: a refused
 * record's rollback releases the locks, and the next record takes them again.
 */
export function holdDefinitions(tx: WorkspaceTx, written: readonly AttributeDef[]): () => Promise<void> {
  const unique = written.filter((attribute) => UNIQUE_TYPES.includes(attribute.type));
  const take = async (): Promise<void> => {
    if (unique.length === 0) return;
    const ids = [...new Set(unique.map((attribute) => attribute.id))].sort();
    const rows = await tx.execute<{ id: string; is_unique: boolean; archived: boolean }>(sql`
      select id::text as id, is_unique, archived_at is not null as archived from attributes
      where id = any(${uuidArray(ids)}) order by id for key share
    `);
    const now = new Map(rows.rows.map((row) => [row.id, row]));
    for (const attribute of unique) {
      const row = now.get(attribute.id);
      if (row === undefined) throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
      if (row.is_unique !== attribute.isUnique || row.archived !== (attribute.archivedAt !== null)) {
        throw writeConflict(`${attribute.title} changed under this write.`);
      }
    }
  };
  let held: Promise<void> | undefined;
  return () => {
    held = held ?? take();
    return held;
  };
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
export async function writeAttribute(
  context: WriteContext,
  write: AttributeWrite,
  holdDefinition: () => Promise<void>,
): Promise<ValueChange | undefined> {
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
  if (UNIQUE_TYPES.includes(attribute.type)) await holdDefinition();
  if (attribute.type === 'select' || attribute.type === 'status') await checkOptions(tx, attribute, next, held);
  if (attribute.type === 'actor_reference' || attribute.type === 'interaction') {
    await checkActors(context, attribute, next, held);
  }

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
