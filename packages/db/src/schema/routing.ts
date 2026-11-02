// Lead routing (spec 0043): one row per routing decision, so each rule's
// report (matched, booked, no show, qualified) is counted from what happened.
// A form's decision is made at submit and names its submission; a booking
// that follows its hand off fills `booking_id`. A team page's decision is
// made at the booking and names it at once. Rules themselves live with their
// surface: a form's in its version document, a team page's in
// `booking_pages.routing`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookingPages, bookings } from './booking.ts';
import { auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, members } from './workspaces.ts';

/** One routing decision: the surface, the rule that matched (none: the fallback), its tag and where it sent the lead. */
export const routingDecisions = pgTable(
  'routing_decisions',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** `form` (decided at submit) or `booking_page` (decided at the booking). */
    surfaceKind: text('surface_kind').notNull(),
    /** The form's or the team page's id. No foreign key: a form's decisions outlive nothing it needs. */
    surfaceId: uuid('surface_id').notNull(),
    /** The matching rule's id in its list; null for the fallback. */
    ruleId: text('rule_id'),
    /** The rule's tag: qualified, not qualified, or null for none. */
    qualified: boolean('qualified'),
    /** Rules skipped because a fact they read couldn't be read (AC-1602), by id. */
    skipped: text('skipped')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The form submission a form's decision was made for. */
    submissionId: uuid('submission_id'),
    /** The booking page a form's rule sent the visitor to, and the hosts it narrowed to. */
    routedPageId: uuid('routed_page_id'),
    hosts: uuid('hosts').array(),
    /** The booking that followed (a form's hand off) or was made (a team page's). */
    bookingId: uuid('booking_id'),
    /**
     * What happened beyond the rule, in order (spec 0037, AC-1358): `RoutingStep`s, `{ kind, pageId?, reason? }`, such as a
     * page with no free time and the fallback used instead. Null when nothing did. Nullable with no default (AC-1446).
     */
    steps: jsonb('steps'),
    /**
     * The lead owner claim (spec 0037, AC-1372), on `form` rows only: whoever sets `assigned_at` from null wins and
     * writes the owner, so a booking and the unbooked job can never both assign. Nullable with no default (AC-1446).
     */
    assignedMemberId: uuid('assigned_member_id'),
    assignedAt: timestamptz('assigned_at'),
    /**
     * The values the ranking and fit used (AC-1362), as option ids, numbers or yes or no, each marked `answered` or
     * `record`; never free text.
     */
    facts: jsonb('facts'),
    /** Every candidate's numbers at the booking (AC-1373), on `booking_page` rows only: every explanation reads this. */
    snapshot: jsonb('snapshot'),
    /**
     * This decision was drawn into the holdout (spec 0037, AC-1389), so it picked plain fair and the comparison
     * reads it as its control arm. Null, on a ranked row, is "not drawn". Nullable with no default (AC-1446).
     */
    holdout: boolean('holdout'),
    /**
     * The segment the learning counts this decision in (AC-1370): `*` when the workspace sets no segment attributes,
     * `?` when the lead was missing a value, else the canonical `attribute=option;attribute=option`.
     */
    segmentKey: text('segment_key'),
    decidedAt: timestamptz('decided_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'routing_decisions_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'routing_decisions_booking',
      columns: [t.workspaceId, t.bookingId],
      foreignColumns: [bookings.workspaceId, bookings.id],
    }),
    foreignKey({
      name: 'routing_decisions_assigned_member',
      columns: [t.workspaceId, t.assignedMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'routing_decisions_routed_page',
      columns: [t.workspaceId, t.routedPageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }),
    // The report: one surface's decisions in a window.
    index('routing_decisions_by_surface').on(t.workspaceId, t.surfaceId, t.decidedAt),
    // The nightly learning run (spec 0037, AC-1381): a workspace's ranked decisions by time, and nothing else.
    index('routing_decisions_ranked')
      .on(t.workspaceId, t.decidedAt)
      .where(sql`${t.snapshot} is not null`),
    // Routing › Decisions (spec 0037, AC-1383): every surface's decisions, newest first, keyset paged by time and id.
    index('routing_decisions_by_time').on(t.workspaceId, t.decidedAt.desc(), t.id.desc()),
    // One decision per submission (AC-1607), which a hand off's booking finds it by: a retried or doubled submit
    // can never decide twice, nor count twice in a rule's report.
    uniqueIndex('routing_decisions_one_per_submission')
      .on(t.workspaceId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    // One team page decision per booking (AC-1611).
    uniqueIndex('routing_decisions_one_per_booking')
      .on(t.workspaceId, t.bookingId)
      .where(sql`${t.surfaceKind} = 'booking_page'`),
    check('routing_decisions_surface', sql`${t.surfaceKind} in ('form', 'booking_page')`),
    check('routing_decisions_submission', sql`(${t.surfaceKind} = 'form') = (${t.submissionId} is not null)`),
    // Named hosts are 1 to 8; members with skills (spec 0037, AC-1356) up to a whole roster.
    check('routing_decisions_hosts', sql`${t.hosts} is null or cardinality(${t.hosts}) between 1 and 200`),
    // The claim is a form's (AC-1372): a team page's row never holds one, and a member without a time never counts.
    check(
      'routing_decisions_claim',
      sql`(${t.assignedMemberId} is null and ${t.assignedAt} is null) or (${t.surfaceKind} = 'form' and ${t.assignedAt} is not null)`,
    ),
  ],
);

/**
 * What every routed surface shares (spec 0037, AC-1351): one row per workspace, made by the first setting stored; a
 * workspace without it reads the defaults. L7 adds Won means; L8 and L9 add their columns.
 */
export const routingSettings = pgTable(
  'routing_settings',
  {
    workspaceId: workspaceId(),
    /** Won means (AC-1385): `{ attributeId, optionIds[] }`, the Deals stage and the stages that count as won. */
    wonStage: jsonb('won_stage'),
    /** `off`, `fit` or `learn` (AC-1361); null, or anything else, reads as the code's own default (AC-1223). */
    smartMode: text('smart_mode'),
    /** The fairness allowance, 0 to 50 percent (AC-1363); null reads as the default 20. */
    tiltPercent: smallint('tilt_percent'),
    /** The fit links (AC-1362): up to 100 `{ attributeId, optionId, skillId }`. */
    fit: jsonb('fit'),
    /** The holdout, 0 to 20 percent of ranked decisions (AC-1389); null reads as the default 10. */
    holdoutPercent: smallint('holdout_percent'),
    /** The segment attributes (AC-1370): at most 2 select or status fields of Companies or Deals. */
    segmentAttributeIds: uuid('segment_attribute_ids').array(),
    /** Learn from (AC-1386): the next run ignores outcomes of bookings made before this day. */
    learnSince: date('learn_since'),
    /** The model the ranking reads its lift from (AC-1381); 0 until a run has trained one. */
    modelVersion: integer('model_version').notNull().default(0),
    /** When the last run finished: the fan out skips a workspace where nothing it reads changed since. */
    modelTrainedAt: timestamptz('model_trained_at'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'routing_settings_pkey', columns: [t.workspaceId] }),
    check('routing_settings_tilt', sql`${t.tiltPercent} is null or ${t.tiltPercent} between 0 and 50`),
    check('routing_settings_holdout', sql`${t.holdoutPercent} is null or ${t.holdoutPercent} between 0 and 20`),
    check(
      'routing_settings_segments',
      sql`${t.segmentAttributeIds} is null or cardinality(${t.segmentAttributeIds}) between 0 and 2`,
    ),
    ...actorConstraints('routing_settings', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('routing_settings', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** One skill (spec 0037, AC-1382): a name in a group, at most 100 a workspace (core). */
export const routingSkills = pgTable(
  'routing_skills',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** `language`, `region`, `segment`, `product` or `other`. */
    skillGroup: text('skill_group').notNull(),
    name: text('name').notNull(),
    /** Its place in its group. */
    position: integer('position').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'routing_skills_pkey', columns: [t.workspaceId, t.id] }),
    // One name per group, ignoring case.
    uniqueIndex('routing_skills_name').on(t.workspaceId, t.skillGroup, sql`lower(${t.name})`),
    check('routing_skills_group', sql`${t.skillGroup} in ('language', 'region', 'segment', 'product', 'other')`),
    check('routing_skills_name_length', sql`char_length(${t.name}) between 1 and 40`),
    ...actorConstraints('routing_skills', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('routing_skills', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** A member holds a skill (AC-1382). A skill's deletion takes its rows; a member's removal deletes theirs (AC-1440). */
export const memberSkills = pgTable(
  'member_skills',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_skills_pkey', columns: [t.workspaceId, t.memberId, t.skillId] }),
    foreignKey({
      name: 'member_skills_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'member_skills_skill',
      columns: [t.workspaceId, t.skillId],
      foreignColumns: [routingSkills.workspaceId, routingSkills.id],
    }).onDelete('cascade'),
    // Who holds a skill: a host route's members, and a skill's deletion.
    index('member_skills_by_skill').on(t.workspaceId, t.skillId),
  ],
);

/**
 * What one nightly run learned (spec 0037, AC-1369, AC-1370, AC-1381): one row per member per cell, a cell being a
 * team page, the seat's rotation, the segment and the page's objective. The ranking reads one cell by the primary
 * key's prefix. Machine written and replaced nightly, so no audit columns; a new version is written beside the old
 * one and switched in by the run's last batch.
 */
export const routingStats = pgTable(
  'routing_stats',
  {
    workspaceId: workspaceId(),
    /** The model this row belongs to: `routing_settings.model_version` is the one the ranking reads. */
    modelVersion: integer('model_version').notNull(),
    pageId: uuid('page_id').notNull(),
    rotationId: uuid('rotation_id').notNull(),
    /** `*`, `?`, or the canonical `attribute=option;attribute=option` (AC-1370). */
    segmentKey: text('segment_key').notNull(),
    /** `held`, `deal` or `won` (AC-1354). */
    objective: text('objective').notNull(),
    memberId: uuid('member_id').notNull(),
    /** Ranked decisions credited to this member in this cell whose outcome window has passed (AC-1368). */
    trials: integer('trials').notNull().default(0),
    /** How many of them met the objective (AC-1366). */
    successes: integer('successes').notNull().default(0),
    /** Counted, but still inside their outcome window: what Insights says is "waiting" (AC-1376). */
    waiting: integer('waiting').notNull().default(0),
    trainedAt: timestamptz('trained_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'routing_stats_pkey',
      columns: [t.workspaceId, t.modelVersion, t.pageId, t.rotationId, t.segmentKey, t.objective, t.memberId],
    }),
    check('routing_stats_objective', sql`${t.objective} in ('held', 'deal', 'won')`),
    check('routing_stats_counts', sql`${t.trials} >= 0 and ${t.successes} >= 0 and ${t.successes} <= ${t.trials}`),
    // Dropping the versions older than the previous one, after a run switched (AC-1381).
    index('routing_stats_by_version').on(t.workspaceId, t.modelVersion),
  ],
);
