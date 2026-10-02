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

/** A typed field on an object (or, from milestone 3, on a list). */
export const attributes = pgTable(
  'attributes',
  {
    workspaceId: workspaceId(),
    id: id(),
    objectId: uuid('object_id'),
    /** Lists arrive in milestone 3; its foreign key comes with them. */
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
    /** Relationships arrive in milestone 3; its foreign key comes with them. */
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
