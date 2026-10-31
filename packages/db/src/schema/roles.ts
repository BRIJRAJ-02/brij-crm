// Custom roles (spec 0037, job J9, AC-1228 to AC-1238): a workspace's own roles, each a name, a line on what it is
// for, the permissions it holds and its data access. A custom role is always based on Member: its holders keep
// `members.role = 'member'` and name the role in `members.custom_role_id`. Permissions are stored as text, checked
// by the code against the catalog and its grant levels when read, so a name a newer deploy wrote, or one stored by
// hand, grants nothing after a rollback instead of the database refusing the row.
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditColumns, id, workspaceId } from './common.ts';
import { actorConstraints } from './workspaces.ts';

/** One custom role (spec 0037, AC-1228). At most 20 per workspace, counted under a workspace advisory lock. */
export const workspaceRoles = pgTable(
  'workspace_roles',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** 1 to 40 characters, unique ignoring case, never one of the built in roles' names. */
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Catalog names; only those of grant `any` are ever held (AC-1234). */
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The role new people get (AC-1237): at most one per workspace; none means Member. */
    isDefault: boolean('is_default').notNull().default(false),
    position: smallint('position').notNull(),
    /** `write` or `read` (AC-1229); any other value reads as `read`, failing toward less access. */
    defaultObjectLevel: text('default_object_level').notNull().default('write'),
    /** What it started from: `member`, `viewer` or a custom role's id (kept for spec 0037 J10's rule copy). */
    startedFrom: text('started_from').notNull().default('member'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'workspace_roles_pkey', columns: [t.workspaceId, t.id] }),
    uniqueIndex('workspace_roles_name').on(t.workspaceId, sql`lower(${t.name})`),
    uniqueIndex('workspace_roles_default')
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
    index('workspace_roles_order').on(t.workspaceId, t.position),
    check('workspace_roles_name_length', sql`char_length(${t.name}) between 1 and 40`),
    check('workspace_roles_name_reserved', sql`lower(${t.name}) not in ('owner', 'admin', 'member', 'guest')`),
    check('workspace_roles_description', sql`char_length(${t.description}) <= 200`),
    check('workspace_roles_permissions', sql`cardinality(${t.permissions}) <= 64`),
    check('workspace_roles_position', sql`${t.position} between 0 and 19`),
    ...actorConstraints('workspace_roles', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('workspace_roles', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
