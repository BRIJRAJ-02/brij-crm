// What a workspace's records look like (spec 0004): objects and their typed
// attributes. People, Companies and Deals are ordinary rows here, marked
// standard, so every object runs on the same engine.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { attributeType, auditColumns, id, systemColumn, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, workspaces } from './workspaces.ts';

/** A kind of record, standard or custom. */
export const objects = pgTable(
  'objects',
  {
    workspaceId: workspaceId(),
    id: id(),
    apiSlug: text('api_slug').notNull(),
    singularName: text('singular_name').notNull(),
    pluralName: text('plural_name').notNull(),
    icon: text('icon').notNull(),
    hue: text('hue').notNull(),
    isStandard: boolean('is_standard').notNull().default(false),
    standardKey: text('standard_key'),
    templateVersion: integer('template_version'),
    /** The text or personal name attribute a record's name comes from; set in the same transaction as that attribute. */
    primaryAttributeId: uuid('primary_attribute_id'),
    archivedAt: timestamptz('archived_at'),
    ...auditColumns(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'objects_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'objects_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    foreignKey({
      name: 'objects_primary_attribute',
      columns: [t.workspaceId, t.primaryAttributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    uniqueIndex('objects_api_slug').on(t.workspaceId, t.apiSlug),
    uniqueIndex('objects_standard_key')
      .on(t.workspaceId, t.standardKey)
      .where(sql`${t.standardKey} is not null`),
    check('objects_standard', sql`${t.isStandard} = (${t.standardKey} is not null)`),
    ...actorConstraints('objects', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('objects', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** A typed field on an object, or on a list (an entry's own values). */
export const attributes = pgTable(
  'attributes',
  {
    workspaceId: workspaceId(),
    id: id(),
    objectId: uuid('object_id'),
    listId: uuid('list_id'),
    apiSlug: text('api_slug').notNull(),
    title: text('title').notNull(),
    type: attributeType('type').notNull(),
    isMulti: boolean('is_multi').notNull().default(false),
    isRequired: boolean('is_required').notNull().default(false),
    isUnique: boolean('is_unique').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    systemColumn: systemColumn('system_column'),
    defaultValue: jsonb('default_value'),
    /** Type specific settings, parsed by `AttributeConfig[type]` before they get here. */
    config: jsonb('config').notNull().default({}),
    description: text('description'),
    position: integer('position').notNull(),
    /** For a record reference: the relationship it is one end of. */
    relationshipId: uuid('relationship_id'),
    archivedAt: timestamptz('archived_at'),
    ...auditColumns(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'attributes_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'attributes_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'attributes_list',
      columns: [t.workspaceId, t.listId],
      foreignColumns: [lists.workspaceId, lists.id],
    }),
    foreignKey({
      name: 'attributes_relationship',
      columns: [t.workspaceId, t.relationshipId],
      foreignColumns: [relationships.workspaceId, relationships.id],
    }),
    uniqueIndex('attributes_object_slug')
      .on(t.workspaceId, t.objectId, t.apiSlug)
      .where(sql`${t.objectId} is not null`),
    uniqueIndex('attributes_list_slug')
      .on(t.workspaceId, t.listId, t.apiSlug)
      .where(sql`${t.listId} is not null`),
    index('attributes_by_object').on(t.workspaceId, t.objectId, t.position),
    index('attributes_by_list').on(t.workspaceId, t.listId, t.position),
    check('attributes_parent', sql`num_nonnulls(${t.objectId}, ${t.listId}) = 1`),
    check('attributes_system', sql`(${t.systemColumn} is null) or ${t.isSystem}`),
    check(
      'attributes_multi',
      sql`not ${t.isMulti} or ${t.type} in ('select', 'email', 'phone', 'domain', 'url', 'actor_reference', 'record_reference', 'file')`,
    ),
    check(
      'attributes_unique',
      sql`not ${t.isUnique} or ${t.type} in ('text', 'email', 'domain', 'url', 'phone', 'number')`,
    ),
    // Set in the same transaction as its relationship (the two point at each other).
    check('attributes_reference', sql`${t.relationshipId} is null or ${t.type} = 'record_reference'`),
    ...actorConstraints('attributes', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('attributes', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** How many records each end of a relationship may link to. */
export const relationshipCardinality = pgEnum('relationship_cardinality', [
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many',
]);

/**
 * One relationship: the defining end's attribute and, for a two way
 * relationship, the other end's. A one way reference has no other end; it
 * names the objects it may point to instead. Read `one_to_many` from the
 * defining end: one of its records links to many on the other end.
 */
export const relationships = pgTable(
  'relationships',
  {
    workspaceId: workspaceId(),
    id: id(),
    cardinality: relationshipCardinality('cardinality').notNull(),
    fromAttributeId: uuid('from_attribute_id').notNull(),
    toAttributeId: uuid('to_attribute_id'),
    targetObjectIds: uuid('target_object_ids').array(),
    ...auditColumns(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'relationships_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'relationships_from_attribute',
      columns: [t.workspaceId, t.fromAttributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    foreignKey({
      name: 'relationships_to_attribute',
      columns: [t.workspaceId, t.toAttributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    // Each attribute is an end of one relationship at most.
    uniqueIndex('relationships_from').on(t.workspaceId, t.fromAttributeId),
    uniqueIndex('relationships_to')
      .on(t.workspaceId, t.toAttributeId)
      .where(sql`${t.toAttributeId} is not null`),
    check('relationships_ends', sql`${t.toAttributeId} is null or ${t.toAttributeId} <> ${t.fromAttributeId}`),
    check(
      'relationships_one_way',
      sql`(${t.toAttributeId} is null) = (${t.targetObjectIds} is not null) and (${t.targetObjectIds} is null or cardinality(${t.targetObjectIds}) between 1 and 20)`,
    ),
    ...actorConstraints('relationships', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('relationships', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** A list: records of one object collected together, each entry with values of its own. */
export const lists = pgTable(
  'lists',
  {
    workspaceId: workspaceId(),
    id: id(),
    objectId: uuid('object_id').notNull(),
    apiSlug: text('api_slug').notNull(),
    name: text('name').notNull(),
    /** False when a record may sit in the list once only. */
    allowsDuplicates: boolean('allows_duplicates').notNull().default(true),
    /** Live entries, read and moved under `FOR UPDATE` by the limits module. */
    entryCount: integer('entry_count').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
    ...auditColumns(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'lists_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'lists_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    uniqueIndex('lists_api_slug').on(t.workspaceId, t.apiSlug),
    check('lists_entry_count', sql`${t.entryCount} >= 0`),
    ...actorConstraints('lists', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('lists', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
