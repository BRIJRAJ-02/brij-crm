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
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
      name: 'routing_decisions_routed_page',
      columns: [t.workspaceId, t.routedPageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }),
    // The report: one surface's decisions in a window.
    index('routing_decisions_by_surface').on(t.workspaceId, t.surfaceId, t.decidedAt),
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
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'routing_settings_pkey', columns: [t.workspaceId] }),
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
