// The tenant and the people in it (spec 0004). Each member holds a role (spec
// 0009); teams and invitations arrive with #23.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { actorCheck, actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';

const removedBy = actorColumns('removed_by');

/** One workspace: the tenant. Its row level security compares `id` itself to the setting. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: id().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    deletedAt: timestamptz('deleted_at'),
    /** A logo on our origin; none until #32, so screens show initials (spec 0031, AC-822). */
    logoUrl: text('logo_url'),
    /** The default time zone for the workspace's people and pages (spec 0031, AC-822). */
    timeZone: text('time_zone').notNull().default('UTC'),
    /** The default currency (ISO 4217) of new Currency attributes and imported amounts; none keeps the language's region's. */
    currency: text('currency'),
    /** The default country (ISO 3166 alpha 2) of new phone numbers; none keeps the language's region's. */
    country: text('country'),
    /** When a deleted workspace's purge may take it; set with `deleted_at`, cleared on restore (AC-823). */
    purgeAfter: timestamptz('purge_after'),
    ...auditColumns(),
  },
  (t) => [
    check('workspaces_purge_after', sql`${t.purgeAfter} is null or ${t.deletedAt} is not null`),
    check('workspaces_time_zone', sql`char_length(${t.timeZone}) between 1 and 64`),
    check('workspaces_currency', sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check('workspaces_country', sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
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

/**
 * The counts the limits module checks, and the outbox's last number, one row
 * per workspace, read and updated under `FOR UPDATE`. Every write takes it
 * last: the outbox hook numbers its rows from `outbox_seq` (spec 0005).
 */
export const workspaceCounters = pgTable(
  'workspace_counters',
  {
    workspaceId: workspaceId().primaryKey(),
    liveRecords: integer('live_records').notNull().default(0),
    customObjects: integer('custom_objects').notNull().default(0),
    lists: integer('lists').notNull().default(0),
    outboxSeq: bigint('outbox_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    foreignKey({ name: 'workspace_counters_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
  ],
);

/** Whether a member can still act in the workspace. */
export const memberStatus = pgEnum('member_status', ['active', 'removed']);

/**
 * A member's role (spec 0009): what workspace permissions they hold, from the
 * catalog in `@crm/contracts`. A live workspace always keeps one active owner
 * (`members_keep_an_owner`, migration 0022).
 */
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member']);

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
    role: memberRole('role').notNull().default('member'),
    /** Their picture, once file storage (#32) arrives; until then none, and screens show initials (spec 0031). */
    avatarUrl: text('avatar_url'),
    /** Their time zone in this workspace, an IANA name (spec 0031, slice 7); none means the browser's. */
    timeZone: text('time_zone'),
    /** When they left or were removed (spec 0031, AC-814); never set while `status` is `active`. */
    leftAt: timestamptz('left_at'),
    /** Who removed them (themself when they left). */
    removedByType: removedBy.type,
    removedById: removedBy.id,
    removedByMemberId: removedBy.memberId,
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
    check('members_avatar_url', sql`char_length(${t.avatarUrl}) <= 2048`),
    actorCheck('members_removed_by_actor', { type: t.removedByType, id: t.removedById, memberId: t.removedByMemberId }),
    foreignKey({
      name: 'members_removed_by',
      columns: [t.workspaceId, t.removedByMemberId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    // An active member never carries a leaving time; a removal sets one (rows removed before it take their last update's).
    check('members_left', sql`${t.status} = 'removed' or ${t.leftAt} is null`),
    check('members_time_zone', sql`char_length(${t.timeZone}) between 1 and 64`),
  ],
);

/**
 * A member's first run answers (spec 0036, About you): their role, team size
 * and the areas they mean to use, as `OnboardingAnswers` in
 * `@crm/contracts`. One row per member, written once with the workspace they
 * start; read only for that member, never shown to others.
 */
export const memberOnboarding = pgTable(
  'member_onboarding',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    answers: jsonb('answers').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_onboarding_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'member_onboarding_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
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
export function actorConstraints(
  table: string,
  role: string,
  workspace: AnyPgColumn,
  actor: ActorRef,
  options: { readonly withCalendar?: boolean } = {},
) {
  return [
    actorCheck(`${table}_${role}_actor`, actor, options),
    foreignKey({
      name: `${table}_${role}`,
      columns: [workspace, actor.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
  ];
}
