// Lead routing (spec 0043): one row per routing decision, so each rule's
// report (matched, booked, no show, qualified) is counted from what happened.
// A form's decision is made at submit and names its submission; a booking
// that follows its hand off fills `booking_id`. A team page's decision is
// made at the booking and names it at once. Rules themselves live with their
// surface: a form's in its version document, a team page's in
// `booking_pages.routing`.
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bookingPages, bookings } from './booking.ts';
import { id, timestamptz, workspaceId } from './common.ts';

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
    check('routing_decisions_hosts', sql`${t.hosts} is null or cardinality(${t.hosts}) between 1 and 8`),
  ],
);
