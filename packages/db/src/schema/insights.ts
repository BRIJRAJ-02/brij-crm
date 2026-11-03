// Analytics across products (spec 0067, migration 0173): one visit row per page kind, page, UTC day and visitor
// (the visitor is spec 0047's daily keyed hash and nothing else), the daily rollup the Insights screen reads, the
// days a visit changed since they were rolled up, and the numbers only share links. Every table is a tenant table.
import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { timestamptz, workspaceId } from './common.ts';
import { members } from './workspaces.ts';

/**
 * One visitor's visit to one public page on one UTC day (AC-6701). `source`, `medium` and `campaign` are words the
 * server normalised, `referrer_host` a host only, `landing` the landing address's UTM tags and whether a click id
 * was there. A trigger marks the day stale in `page_visit_stale_days` on every insert and update.
 */
export const pageVisits = pgTable(
  'page_visits',
  {
    workspaceId: workspaceId(),
    /** `form`, `booking`, `business_booking`, `reservation`, `event`, `link`, `menu` or `qr`. */
    pageKind: text('page_kind').notNull(),
    /** The form, booking page, or (for a link page) its owner's user id. No foreign key: kinds differ. */
    pageId: uuid('page_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    /** The daily keyed hash (spec 0047): 32 lowercase hex digits, never an address. */
    visitor: text('visitor').notNull(),
    source: text('source').notNull().default('direct'),
    medium: text('medium'),
    campaign: text('campaign'),
    referrerHost: text('referrer_host'),
    /** The landing address's UTM tags and click id presence (never the id). */
    landing: jsonb('landing'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    /** The furthest step reached short of the finish, and its place in the kind's steps. */
    furthestStep: text('furthest_step').notNull().default('view'),
    stepRank: smallint('step_rank').notNull().default(0),
    /** A form's furthest question, for its question drop off. */
    furthestDetail: text('furthest_detail'),
    durationMs: integer('duration_ms'),
    /** The submission or booking the finish made. */
    outcomeId: uuid('outcome_id'),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'page_visits_pkey', columns: [t.workspaceId, t.pageKind, t.pageId, t.day, t.visitor] }),
    index('page_visits_by_page_day').on(t.workspaceId, t.pageKind, t.pageId, t.day),
    index('page_visits_day').on(t.workspaceId, t.day),
    index('page_visits_recent').on(t.workspaceId, t.firstAt, t.pageKind, t.pageId, t.visitor),
    index('page_visits_page_recent').on(t.workspaceId, t.pageKind, t.pageId, t.firstAt),
    check('page_visits_visitor', sql`${t.visitor} ~ '^[0-9a-f]{32}$'`),
    check(
      'page_visits_kind',
      sql`${t.pageKind} in ('form', 'booking', 'business_booking', 'reservation', 'event', 'link', 'menu', 'qr')`,
    ),
    check('page_visits_source', sql`char_length(${t.source}) between 1 and 60`),
    check('page_visits_duration', sql`${t.durationMs} is null or ${t.durationMs} >= 0`),
  ],
);

/** The daily rollup (AC-6730): one row per page, day, source, medium, campaign, Other's host and step reached. */
export const pageVisitDays = pgTable(
  'page_visit_days',
  {
    workspaceId: workspaceId(),
    pageKind: text('page_kind').notNull(),
    pageId: uuid('page_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    source: text('source').notNull(),
    medium: text('medium').notNull().default(''),
    campaign: text('campaign').notNull().default(''),
    referrerHost: text('referrer_host').notNull().default(''),
    /** The furthest step the visits reached, or `finish`. */
    step: text('step').notNull(),
    visits: integer('visits').notNull(),
    finishes: integer('finishes').notNull(),
    durationSumMs: bigint('duration_sum_ms', { mode: 'number' }).notNull().default(0),
    durationCount: integer('duration_count').notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: 'page_visit_days_pkey',
      columns: [t.workspaceId, t.pageKind, t.pageId, t.day, t.source, t.medium, t.campaign, t.referrerHost, t.step],
    }),
    index('page_visit_days_day').on(t.workspaceId, t.day),
  ],
);

/** The days a visit changed since the rollup last ran: the job recomputes them, a read takes them from raw rows. */
export const pageVisitStaleDays = pgTable(
  'page_visit_stale_days',
  {
    workspaceId: workspaceId(),
    day: date('day', { mode: 'string' }).notNull(),
    markedAt: timestamptz('marked_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'page_visit_stale_days_pkey', columns: [t.workspaceId, t.day] })],
);

/**
 * A numbers only share link (AC-6720): the SHA-256 of its secret, the pages it shows (fixed when it was made), its
 * range, and when it expires or was revoked.
 */
export const insightShares = pgTable(
  'insight_shares',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    tokenHash: text('token_hash').notNull(),
    label: text('label').notNull(),
    /** What the maker picked: a kind, one page, or both null for every page they could see. */
    pageKind: text('page_kind'),
    pageId: uuid('page_id'),
    /** `[{ kind, id }]`: the pages it shows, as the maker could see them then. */
    pages: jsonb('pages').notNull(),
    range: text('range').notNull(),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    revokedByMemberId: uuid('revoked_by_member_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'insight_shares_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'insight_shares_creator',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    uniqueIndex('insight_shares_token').on(t.workspaceId, t.tokenHash),
    index('insight_shares_by_creator').on(t.workspaceId, t.createdByMemberId),
    check('insight_shares_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
