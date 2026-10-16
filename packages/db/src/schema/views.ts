// Saved views (spec 0020): a named filter, sort and column layout on one
// object (or, from #51, one list), shared with the workspace or kept private
// by its creator. The config is one small JSON document, parsed by
// `ViewConfig` (`@crm/contracts`) on every read and write; the database only
// bounds its size. Views are settings, not records: a delete is hard.
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
} from 'drizzle-orm/pg-core';
import { auditColumns, timestamptz, workspaceId } from './common.ts';
import { lists, objects } from './definitions.ts';
import { actorConstraints, members } from './workspaces.ts';

/** A table or a board (#21 fills the board). */
export const viewKind = pgEnum('view_kind', ['table', 'board']);

/** Only its creator, or everyone in the workspace. */
export const viewVisibility = pgEnum('view_visibility', ['private', 'workspace']);

/** The longest a stored config may be, serialised (spec 0020: 64 kB). */
export const VIEW_CONFIG_MAX_BYTES = 65_536;

/** One saved view of an object or a list. */
export const views = pgTable(
  'views',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints (the idempotent create key); `uuidv7()` for the ones the system seeds. */
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    objectId: uuid('object_id'),
    listId: uuid('list_id'),
    /** The object or the list, whichever is set: what the names and positions are unique and ordered within. */
    parentId: uuid('parent_id').generatedAlwaysAs(sql`coalesce(object_id, list_id)`),
    kind: viewKind('kind').notNull().default('table'),
    /** 1 to 100 characters, stored trimmed. */
    name: text('name').notNull(),
    visibility: viewVisibility('visibility').notNull(),
    /** Null only for the views the system seeded (each object's default view). */
    creatorMemberId: uuid('creator_member_id'),
    /** Its place among its group: the shared views of its parent, or its creator's private ones. */
    position: integer('position').notNull(),
    /** `ViewConfig`: columns, pinned count, filter, sorts and (for a board) its settings. */
    config: jsonb('config').notNull(),
    /** Up by one on every change. */
    version: integer('version').notNull().default(1),
    /** Up by one when the filter or sorts change: a query save checks it (`VIEW_CHANGED`). */
    queryVersion: integer('query_version').notNull().default(1),
    querySavedAt: timestamptz('query_saved_at'),
    querySavedByMemberId: uuid('query_saved_by_member_id'),
    isLocked: boolean('is_locked').notNull().default(false),
    lockedByMemberId: uuid('locked_by_member_id'),
    lockedAt: timestamptz('locked_at'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'views_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'views_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'views_list',
      columns: [t.workspaceId, t.listId],
      foreignColumns: [lists.workspaceId, lists.id],
    }),
    foreignKey({
      name: 'views_creator',
      columns: [t.workspaceId, t.creatorMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'views_query_saved_by',
      columns: [t.workspaceId, t.querySavedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'views_locked_by',
      columns: [t.workspaceId, t.lockedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // A shared name is unique on its object ignoring case; a private one per creator (NAME_TAKEN on either).
    uniqueIndex('views_shared_name')
      .on(t.workspaceId, t.parentId, sql`lower(${t.name})`)
      .where(sql`${t.visibility} = 'workspace'`),
    uniqueIndex('views_private_name')
      .on(t.workspaceId, t.parentId, t.creatorMemberId, sql`lower(${t.name})`)
      .where(sql`${t.visibility} = 'private'`),
    // The switcher's order: the shared views by position, the caller's private ones by position.
    index('views_by_position').on(t.workspaceId, t.parentId, t.visibility, t.position),
    check('views_parent', sql`(${t.objectId} is null) <> (${t.listId} is null)`),
    check('views_name', sql`char_length(${t.name}) between 1 and 100 and ${t.name} = btrim(${t.name})`),
    check('views_position', sql`${t.position} >= 0`),
    check(
      'views_private',
      sql`${t.visibility} = 'workspace' or (${t.creatorMemberId} is not null and not ${t.isLocked})`,
    ),
    check(
      'views_locked',
      sql`${t.isLocked} = (${t.lockedAt} is not null) and (${t.lockedByMemberId} is null or ${t.isLocked})`,
    ),
    check('views_config', sql`jsonb_typeof(${t.config}) = 'object' and octet_length(${t.config}::text) <= 65536`),
    check('views_versions', sql`${t.version} >= 1 and ${t.queryVersion} >= 1`),
    ...actorConstraints('views', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('views', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * The view each member last opened per object (spec 0020, milestone 2,
 * AC-478): their own bookmark, so another browser or device opens the same
 * one. Written by `views.markOpened` with no outbox row (nobody else holds
 * it); gone with its view (cascade) and with the member's removal.
 */
export const memberViewState = pgTable(
  'member_view_state',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** The object (or, from #51, the list) the view is on. */
    parentId: uuid('parent_id').notNull(),
    viewId: uuid('view_id').notNull(),
    openedAt: timestamptz('opened_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_view_state_pkey', columns: [t.workspaceId, t.memberId, t.parentId] }),
    foreignKey({
      name: 'member_view_state_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'member_view_state_view',
      columns: [t.workspaceId, t.viewId],
      foreignColumns: [views.workspaceId, views.id],
    }).onDelete('cascade'),
    // A view's delete finds its bookmarks through this, not a scan.
    index('member_view_state_by_view').on(t.workspaceId, t.viewId),
  ],
);
