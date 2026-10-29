// Scheduling access (spec 0037, AC-1254): one row per delegation, See or
// Manage over one member, one team or everyone, given to one member (the
// delegate). `target_type` and `level` are text with no value check, as spec
// 0032 keeps `access_rules.level`, so a value from a newer deploy fails closed
// after a rollback; core validates both on write and reads an unknown one as
// nothing. `target_team_id` has no foreign key yet: teams arrive with spec 0031
// slice 8, whose migration adds it (AC-1443); until then core refuses a team
// target. `created_by` is who granted it; `updated_by` who last set its level.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, id, workspaceId } from './common.ts';
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
    // One delegation per delegate and target: a grant again changes its level.
    uniqueIndex('schedule_delegations_one').on(
      t.workspaceId,
      t.delegateMemberId,
      t.targetType,
      sql`coalesce(${t.targetMemberId}, ${t.targetTeamId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    // The delegate's reach (the scheduling choke point's one query) and the delegate cap.
    index('schedule_delegations_by_delegate').on(t.workspaceId, t.delegateMemberId),
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
