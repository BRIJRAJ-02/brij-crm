// Teams and access rules (specs 0031 slice 8 and 0032): `teams` and who is in them, then the rules that name a role
// or a team and say what it may do with an object, a field of it, or which of its records. The rules are text on
// purpose (`level`, `kind`, `subject_role`), as `schedule_delegations` keeps its levels: a value written by a newer
// deploy reads as nothing after a rollback, so the code fails closed instead of the database refusing the row.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { attributes, objects } from './definitions.ts';
import { actorConstraints, members } from './workspaces.ts';

/** A group of members that access rules can name (spec 0031, AC-824). Flat: no nesting, no leads. */
export const teams = pgTable(
  'teams',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** 1 to 64 characters, unique ignoring case within the workspace. */
    name: text('name').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'teams_pkey', columns: [t.workspaceId, t.id] }),
    uniqueIndex('teams_name').on(t.workspaceId, sql`lower(${t.name})`),
    check('teams_name_length', sql`char_length(${t.name}) between 1 and 64`),
    ...actorConstraints('teams', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('teams', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

const teamMemberCreator = actorColumns('created_by');

/** One member in one team (spec 0031, AC-824). A member may be in any number of teams. */
export const teamMembers = pgTable(
  'team_members',
  {
    workspaceId: workspaceId(),
    teamId: uuid('team_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: teamMemberCreator.type.notNull(),
    createdById: teamMemberCreator.id,
    createdByMemberId: teamMemberCreator.memberId,
  },
  (t) => [
    primaryKey({ name: 'team_members_pkey', columns: [t.workspaceId, t.teamId, t.memberId] }),
    foreignKey({
      name: 'team_members_team',
      columns: [t.workspaceId, t.teamId],
      foreignColumns: [teams.workspaceId, teams.id],
    }),
    foreignKey({
      name: 'team_members_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The door's read: a member's teams.
    index('team_members_by_member').on(t.workspaceId, t.memberId),
    ...actorConstraints('team_members', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
  ],
);

/**
 * One object or field rule (spec 0032, AC-841): who it is about (a role or a team), the object, the attribute when it
 * is a field rule, and the level as stored text. Exactly one of `subject_role` and `subject_team_id` is set.
 */
export const accessRules = pgTable(
  'access_rules',
  {
    workspaceId: workspaceId(),
    id: id(),
    subjectType: text('subject_type').notNull(),
    subjectRole: text('subject_role'),
    subjectTeamId: uuid('subject_team_id'),
    objectId: uuid('object_id').notNull(),
    attributeId: uuid('attribute_id'),
    level: text('level').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'access_rules_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'access_rules_team',
      columns: [t.workspaceId, t.subjectTeamId],
      foreignColumns: [teams.workspaceId, teams.id],
    }),
    foreignKey({
      name: 'access_rules_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'access_rules_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    check(
      'access_rules_subject',
      sql`(${t.subjectType} = 'role' and ${t.subjectRole} is not null and ${t.subjectTeamId} is null and ${t.subjectRole} in ('member', 'guest'))
        or (${t.subjectType} = 'team' and ${t.subjectRole} is null and ${t.subjectTeamId} is not null)`,
    ),
    // One rule per subject, object and field: a set replaces it.
    uniqueIndex('access_rules_one').on(
      t.workspaceId,
      t.objectId,
      sql`coalesce(${t.subjectRole}, '')`,
      sql`coalesce(${t.subjectTeamId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.attributeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    // The door's read: a role's rules and a set of teams' rules.
    index('access_rules_by_role')
      .on(t.workspaceId, t.subjectRole)
      .where(sql`${t.subjectRole} is not null`),
    index('access_rules_by_team')
      .on(t.workspaceId, t.subjectTeamId)
      .where(sql`${t.subjectTeamId} is not null`),
    ...actorConstraints('access_rules', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('access_rules', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * One record rule (spec 0032, AC-847): the subject sees only the records whose member attribute names them (`own`) or
 * anyone in their teams (`team`). `kind` is stored text; one the code doesn't know hides the object from its subject.
 */
export const recordRules = pgTable(
  'record_rules',
  {
    workspaceId: workspaceId(),
    id: id(),
    subjectType: text('subject_type').notNull(),
    subjectRole: text('subject_role'),
    subjectTeamId: uuid('subject_team_id'),
    objectId: uuid('object_id').notNull(),
    kind: text('kind').notNull(),
    attributeId: uuid('attribute_id').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'record_rules_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'record_rules_team',
      columns: [t.workspaceId, t.subjectTeamId],
      foreignColumns: [teams.workspaceId, teams.id],
    }),
    foreignKey({
      name: 'record_rules_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'record_rules_attribute',
      columns: [t.workspaceId, t.attributeId],
      foreignColumns: [attributes.workspaceId, attributes.id],
    }),
    check(
      'record_rules_subject',
      sql`(${t.subjectType} = 'role' and ${t.subjectRole} is not null and ${t.subjectTeamId} is null and ${t.subjectRole} in ('member', 'guest'))
        or (${t.subjectType} = 'team' and ${t.subjectRole} is null and ${t.subjectTeamId} is not null)`,
    ),
    uniqueIndex('record_rules_one').on(
      t.workspaceId,
      t.objectId,
      sql`coalesce(${t.subjectRole}, '')`,
      sql`coalesce(${t.subjectTeamId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('record_rules_by_role')
      .on(t.workspaceId, t.subjectRole)
      .where(sql`${t.subjectRole} is not null`),
    index('record_rules_by_team')
      .on(t.workspaceId, t.subjectTeamId)
      .where(sql`${t.subjectTeamId} is not null`),
    ...actorConstraints('record_rules', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('record_rules', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);
