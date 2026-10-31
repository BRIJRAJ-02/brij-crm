// Scheduling access (spec 0037, AC-1254): one row per delegation, See or
// Manage over one member, one team or everyone, given to one member (the
// delegate). `target_type` and `level` are text with no value check, as spec
// 0032 keeps `access_rules.level`, so a value from a newer deploy fails closed
// after a rollback; core validates both on write and reads an unknown one as
// nothing. `target_team_id` points at `teams` with `on delete cascade`
// (migration 0142, AC-1443), so a deleted team's delegations go with it.
// `created_by` is who granted it; `updated_by` who last set its level.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, workspaceId } from './common.ts';
import { teams } from './teams.ts';
import { actorConstraints, members } from './workspaces.ts';

/** One delegation of See or Manage over someone's scheduling (spec 0037, AC-1254). */
export const scheduleDelegations = pgTable(
  'schedule_delegations',
  {
    workspaceId: workspaceId(),
    id: id(),
    delegateMemberId: uuid('delegate_member_id').notNull(),
    /** `member`, `team` or `everyone`; anything else grants nothing. */
    targetType: text('target_type').notNull(),
    targetMemberId: uuid('target_member_id'),
    targetTeamId: uuid('target_team_id'),
    /** `view` or `manage`; anything else grants nothing. */
    level: text('level').notNull(),
    /** True when the member it is over granted it themself (AC-1255). */
    grantedBySelf: boolean('granted_by_self').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'schedule_delegations_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'schedule_delegations_delegate',
      columns: [t.workspaceId, t.delegateMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'schedule_delegations_target_member',
      columns: [t.workspaceId, t.targetMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'schedule_delegations_target_team',
      columns: [t.workspaceId, t.targetTeamId],
      foreignColumns: [teams.workspaceId, teams.id],
    }).onDelete('cascade'),
    // One delegation per delegate and target: a grant again changes its level. Its prefix also serves the delegate's
    // reach (the scheduling choke point's one query), the delegate cap and the removal.
    uniqueIndex('schedule_delegations_one').on(
      t.workspaceId,
      t.delegateMemberId,
      t.targetType,
      sql`coalesce(${t.targetMemberId}, ${t.targetTeamId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    // Who reaches a member (the removal, the target cap, "Who can see or manage your scheduling").
    index('schedule_delegations_by_target_member')
      .on(t.workspaceId, t.targetMemberId)
      .where(sql`${t.targetMemberId} is not null`),
    index('schedule_delegations_by_target_team')
      .on(t.workspaceId, t.targetTeamId)
      .where(sql`${t.targetTeamId} is not null`),
    check('schedule_delegations_one_target', sql`num_nonnulls(${t.targetMemberId}, ${t.targetTeamId}) <= 1`),
    check('schedule_delegations_not_self', sql`${t.delegateMemberId} <> ${t.targetMemberId}`),
    ...actorConstraints('schedule_delegations', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('schedule_delegations', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * A member's meeting limits across every page (spec 0037, AC-1297): at most `per_day` meetings a day (1 to 50) and
 * `per_week` a week (1 to 200), each optional, counted in their default schedule's zone, weeks from Monday. One row
 * per member; a row with neither limit is deleted rather than kept.
 */
export const memberBookingLimits = pgTable(
  'member_booking_limits',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    perDay: smallint('per_day'),
    perWeek: smallint('per_week'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'member_booking_limits_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'member_booking_limits_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('member_booking_limits_per_day', sql`${t.perDay} is null or ${t.perDay} between 1 and 50`),
    check('member_booking_limits_per_week', sql`${t.perWeek} is null or ${t.perWeek} between 1 and 200`),
    check('member_booking_limits_some', sql`num_nonnulls(${t.perDay}, ${t.perWeek}) > 0`),
    ...actorConstraints('member_booking_limits', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('member_booking_limits', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
