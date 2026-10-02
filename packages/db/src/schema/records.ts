// Records and their typed values, with history in place (spec 0004). A value
// row is one item of one attribute's value; the current version is the rows
// with no `active_until`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { attributes, objects } from './definitions.ts';
import { attributeOptions } from './options.ts';
import { actorConstraints } from './workspaces.ts';

const deletedBy = actorColumns('deleted_by');

/** One record of one object. A deleted record stays here for 30 days, then the purge removes it. */
export const records = pgTable(
  'records',
  {
    workspaceId: workspaceId(),
    id: id(),
    objectId: uuid('object_id').notNull(),
    deletedAt: timestamptz('deleted_at'),
    deletedByType: deletedBy.type,
    deletedById: deletedBy.id,
    deletedByMemberId: deletedBy.memberId,
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'records_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'records_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    index('records_live')
      .on(t.workspaceId, t.objectId, t.id)
      .where(sql`${t.deletedAt} is null`),
    index('records_created')
      .on(t.workspaceId, t.objectId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null`),
    index('records_updated')
      .on(t.workspaceId, t.objectId, t.updatedAt, t.id)
      .where(sql`${t.deletedAt} is null`),
    check('records_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    ...actorConstraints('records', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('records', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('records', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);

const setBy = actorColumns('set_by');
const actorValue = actorColumns('actor');

/** Current value rows that hold a value (not a cleared marker): what every value index covers. */
const CURRENT = 'active_until is null and not is_cleared';

/**
 * One item of one attribute's value on a record (or, from milestone 3, a list
 * entry). Each type uses its own columns (see the mapping in spec 0004). All
 * the rows one write makes share a `version_id` and an `active_from`.
 */
export const values = pgTable(
  'values',
  {
    workspaceId: workspaceId(),
    id: id(),
    versionId: uuid('version_id').notNull(),
    attributeId: uuid('attribute_id').notNull(),
    recordId: uuid('record_id'),
    /** List entries arrive in milestone 3; its foreign key comes with them. */
    entryId: uuid('entry_id'),
    /** The record or entry this row belongs to (whichever is set): what the indexes use. */
    ownerId: uuid('owner_id').notNull(),
    position: smallint('position').notNull().default(0),
    /** A cleared value: who cleared it and when, with every value column null. */
    isCleared: boolean('is_cleared').notNull().default(false),
    textValue: text('text_value'),
    numberValue: numeric('number_value', { precision: 19, scale: 4 }),
    dateValue: date('date_value'),
    timestampValue: timestamp('timestamp_value', { withTimezone: true, precision: 3 }),
    boolValue: boolean('bool_value'),
    optionId: uuid('option_id'),
    actorType: actorValue.type,
    actorId: actorValue.id,
    actorMemberId: actorValue.memberId,
    jsonValue: jsonb('json_value'),
    uniqueKey: text('unique_key'),
    heldUniqueKey: text('held_unique_key'),
    activeFrom: timestamptz('active_from').notNull(),
    activeUntil: timestamptz('active_until'),
    setByType: setBy.type.notNull(),
    setById: setBy.id,
    setByMemberId: setBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'values_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'values_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    foreignKey({
      name: 'values_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // The option must be one of this attribute's own.
    foreignKey({
      name: 'values_option',
      columns: [t.workspaceId, t.attributeId, t.optionId],
      foreignColumns: [attributeOptions.workspaceId, attributeOptions.attributeId, attributeOptions.id],
    }),
    check(
      'values_owner',
      sql`num_nonnulls(${t.recordId}, ${t.entryId}) = 1 and ${t.ownerId} = coalesce(${t.recordId}, ${t.entryId})`,
    ),
    check('values_period', sql`${t.activeUntil} is null or ${t.activeUntil} > ${t.activeFrom}`),
    check(
      'values_cleared',
      sql`not ${t.isCleared} or num_nonnulls(${t.textValue}, ${t.numberValue}, ${t.dateValue}, ${t.timestampValue}, ${t.boolValue}, ${t.optionId}, ${t.actorType}, ${t.jsonValue}) = 0`,
    ),
    // At most one current row per item: two concurrent saves can't both stay current.
    uniqueIndex('values_current')
      .on(t.workspaceId, t.ownerId, t.attributeId, t.position)
      .where(sql`${t.activeUntil} is null`),
    // Filters and sorts on text like values (the first 256 characters, in the pinned collation).
    index('values_text')
      .on(
        t.workspaceId,
        t.attributeId,
        sql`(lower(left(${t.textValue}, 256)) collate "und-x-icu")`,
        t.position,
        t.ownerId,
      )
      .where(sql.raw(`${CURRENT} and text_value is not null`)),
    // Contains and does not contain.
    index('values_text_trigram')
      .using('gin', t.workspaceId, t.attributeId, sql`lower(left(${t.textValue}, 2048)) gin_trgm_ops`)
      .where(sql.raw(`${CURRENT} and text_value is not null`)),
    // Filters and sorts on every other kind of value.
    index('values_number')
      .on(t.workspaceId, t.attributeId, t.numberValue, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and number_value is not null`)),
    index('values_date')
      .on(t.workspaceId, t.attributeId, t.dateValue, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and date_value is not null`)),
    index('values_timestamp')
      .on(t.workspaceId, t.attributeId, t.timestampValue, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and timestamp_value is not null`)),
    index('values_option')
      .on(t.workspaceId, t.attributeId, t.optionId, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and option_id is not null`)),
    index('values_bool')
      .on(t.workspaceId, t.attributeId, t.boolValue, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and bool_value is not null`)),
    index('values_actor')
      .on(t.workspaceId, t.attributeId, t.actorId, t.position, t.ownerId)
      .where(sql.raw(`${CURRENT} and actor_id is not null`)),
    // A unique attribute's current values (AC-10). Deleted records hold theirs in held_unique_key.
    uniqueIndex('values_unique')
      .on(t.workspaceId, t.attributeId, t.uniqueKey)
      .where(sql`${t.activeUntil} is null and ${t.uniqueKey} is not null`),
    // As of reads and history.
    index('values_history').on(t.workspaceId, t.ownerId, t.attributeId, t.activeFrom),
    ...actorConstraints('values', 'set_by', t.workspaceId, {
      type: t.setByType,
      id: t.setById,
      memberId: t.setByMemberId,
    }),
    ...actorConstraints('values', 'actor', t.workspaceId, {
      type: t.actorType,
      id: t.actorId,
      memberId: t.actorMemberId,
    }),
  ],
);
