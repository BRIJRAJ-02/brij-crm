// Round robin (spec 0029, amended by spec 0037 before this first migration):
// a rotation is a pool of members that team booking pages (and, from
// milestone 3, forms) hand work to fairly. `rotation_assignments` is its
// append only ledger: one live row per assignment with its reason, counted
// on read (the sum of live `units` over the rotation's window) under the
// rotation's advisory lock; cancelling or reassigning sets `voided_at`. A
// page names its rotation in `booking_page_rotations` (position 0; spec 0037
// allows up to 3), never in a column of its own. The record id a form's
// assignment names carries no foreign key, as a booking's record ids don't.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
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

/** A rotation: its name, how it picks (Fair, Priority or Even), the window it counts over, and returning guests. */
export const rotations = pgTable(
  'rotations',
  {
    workspaceId: workspaceId(),
    id: id(),
    name: text('name').notNull(),
    /**
     * `fair`: fewest bookings in the window for their weight; `priority`: the highest priority free member first;
     * `even` (spec 0037, AC-1325): as Fair, but anyone `even_gap` or more ahead waits until the others catch up.
     */
    strategy: text('strategy').notNull().default('fair'),
    /** Even's gap, in meetings at equal weights (1 to 10). */
    evenGap: smallint('even_gap').notNull().default(3),
    /** The rolling window fairness counts over, in days: 7, 30 or 90. */
    windowDays: smallint('window_days').notNull().default(30),
    /**
     * Where a returning guest goes (spec 0037, AC-1328, replacing spec 0029's owner first): `owner` (a known person's
     * owner, AC-739), `last_host` (the host they met last on a page using the rotation), or `none` (the rotation).
     */
    returning: text('returning').notNull().default('owner'),
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    primaryKey({ name: 'rotations_pkey', columns: [t.workspaceId, t.id] }),
    index('rotations_live')
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    check('rotations_name', sql`char_length(${t.name}) between 1 and 80`),
    check('rotations_strategy', sql`${t.strategy} in ('fair', 'priority', 'even')`),
    check('rotations_even_gap', sql`${t.evenGap} between 1 and 10`),
    check('rotations_returning', sql`${t.returning} in ('owner', 'last_host', 'none')`),
    check('rotations_window', sql`${t.windowDays} in (7, 30, 90)`),
    ...actorConstraints('rotations', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('rotations', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** A member of a rotation: their weight, priority, daily cap, on or off, and the count credited when they joined. */
export const rotationMembers = pgTable(
  'rotation_members',
  {
    workspaceId: workspaceId(),
    rotationId: uuid('rotation_id').notNull(),
    memberId: uuid('member_id').notNull(),
    /** 1 to 100: a member at 50 takes half the share of one at 100. */
    weight: smallint('weight').notNull().default(100),
    /** 0 lowest to 4 highest; 2 is medium. */
    priority: smallint('priority').notNull().default(2),
    /** At most this many of the rotation's assignments on one of their days; null for no cap. */
    dailyCap: smallint('daily_cap'),
    /** At most this many in one of their weeks, Monday to Sunday (spec 0037, AC-1326); null for no cap. */
    weeklyCap: smallint('weekly_cap'),
    /** Switched off: skipped until switched back on; their bookings stay theirs. */
    isOn: boolean('is_on').notNull().default(true),
    /** The count credited on joining (the pool's average then), so a newcomer isn't flooded (AC-730). */
    calibration: numeric('calibration', { precision: 10, scale: 2, mode: 'number' }).notNull().default(0),
    position: smallint('position').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'rotation_members_pkey', columns: [t.workspaceId, t.rotationId, t.memberId] }),
    foreignKey({
      name: 'rotation_members_rotation',
      columns: [t.workspaceId, t.rotationId],
      foreignColumns: [rotations.workspaceId, rotations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'rotation_members_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // A member's rotations (they leave, Settings shows their share), and the member foreign key's check.
    index('rotation_members_by_member').on(t.workspaceId, t.memberId),
    check('rotation_members_weight', sql`${t.weight} between 1 and 100`),
    check('rotation_members_priority', sql`${t.priority} between 0 and 4`),
    check('rotation_members_daily_cap', sql`${t.dailyCap} is null or ${t.dailyCap} between 1 and 50`),
    check('rotation_members_weekly_cap', sql`${t.weeklyCap} is null or ${t.weeklyCap} between 1 and 200`),
    check('rotation_members_calibration', sql`${t.calibration} >= 0`),
    check('rotation_members_position', sql`${t.position} between 0 and 19`),
    ...actorConstraints('rotation_members', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('rotation_members', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * The ledger: one row per assignment, with why (`reason`) and what it compared
 * (`detail`). Append only, but for `voided_at` (a cancel or a reassignment).
 * `units` is 1 for every assignment (spec 0037 keeps it for count adjustments).
 */
export const rotationAssignments = pgTable(
  'rotation_assignments',
  {
    workspaceId: workspaceId(),
    id: id(),
    rotationId: uuid('rotation_id').notNull(),
    memberId: uuid('member_id').notNull(),
    /** `booking` (a team page), `form` (milestone 3's `assignOwner`) or `adjustment` (spec 0037, AC-1329). */
    source: text('source').notNull(),
    bookingId: uuid('booking_id'),
    recordId: uuid('record_id'),
    reason: text('reason').notNull(),
    units: smallint('units').notNull().default(1),
    /** The counts and weights compared, the actor of a manual one: what the booking's detail says in words. */
    detail: jsonb('detail').notNull().default({}),
    assignedAt: timestamptz('assigned_at').notNull().defaultNow(),
    voidedAt: timestamptz('voided_at'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'rotation_assignments_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'rotation_assignments_rotation',
      columns: [t.workspaceId, t.rotationId],
      foreignColumns: [rotations.workspaceId, rotations.id],
    }),
    foreignKey({
      name: 'rotation_assignments_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'rotation_assignments_booking',
      columns: [t.workspaceId, t.bookingId],
      foreignColumns: [bookings.workspaceId, bookings.id],
    }),
    // The window count: one index range per rotation.
    index('rotation_assignments_window')
      .on(t.workspaceId, t.rotationId, t.assignedAt)
      .where(sql`${t.voidedAt} is null`),
    // One live assignment per booking and rotation, and per lead and rotation.
    uniqueIndex('rotation_assignments_booking_live')
      .on(t.workspaceId, t.bookingId, t.rotationId)
      .where(sql`${t.voidedAt} is null and ${t.bookingId} is not null`),
    uniqueIndex('rotation_assignments_record_live')
      .on(t.workspaceId, t.recordId, t.rotationId)
      .where(sql`${t.voidedAt} is null and ${t.recordId} is not null`),
    // A booking's assignments, voided ones too (its detail), and the booking foreign key's check.
    index('rotation_assignments_by_booking')
      .on(t.workspaceId, t.bookingId)
      .where(sql`${t.bookingId} is not null`),
    // A member's assignments (their rows on Settings, and the member foreign key's check).
    index('rotation_assignments_by_member').on(t.workspaceId, t.memberId, t.assignedAt),
    check('rotation_assignments_source', sql`${t.source} in ('booking', 'form', 'adjustment')`),
    check(
      'rotation_assignments_subject',
      sql`(${t.source} = 'booking' and ${t.bookingId} is not null and ${t.reason} <> 'adjustment')
        or (${t.source} = 'form' and ${t.recordId} is not null and ${t.reason} <> 'adjustment')
        or (${t.source} = 'adjustment' and ${t.reason} = 'adjustment' and ${t.bookingId} is null and ${t.recordId} is null)`,
    ),
    check(
      'rotation_assignments_reason',
      sql`${t.reason} in ('fair', 'priority', 'even', 'owner', 'last_host', 'standin', 'only_free', 'routed', 'manual', 'reassigned', 'adjustment')`,
    ),
    check(
      'rotation_assignments_units',
      sql`(${t.reason} = 'adjustment' and ${t.units} between -20 and 20 and ${t.units} <> 0) or ${t.units} = 1`,
    ),
    check('rotation_assignments_voided', sql`${t.voidedAt} is null or ${t.voidedAt} >= ${t.assignedAt}`),
    ...actorConstraints('rotation_assignments', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('rotation_assignments', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/** The rotations a round robin page books from, one host from each, by position (spec 0037, AC-1319: up to 3). */
export const bookingPageRotations = pgTable(
  'booking_page_rotations',
  {
    workspaceId: workspaceId(),
    pageId: uuid('page_id').notNull(),
    rotationId: uuid('rotation_id').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'booking_page_rotations_pkey', columns: [t.workspaceId, t.pageId, t.rotationId] }),
    foreignKey({
      name: 'booking_page_rotations_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'booking_page_rotations_rotation',
      columns: [t.workspaceId, t.rotationId],
      foreignColumns: [rotations.workspaceId, rotations.id],
    }).onDelete('restrict'),
    uniqueIndex('booking_page_rotations_position').on(t.workspaceId, t.pageId, t.position),
    // The pages using a rotation (its delete guard, "Used by 2 pages").
    index('booking_page_rotations_by_rotation').on(t.workspaceId, t.rotationId),
    check('booking_page_rotations_position_range', sql`${t.position} between 0 and 2`),
  ],
);
