// The tenant and the people in it (spec 0004). Teams, roles and invitations
// arrive with #23 and #9; members here are just enough for every actor column
// to point at someone real.
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { actorCheck, auditColumns, id, timestamptz, workspaceId } from './common.ts';

/** One workspace: the tenant. Its row level security compares `id` itself to the setting. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: id().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    deletedAt: timestamptz('deleted_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('workspaces_slug')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    actorCheck('workspaces_created_by_actor', {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    actorCheck('workspaces_updated_by_actor', {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** The counts the limits module checks, one row per workspace, read and updated under `FOR UPDATE`. */
export const workspaceCounters = pgTable(
  'workspace_counters',
  {
    workspaceId: workspaceId().primaryKey(),
    liveRecords: integer('live_records').notNull().default(0),
    customObjects: integer('custom_objects').notNull().default(0),
    lists: integer('lists').notNull().default(0),
  },
  (t) => [
    foreignKey({ name: 'workspace_counters_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
  ],
);

/** Whether a member can still act in the workspace. */
export const memberStatus = pgEnum('member_status', ['active', 'removed']);

/** A person in a workspace. `user_id` is the signed in identity (`auth.user`), set for everyone who signs in. */
export const members = pgTable(
  'members',
  {
    workspaceId: workspaceId(),
    id: id(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    status: memberStatus('status').notNull().default('active'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'members_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'members_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    foreignKey({
      name: 'members_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    foreignKey({
      name: 'members_updated_by',
      columns: [t.workspaceId, t.updatedByMemberId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    uniqueIndex('members_email')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'active'`),
    // One active member per signed in user in a workspace: the access door finds the actor by it (spec 0005).
    uniqueIndex('members_user')
      .on(t.workspaceId, t.userId)
      .where(sql`${t.status} = 'active'`),
    actorCheck('members_created_by_actor', { type: t.createdByType, id: t.createdById, memberId: t.createdByMemberId }),
    actorCheck('members_updated_by_actor', { type: t.updatedByType, id: t.updatedById, memberId: t.updatedByMemberId }),
  ],
);

/** The columns of one actor, as a table's config sees them. */
interface ActorRef {
  readonly type: AnyPgColumn;
  readonly id: AnyPgColumn;
  readonly memberId: AnyPgColumn;
}

/**
 * The constraints one actor needs on a tenant table: its shape check, and a
 * foreign key from `*_member_id` to `members` that carries `workspace_id`.
 */
export function actorConstraints(table: string, role: string, workspace: AnyPgColumn, actor: ActorRef) {
  return [
    actorCheck(`${table}_${role}_actor`, actor),
    foreignKey({
      name: `${table}_${role}`,
      columns: [workspace, actor.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
  ];
}
