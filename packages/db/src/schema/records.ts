// Records and their typed values, with history in place (spec 0004). A value
// row is one item of one attribute's value; the current version is the rows
// with no `active_until`.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { attributes, lists, objects, relationships } from './definitions.ts';
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
    // The few records in the trash: an unfiltered list's exact count takes their live entries away.
    index('records_trashed')
      .on(t.workspaceId, t.id)
      .where(sql`${t.deletedAt} is not null`),
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

const entryDeletedBy = actorColumns('deleted_by');

/** One record's place in a list. A record can hold several entries in one list unless the list allows it once. */
export const listEntries = pgTable(
  'list_entries',
  {
    workspaceId: workspaceId(),
    id: id(),
    listId: uuid('list_id').notNull(),
    recordId: uuid('record_id').notNull(),
    /** Set when the entry is removed from its list; it can come back for 30 days. */
    deletedAt: timestamptz('deleted_at'),
    deletedByType: entryDeletedBy.type,
    deletedById: entryDeletedBy.id,
    deletedByMemberId: entryDeletedBy.memberId,
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'list_entries_pkey', columns: [t.workspaceId, t.id] }),
    // So a stored sort key can name an entry and its record together, and never a mismatched pair.
    unique('list_entries_record_key').on(t.workspaceId, t.id, t.recordId),
    foreignKey({
      name: 'list_entries_list',
      columns: [t.workspaceId, t.listId],
      foreignColumns: [lists.workspaceId, lists.id],
    }),
    foreignKey({
      name: 'list_entries_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    index('list_entries_live')
      .on(t.workspaceId, t.listId, t.id)
      .where(sql`${t.deletedAt} is null`),
    index('list_entries_record').on(t.workspaceId, t.recordId, t.listId),
    check('list_entries_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    ...actorConstraints('list_entries', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('list_entries', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('list_entries', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);

const setBy = actorColumns('set_by');
const endedBy = actorColumns('ended_by');
const actorValue = actorColumns('actor');

/** Current links: what every link index but the history ones covers. */
const CURRENT_LINK = 'active_until is null';

/**
 * One link between two records through a relationship, read from both ends.
 * Like a value row it has history in place: a change ends the current link
 * (`active_until`, `ended_by`) and starts a new one. `position` orders the
 * defining end's items, `to_position` the other end's. The single flags copy
 * the relationship's cardinality, so the partial unique indexes can hold each
 * single end to one current link.
 */
export const recordLinks = pgTable(
  'record_links',
  {
    workspaceId: workspaceId(),
    id: id(),
    versionId: uuid('version_id').notNull(),
    relationshipId: uuid('relationship_id').notNull(),
    fromRecordId: uuid('from_record_id').notNull(),
    toRecordId: uuid('to_record_id').notNull(),
    position: smallint('position').notNull().default(0),
    toPosition: smallint('to_position').notNull().default(0),
    fromSingle: boolean('from_single').notNull(),
    toSingle: boolean('to_single').notNull(),
    activeFrom: timestamptz('active_from').notNull(),
    activeUntil: timestamptz('active_until'),
    setByType: setBy.type.notNull(),
    setById: setBy.id,
    setByMemberId: setBy.memberId,
    endedByType: endedBy.type,
    endedById: endedBy.id,
    endedByMemberId: endedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'record_links_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'record_links_relationship',
      columns: [t.workspaceId, t.relationshipId],
      foreignColumns: [relationships.workspaceId, relationships.id],
    }),
    foreignKey({
      name: 'record_links_from_record',
      columns: [t.workspaceId, t.fromRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'record_links_to_record',
      columns: [t.workspaceId, t.toRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    check('record_links_period', sql`${t.activeUntil} is null or ${t.activeUntil} > ${t.activeFrom}`),
    check('record_links_ended', sql`(${t.activeUntil} is null) = (${t.endedByType} is null)`),
    // Each end's current items, in order.
    index('record_links_from')
      .on(t.workspaceId, t.relationshipId, t.fromRecordId, t.position)
      .where(sql.raw(CURRENT_LINK)),
    index('record_links_to')
      .on(t.workspaceId, t.relationshipId, t.toRecordId, t.toPosition)
      .where(sql.raw(CURRENT_LINK)),
    // Two records link once at a time, and a single end holds one current link.
    uniqueIndex('record_links_current')
      .on(t.workspaceId, t.relationshipId, t.fromRecordId, t.toRecordId)
      .where(sql.raw(CURRENT_LINK)),
    uniqueIndex('record_links_from_single')
      .on(t.workspaceId, t.relationshipId, t.fromRecordId)
      .where(sql.raw(`${CURRENT_LINK} and from_single`)),
    uniqueIndex('record_links_to_single')
      .on(t.workspaceId, t.relationshipId, t.toRecordId)
      .where(sql.raw(`${CURRENT_LINK} and to_single`)),
    // History, as of reads, and finding every link of a record (purge, erasure).
    index('record_links_from_history').on(t.workspaceId, t.fromRecordId, t.relationshipId, t.activeFrom),
    index('record_links_to_history').on(t.workspaceId, t.toRecordId, t.relationshipId, t.activeFrom),
    ...actorConstraints('record_links', 'set_by', t.workspaceId, {
      type: t.setByType,
      id: t.setById,
      memberId: t.setByMemberId,
    }),
    ...actorConstraints('record_links', 'ended_by', t.workspaceId, {
      type: t.endedByType,
      id: t.endedById,
      memberId: t.endedByMemberId,
    }),
  ],
);

/** Current value rows that hold a value (not a cleared marker): what every value index covers. */
const CURRENT = 'active_until is null and not is_cleared';

/**
 * One item of one attribute's value on a record or a list entry. Each type uses its own columns (see the mapping in spec 0004). All
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
    foreignKey({
      name: 'values_entry',
      columns: [t.workspaceId, t.entryId],
      foreignColumns: [listEntries.workspaceId, listEntries.id],
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
    // The foreign key checks when a purge or an erasure deletes records and entries: one lookup each, not a scan.
    index('values_by_record')
      .on(t.workspaceId, t.recordId)
      .where(sql`${t.recordId} is not null`),
    index('values_by_entry')
      .on(t.workspaceId, t.entryId)
      .where(sql`${t.entryId} is not null`),
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

/** Text in a pinned collation, so its order never depends on the database default. */
const collatedText = (collation: 'und-x-icu' | 'C') =>
  customType<{ data: string }>({ dataType: () => `text collate "${collation}"` });
const icuText = collatedText('und-x-icu');
const byteText = collatedText('C');

/** The live key rows of one kind: what every key index covers. */
const LIVE = 'live';

/**
 * The sort key of one current, set, position 0 value of a sortable attribute
 * (spec 0004, stored sort keys): a copy in a form Postgres can seek on under
 * row level security, with `live` false while the record is in the trash or
 * the entry removed. Written in the same transaction as the value; `values`
 * stays the truth, and this table can always be rebuilt from it.
 */
export const sortKeys = pgTable(
  'sort_keys',
  {
    workspaceId: workspaceId(),
    /** The record or entry, as on `values`. */
    ownerId: uuid('owner_id').notNull(),
    attributeId: uuid('attribute_id').notNull(),
    /** The record itself, or the entry's record. */
    recordId: uuid('record_id').notNull(),
    entryId: uuid('entry_id'),
    live: boolean('live').notNull(),
    /** `lower(left(text_value, 256))`, the text indexes' own expression; a location's locality. */
    textKey: icuText('text_key'),
    /** A number, rating or currency amount times 10,000, exact for 14 integer digits. */
    numberKey: bigint('number_key', { mode: 'bigint' }),
    /** A currency code, or a location's country code. */
    codeKey: byteText('code_key'),
    dateKey: date('date_key'),
    timeKey: timestamp('time_key', { withTimezone: true, precision: 3 }),
    optionId: uuid('option_id'),
    boolKey: boolean('bool_key'),
  },
  (t) => [
    primaryKey({ name: 'sort_keys_pkey', columns: [t.workspaceId, t.ownerId, t.attributeId] }),
    foreignKey({
      name: 'sort_keys_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    foreignKey({
      name: 'sort_keys_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'sort_keys_entry',
      columns: [t.workspaceId, t.entryId, t.recordId],
      foreignColumns: [listEntries.workspaceId, listEntries.id, listEntries.recordId],
    }),
    foreignKey({
      name: 'sort_keys_option',
      columns: [t.workspaceId, t.attributeId, t.optionId],
      foreignColumns: [attributeOptions.workspaceId, attributeOptions.attributeId, attributeOptions.id],
    }),
    check('sort_keys_owner', sql`${t.ownerId} = coalesce(${t.entryId}, ${t.recordId})`),
    // Sorts, cursors and jumps on text kinds, index only.
    index('sort_keys_text')
      .on(t.workspaceId, t.attributeId, t.textKey, t.ownerId)
      .where(sql.raw(`${LIVE} and text_key is not null`)),
    // The same for every other kind: numbers and ratings, currency (code, then amount), location
    // (country, then locality), dates, times, options and checkboxes.
    index('sort_keys_number')
      .on(t.workspaceId, t.attributeId, t.numberKey, t.ownerId)
      .where(sql.raw(`${LIVE} and number_key is not null`)),
    index('sort_keys_currency')
      .on(t.workspaceId, t.attributeId, t.codeKey, t.numberKey, t.ownerId)
      .where(sql.raw(`${LIVE} and code_key is not null and number_key is not null`)),
    index('sort_keys_location')
      .on(t.workspaceId, t.attributeId, t.codeKey, t.textKey, t.ownerId)
      .where(sql.raw(`${LIVE} and code_key is not null and number_key is null`)),
    index('sort_keys_date')
      .on(t.workspaceId, t.attributeId, t.dateKey, t.ownerId)
      .where(sql.raw(`${LIVE} and date_key is not null`)),
    index('sort_keys_time')
      .on(t.workspaceId, t.attributeId, t.timeKey, t.ownerId)
      .where(sql.raw(`${LIVE} and time_key is not null`)),
    index('sort_keys_option')
      .on(t.workspaceId, t.attributeId, t.optionId, t.ownerId)
      .where(sql.raw(`${LIVE} and option_id is not null`)),
    index('sort_keys_bool')
      .on(t.workspaceId, t.attributeId, t.boolKey, t.ownerId)
      .where(sql.raw(`${LIVE} and bool_key is not null`)),
    // Delete, restore, purge and erasure by record or entry.
    index('sort_keys_by_record').on(t.workspaceId, t.recordId),
    index('sort_keys_by_entry')
      .on(t.workspaceId, t.entryId)
      .where(sql`${t.entryId} is not null`),
  ],
);
