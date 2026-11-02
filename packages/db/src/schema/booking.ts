// Booking pages (spec 0025, milestone 1): a member's page, the members it
// books (the owner alone for a personal page), and the bookings visitors make.
// A page is found publicly by its random `public_key` before the workspace is
// known (`crm_booking_page_by_key`, migration 0039), so that key is unique
// everywhere. A booking's `during` is its meeting widened by the page's
// buffers; the exclusion constraint `bookings_no_overlap` (hand written in the
// migration, it needs btree_gist) refuses two confirmed bookings of one host
// whose `during` overlap, the last guard under the per host advisory lock.
// The record ids a booking names (person, company, deal) carry no foreign key:
// a record removed for good leaves the booking naming nothing, never failing
// the purge. `meeting_id` is spec 0024's meeting (its key arrives with it).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
import { auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, members } from './workspaces.ts';
import { objects } from './definitions.ts';
import { teams } from './teams.ts';

/** A `tstzrange`, read and written as Postgres' text form (`["2026-10-19 09:45:00+00","2026-10-19 10:45:00+00")`). */
/** Every meeting length a page may offer, as a Postgres array literal: 5 to 480 minutes in steps of 5 (contracts' `BookingDuration`). */
const DURATION_SET = `'{${Array.from({ length: 96 }, (_, index) => String((index + 1) * 5)).join(',')}}'`;
const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

/** One booking page. Deleting one keeps its bookings (AC-648): it is hidden, its link answers no longer available. */
export const bookingPages = pgTable(
  'booking_pages',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** Random, URL safe, 16 characters: the public link's key. */
    publicKey: text('public_key').notNull(),
    /**
     * The page's address after its owner's handle, `/<handle>/<slug>` (22 Oct 2026): unique among the owner member's
     * live pages in this workspace (`booking_pages_slug`); a handle belongs to one workspace (spec 0056), so the same
     * slug may repeat across a person's workspaces and each address still names one page.
     */
    slug: text('slug').notNull(),
    kind: text('kind').notNull().default('personal'),
    /**
     * Whose page it is (workspace link, migration 0128): `member`, a person's, or `workspace`, the workspace's own
     * round robin link. A workspace page's `owner_member_id` is only who made it; it has no `owner_user_id`, so it is
     * on nobody's profile and has no `/<handle>/<slug>` address, and its slug is unique among the workspace's pages.
     */
    scope: text('scope').notNull().default('member'),
    ownerMemberId: uuid('owner_member_id').notNull(),
    /**
     * The owner member's identity (`auth.user.id`), kept by the trigger crm_booking_pages_owner_user (0086) from
     * `members.user_id`: what makes a slug unique per handle across workspaces. Null for a member without one.
     */
    ownerUserId: uuid('owner_user_id'),
    /** The small heading this page sits under on its owner's profile (`/<handle>`), or none. */
    profileSection: text('profile_section'),
    /** Where the page sits on its owner's profile: lower first, then oldest first. */
    profilePosition: smallint('profile_position').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Meeting lengths offered, in minutes: one to four, each 5 to 480 in steps of 5. */
    durations: smallint('durations').array().notNull(),
    /** `{ type: 'video' | 'phone' | 'address' | 'custom', value? }`. */
    location: jsonb('location').notNull(),
    /** `{ timeZone, weekly: { mon: [[start, end]], … }, overrides: [{ date, ranges }] }`, times `HH:MM`. */
    availability: jsonb('availability').notNull(),
    bufferBefore: smallint('buffer_before').notNull().default(0),
    bufferAfter: smallint('buffer_after').notNull().default(0),
    minNoticeMinutes: integer('min_notice_minutes').notNull().default(0),
    windowDays: smallint('window_days').notNull().default(60),
    dailyLimit: smallint('daily_limit'),
    /** How often a slot starts; null steps by the chosen duration. */
    slotStep: smallint('slot_step'),
    /**
     * The page's own questions (spec 0057, AC-5701): spec 0023's `FormQuestion` list, at most 20, checked by the
     * contracts' `BookingQuestions` on every write and again on read.
     */
    questions: jsonb('questions').notNull().default([]),
    /**
     * Whether a booking finds or makes the visitor's records and files the answers onto the person (spec 0057,
     * AC-5708, migration 0114): on by default, which is what every page did before.
     */
    fileToCrm: boolean('file_to_crm').notNull().default(true),
    /**
     * The object the page's answers are filed onto (booking answers parity, migration 0117): null is the
     * workspace's People, which is what every page did before, so nothing is backfilled. The booking still matches
     * or makes the visitor's Person; only where the answers land moves.
     */
    answersObjectId: uuid('answers_object_id'),
    /** A team page's routing rules (spec 0043, AC-1608): `RoutingRules`, tried at each booking. */
    routing: jsonb('routing').notNull().default({ rules: [] }),
    /**
     * Only through a form (spec 0037, AC-1388): a team page that books only with a form's hand off. Off by default, so no
     * page changes behaviour by itself; `booking_pages` is small, so the default is safe (AC-1446).
     */
    formOnly: boolean('form_only').notNull().default(false),
    /** `{ mode: 'create' | 'move_open', stageOptionId }` (milestone 2). */
    deal: jsonb('deal'),
    status: text('status').notNull().default('live'),
    /**
     * Why the system paused it (spec 0031, AC-814): `host_removed` when nobody
     * is left to host it. Null for a page its people paused, and cleared
     * whenever someone sets the status again.
     */
    pausedReason: text('paused_reason'),
    /**
     * Spec 0035 replaced it with `schedule_id`; kept readable for one release (expand, then contract, AC-975).
     * Writes mirror it from `schedule_id`: `mine` when null, `own` when a schedule is named.
     */
    hoursMode: text('hours_mode').notNull().default('own'),
    /**
     * The schedule the page books by (spec 0035, AC-965): null follows the owner's default. Its foreign key
     * (`booking_pages_schedule`, on delete set null on this column only) is hand written in migration 0057:
     * drizzle can't say `set null (schedule_id)`, and a plain set null would null `workspace_id` too.
     */
    scheduleId: uuid('schedule_id'),
    /** A round robin page's reschedule rule (spec 0029, AC-746): `same` keeps the host when free, `rotation` asks again. */
    rescheduleHost: text('reschedule_host').notNull().default('same'),
    /** A private page (spec 0027, AC-707, AC-708): it may book inside the host's holds, and waives its minimum notice. */
    isPrivate: boolean('is_private').notNull().default(false),
    /**
     * What the page does once a booking commits (spec 0062, AC-6201, migration 0167): `confirmation`, which is
     * what every page did before, or `redirect` to `redirect_url`. Nothing is backfilled.
     */
    afterBooking: text('after_booking').notNull().default('confirmation'),
    /** Where a `redirect` page sends the visitor; null otherwise. https only, except localhost. */
    redirectUrl: text('redirect_url'),
    /**
     * Whether that redirect carries the booking as query values (AC-6201): off by default, because it puts the
     * visitor's name and address into the host's own server logs.
     */
    sendBookingDetails: boolean('send_booking_details').notNull().default(false),
    /**
     * How long before the start a guest may no longer cancel, in minutes (AC-6202, migration 0167): 0 is what
     * every page did before. The host's own cancel ignores it, so this never blocks the people who own the page.
     */
    cancelCutoffMinutes: integer('cancel_cutoff_minutes').notNull().default(0),
    /** The same for moving a booking; the host's own move ignores it. */
    moveCutoffMinutes: integer('move_cutoff_minutes').notNull().default(0),
    /**
     * Whether a booking waits for the host's Confirm (spec 0062, AC-6203, migration 0167): off by default. A
     * waiting booking holds its slot and stays off the calendar until confirmed; see `bookings.approval`.
     */
    requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
    /**
     * Whether the page shows its owner's social links under their name (booking socials, migration 0097): on by
     * default. Read only for a personal page; a team page names no host, so never shows them (AC-754).
     */
    showSocials: boolean('show_socials').notNull().default(true),
    /**
     * The view the page opens in for a visitor with no remembered choice of their own (owner, 25 Oct 2026): `month`,
     * `list` or `chat` (spec 0042). It is the host's default, not an override: a visitor who has picked a view on
     * that browser keeps it. Every page starts on `month`, which is what the page did before this was a setting.
     */
    defaultView: text('default_view').notNull().default('month'),
    /**
     * Where this page's bookings go (spec 0024 milestone 5, AC-997): one of the owner's writable calendars, or null
     * for the owner's own "Add events to". Its foreign key (hand written in 0052) sets only this column to null when
     * the calendar goes.
     */
    destinationCalendarId: uuid('destination_calendar_id'),
    /**
     * The name of the page's own calendar when it went (removed at the provider, or its account disconnected or
     * revoked), kept by the trigger crm_booking_pages_destination_gone (0085) so the editor can say the page fell
     * back to the owner's default. Cleared when the page's "Add bookings to" is set again. Shown to the owner only.
     */
    destinationRemovedName: text('destination_removed_name'),
    /**
     * Managed booking pages (spec 0037, AC-1333): the template this page was made from, on a member page. Its
     * foreign key (`booking_pages_template`, on delete set null on this column only) is hand written in the
     * migration: drizzle can't say `set null (template_id)`, and a plain set null would null `workspace_id` too.
     * Deleting a template leaves every member page standing as that member's own, no longer linked (AC-1335).
     */
    templateId: uuid('template_id'),
    /**
     * Which parts of a template a member may not change (spec 0037, AC-1333), on a `managed` template only: a subset
     * of `details`, `durations`, `location`, `questions`, `on_booking`, `limits`, `hours`. Null on every other page.
     * A member page reads its template's list: the lock lives on the template, so one save moves every page at once.
     */
    locked: text('locked').array(),
    /**
     * The team a template follows (spec 0037, AC-1333), on a `managed` template only: its active non guest members
     * each get a page, instead of the chosen members in `managed_page_members`. Null when members are chosen.
     */
    followTeamId: uuid('follow_team_id'),
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    primaryKey({ name: 'booking_pages_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'booking_pages_owner',
      columns: [t.workspaceId, t.ownerMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'booking_pages_answers_object',
      columns: [t.workspaceId, t.answersObjectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    // The team a template follows: kept, so a team in use can't vanish under its managed pages.
    foreignKey({
      name: 'booking_pages_follow_team',
      columns: [t.workspaceId, t.followTeamId],
      foreignColumns: [teams.workspaceId, teams.id],
    }).onDelete('restrict'),
    uniqueIndex('booking_pages_public_key').on(t.publicKey),
    uniqueIndex('booking_pages_slug')
      .on(t.workspaceId, t.ownerMemberId, t.slug)
      .where(sql`${t.deletedAt} is null and ${t.scope} = 'member'`),
    uniqueIndex('booking_pages_workspace_slug')
      .on(t.workspaceId, t.slug)
      .where(sql`${t.deletedAt} is null and ${t.scope} = 'workspace'`),
    // A profile's listed pages, in the owner's order: read only through crm_booking_profile_pages.
    index('booking_pages_profile')
      .on(t.ownerUserId, t.profilePosition, t.id)
      .where(sql`${t.deletedAt} is null and ${t.isPrivate} = false and ${t.status} = 'live'`),
    index('booking_pages_by_owner')
      .on(t.workspaceId, t.ownerMemberId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    // The pages naming a schedule: its "Used by" count and the repoint when it is deleted.
    index('booking_pages_by_schedule')
      .on(t.workspaceId, t.scheduleId)
      .where(sql`${t.scheduleId} is not null`),
    check('booking_pages_public_key_shape', sql`${t.publicKey} ~ '^[A-Za-z0-9_-]{16}$'`),
    check('booking_pages_profile_section', sql`char_length(${t.profileSection}) between 1 and 40`),
    check('booking_pages_profile_position', sql`${t.profilePosition} between 0 and 999`),
    check('booking_pages_slug_shape', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 60`),
    check('booking_pages_kind', sql`${t.kind} in ('personal', 'collective', 'round_robin', 'managed')`),
    check('booking_pages_scope', sql`${t.scope} in ('member', 'workspace')`),
    check('booking_pages_scope_kind', sql`${t.scope} = 'member' or ${t.kind} = 'round_robin'`),
    check('booking_pages_status', sql`${t.status} in ('live', 'paused')`),
    check('booking_pages_paused_reason', sql`${t.pausedReason} is null or ${t.pausedReason} = 'host_removed'`),
    check('booking_pages_hours_mode', sql`${t.hoursMode} in ('mine', 'own')`),
    check('booking_pages_reschedule_host', sql`${t.rescheduleHost} in ('same', 'rotation')`),
    check('booking_pages_default_view', sql`${t.defaultView} in ('month', 'list', 'chat')`),
    check(
      'booking_pages_questions',
      sql`jsonb_typeof(${t.questions}) = 'array' and jsonb_array_length(${t.questions}) <= 20`,
    ),
    check('booking_pages_destination_removed_name', sql`char_length(${t.destinationRemovedName}) <= 255`),
    // A template holds the locks and the team it follows; nothing else does, and a template is nobody's member page.
    check(
      'booking_pages_managed',
      sql`(${t.kind} = 'managed' and ${t.templateId} is null)
        or (${t.kind} <> 'managed' and ${t.locked} is null and ${t.followTeamId} is null)`,
    ),
    check(
      'booking_pages_locked_parts',
      sql`${t.locked} is null
        or ${t.locked} <@ '{address,details,durations,location,questions,on_booking,limits,hours}'::text[]`,
    ),
    // A template is a page of its own, never round robin and never the workspace's link.
    check('booking_pages_managed_scope', sql`${t.kind} <> 'managed' or ${t.scope} = 'member'`),
    // A template's member pages: the propagation's read, and the "From <template>" badge.
    index('booking_pages_by_template')
      .on(t.workspaceId, t.templateId)
      .where(sql`${t.templateId} is not null and ${t.deletedAt} is null`),
    check('booking_pages_title', sql`char_length(${t.title}) between 1 and 120`),
    check('booking_pages_description', sql`char_length(${t.description}) <= 2000`),
    check(
      'booking_pages_durations',
      sql`cardinality(${t.durations}) between 1 and 4 and ${t.durations} <@ ${sql.raw(DURATION_SET)}::smallint[]`,
    ),
    check('booking_pages_buffers', sql`${t.bufferBefore} between 0 and 60 and ${t.bufferAfter} between 0 and 60`),
    check('booking_pages_notice', sql`${t.minNoticeMinutes} between 0 and 20160`),
    check('booking_pages_after', sql`${t.afterBooking} in ('confirmation', 'redirect')`),
    // A redirect page without an address would strand every visitor, so the pairing is the database's rule as well
    // as the contract's (spec 0062, AC-6201).
    check(
      'booking_pages_redirect',
      sql`(${t.afterBooking} = 'redirect') = (${t.redirectUrl} is not null) and (${t.redirectUrl} is null or char_length(${t.redirectUrl}) <= 2048)`,
    ),
    check(
      'booking_pages_cutoffs',
      sql`${t.cancelCutoffMinutes} between 0 and 20160 and ${t.moveCutoffMinutes} between 0 and 20160`,
    ),
    check('booking_pages_window', sql`${t.windowDays} between 1 and 365`),
    check('booking_pages_daily_limit', sql`${t.dailyLimit} is null or ${t.dailyLimit} between 1 and 50`),
    check('booking_pages_slot_step', sql`${t.slotStep} is null or ${t.slotStep} in (15, 30, 60)`),
    ...actorConstraints('booking_pages', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('booking_pages', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * Spec 0035 moved these into `availability_schedules` (each row became the member's default "Working hours");
 * kept readable for one release, then dropped by the contract migration (AC-975). Nothing writes it.
 */
export const bookingMemberHours = pgTable(
  'booking_member_hours',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    /** The same shape as a page's `availability`. */
    availability: jsonb('availability').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'booking_member_hours_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'booking_member_hours_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    ...actorConstraints('booking_member_hours', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('booking_member_hours', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * A member's named set of hours (spec 0035, AC-961): weekly ranges and date
 * overrides in its own zone, in the `BookingAvailability` shape a page's
 * hours always had, so the slot engine reads it unchanged. At most one per
 * member is the default (`availability_schedules_default`); a member with no
 * stored default follows the virtual one (weekdays 09:00 to 17:00, AC-963).
 * Hard deleted: deleting one points its pages back at the default first.
 * The 20 per member limit is kept by core under the member's advisory lock.
 */
export const availabilitySchedules = pgTable(
  'availability_schedules',
  {
    workspaceId: workspaceId(),
    id: id(),
    memberId: uuid('member_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    /** `{ timeZone, weekly: { mon: [[start, end]], … }, overrides: [{ date, ranges }] }`, times `HH:MM`. */
    availability: jsonb('availability').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'availability_schedules_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'availability_schedules_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // A member's schedules, and the member foreign key's check.
    index('availability_schedules_by_member').on(t.workspaceId, t.memberId),
    // Names are unique per member, ignoring case.
    uniqueIndex('availability_schedules_name').on(t.workspaceId, t.memberId, sql`lower(${t.name})`),
    // At most one default per member.
    uniqueIndex('availability_schedules_default')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.isDefault}`),
    check('availability_schedules_name_length', sql`char_length(${t.name}) between 1 and 60`),
    ...actorConstraints('availability_schedules', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('availability_schedules', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * The members a page books, in order: the owner alone for a personal page; 2 to 8 required members for a collective
 * one; 0 to 7 fixed hosts, who attend every meeting, for a round robin one (spec 0037, AC-1319).
 */
export const bookingPageMembers = pgTable(
  'booking_page_members',
  {
    workspaceId: workspaceId(),
    pageId: uuid('page_id').notNull(),
    memberId: uuid('member_id').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ name: 'booking_page_members_pkey', columns: [t.workspaceId, t.pageId, t.memberId] }),
    foreignKey({
      name: 'booking_page_members_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'booking_page_members_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // A member's pages, and the member foreign key's check.
    index('booking_page_members_by_member').on(t.workspaceId, t.memberId),
    check('booking_page_members_position', sql`${t.position} between 0 and 7`),
  ],
);

/**
 * Who a managed template makes a page for (spec 0037, AC-1333), when it names members rather than following a team:
 * one row per chosen member, at most 200 (`MANAGED_MEMBERS_MAX`, checked in core). Removing a row deletes that
 * member's page the way spec 0025 AC-648 deletes one (AC-1335); the member page itself is a `booking_pages` row
 * carrying `template_id`, so these rows say who *should* have one and the pages say who does.
 */
export const managedPageMembers = pgTable(
  'managed_page_members',
  {
    workspaceId: workspaceId(),
    /** The template (`booking_pages.id`, `kind = 'managed'`). */
    templateId: uuid('template_id').notNull(),
    memberId: uuid('member_id').notNull(),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'managed_page_members_pkey', columns: [t.workspaceId, t.templateId, t.memberId] }),
    foreignKey({
      name: 'managed_page_members_template',
      columns: [t.workspaceId, t.templateId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'managed_page_members_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // Which templates a member is on: the member's Links screen, and the removal when they leave.
    index('managed_page_members_by_member').on(t.workspaceId, t.memberId),
    ...actorConstraints('managed_page_members', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('managed_page_members', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * Every slug a page holds or held at its owner's address, `/<handle>/<slug>` (slug history, 22 Oct 2026): its
 * current one, and up to 20 old ones, which keep finding the page (the public page moves to the current address).
 * Kept only by the trigger crm_booking_page_slugs_keep (0087) on `booking_pages`: a page that is deleted or changes
 * hands loses its old slugs, and its rows go with it when it is purged. `booking_page_slugs_owner_slug` keeps a slug
 * one page of a person holds or held from any other page of theirs, in the same workspace (spec 0056, migration 0113), so an old link never finds
 * a different page; the same page may take it back.
 */
export const bookingPageSlugs = pgTable(
  'booking_page_slugs',
  {
    workspaceId: workspaceId(),
    pageId: uuid('page_id').notNull(),
    /** The page owner's identity when the page held the slug (`booking_pages.owner_user_id`). */
    ownerUserId: uuid('owner_user_id').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** When the page last took or left this slug: the oldest past the cap of 20 old ones goes first. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'booking_page_slugs_pkey', columns: [t.workspaceId, t.pageId, t.slug] }),
    foreignKey({
      name: 'booking_page_slugs_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    // An old address is found before the workspace is known: read only through crm_booking_lookup's
    // crm_booking_page_by_address and crm_booking_owner_slugs.
    uniqueIndex('booking_page_slugs_owner_slug').on(t.ownerUserId, t.workspaceId, t.slug),
    check(
      'booking_page_slugs_slug_shape',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 60`,
    ),
  ],
);

/** One booking a visitor made. Cancelled bookings stay, holding nothing. */
export const bookings = pgTable(
  'bookings',
  {
    workspaceId: workspaceId(),
    id: id(),
    pageId: uuid('page_id').notNull(),
    hostMemberId: uuid('host_member_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    /** [starts_at − buffer before, ends_at + buffer after): what the exclusion constraint compares. */
    during: tstzrange('during').notNull(),
    visitorName: text('visitor_name').notNull(),
    /** Trimmed and lowercased. */
    visitorEmail: text('visitor_email').notNull(),
    visitorTimeZone: text('visitor_time_zone').notNull(),
    answers: jsonb('answers').notNull().default({}),
    status: text('status').notNull().default('confirmed'),
    cancelReason: text('cancel_reason'),
    reschedules: smallint('reschedules').notNull().default(0),
    /** SHA-256 of the cancel and reschedule link's token (milestone 2 sends the link). */
    manageTokenHash: text('manage_token_hash').notNull(),
    /** The token derives from the booking's id (milestone 2); false for an older random one, moved once when next written. */
    manageTokenDerived: boolean('manage_token_derived').notNull().default(false),
    /** One booking per attempt: a retry of the same attempt answers the first booking. */
    idempotencyKey: uuid('idempotency_key').notNull(),
    meetingId: uuid('meeting_id'),
    /** The video link the calendar event carries, for the guest page. */
    videoUrl: text('video_url'),
    /** Set when the calendar event couldn't be made after the booking committed (spec: the booking stays). */
    eventFailedAt: timestamptz('event_failed_at'),
    /** When and by whom it was cancelled: the guest from their page, the host, or the host's calendar (AC-641). */
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: text('cancelled_by'),
    /** The start before the last move, for the moved email's "Was" line. */
    previousStartsAt: timestamptz('previous_starts_at'),
    personRecordId: uuid('person_record_id'),
    companyRecordId: uuid('company_record_id'),
    dealRecordId: uuid('deal_record_id'),
    submissionId: uuid('submission_id'),
    /** A round robin booking whose host left and nobody could take it (spec 0029, AC-749): Bookings flags it. */
    needsHostAt: timestamptz('needs_host_at'),
    /** Marked by a host or a booking admin after the meeting when the guest didn't come (spec 0043, AC-1613). */
    noShowAt: timestamptz('no_show_at'),
    noShowByMemberId: uuid('no_show_by_member_id'),
    /**
     * A booking on a page that requires confirmation (spec 0062, AC-6203, migration 0167): `pending` until the
     * host decides, then `approved` or `declined`; null on every other booking. A pending booking keeps `status =
     * 'confirmed'`, so it holds its slot through every read and both exclusion constraints; a declined one is
     * cancelled. Only `approval` says whether the calendar event, the confirmation and the reminders may go yet.
     */
    approval: text('approval'),
    /** When the host (or, with no member, the expiry job) decided a pending booking. */
    decidedAt: timestamptz('decided_at'),
    decidedByMemberId: uuid('decided_by_member_id'),
    /** The host's optional reason for a decline, sent to the visitor (up to 500 characters). */
    declineReason: text('decline_reason'),
    /** The one off link it was booked through, while that link exists (AC-6204). */
    oneOffLinkId: uuid('one_off_link_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'bookings_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'bookings_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }),
    foreignKey({
      name: 'bookings_host',
      columns: [t.workspaceId, t.hostMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'bookings_no_show_by',
      columns: [t.workspaceId, t.noShowByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('bookings_no_show', sql`(${t.noShowAt} is null) = (${t.noShowByMemberId} is null)`),
    uniqueIndex('bookings_attempt').on(t.workspaceId, t.pageId, t.idempotencyKey),
    // The guest page finds its booking by the hashed token before the workspace is known, so it is unique everywhere.
    uniqueIndex('bookings_manage_token').on(t.manageTokenHash),
    // The bookings made in a range, per workspace (spec 0047's counts).
    index('bookings_created').on(t.workspaceId, t.createdAt),
    // The bookings each host was given in a range (spec 0047): an index only count per host.
    index('bookings_host_created').on(t.workspaceId, t.hostMemberId, t.createdAt),
    // The page's bookings list, newest first.
    index('bookings_by_page').on(t.workspaceId, t.pageId, t.startsAt.desc(), t.id),
    // A host's confirmed bookings in a range (the slots read; the exclusion constraint's index serves overlap).
    index('bookings_by_host')
      .on(t.workspaceId, t.hostMemberId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
    // The bookings with no host in a range (the Team day's Needs a host lane, spec 0037, AC-1435): a host who left
    // isn't a column, so the lane finds them by their flag, and few bookings ever carry it.
    index('bookings_needs_host')
      .on(t.workspaceId, t.startsAt)
      .where(sql`${t.needsHostAt} is not null`),
    // The booking a calendar meeting is for (spec 0024): the sync cancels it, or lets go of a meeting that is gone.
    index('bookings_by_meeting')
      .on(t.workspaceId, t.meetingId)
      .where(sql`${t.meetingId} is not null`),
    // A person's bookings, for their timeline.
    index('bookings_by_person')
      .on(t.workspaceId, t.personRecordId, t.createdAt)
      .where(sql`${t.personRecordId} is not null`),
    // A company's and a deal's bookings: the purge clears them when the record goes for good (spec 0022's registry).
    index('bookings_by_company')
      .on(t.workspaceId, t.companyRecordId)
      .where(sql`${t.companyRecordId} is not null`),
    index('bookings_by_deal')
      .on(t.workspaceId, t.dealRecordId)
      .where(sql`${t.dealRecordId} is not null`),
    check('bookings_status', sql`${t.status} in ('confirmed', 'cancelled')`),
    check('bookings_times', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'bookings_during',
      sql`lower(${t.during}) <= ${t.startsAt} and upper(${t.during}) >= ${t.endsAt} and lower_inc(${t.during}) and not upper_inc(${t.during})`,
    ),
    check('bookings_cancelled', sql`${t.status} = 'cancelled' or ${t.cancelReason} is null`),
    check(
      'bookings_visitor',
      sql`char_length(${t.visitorName}) between 1 and 200 and char_length(${t.visitorEmail}) between 3 and 254`,
    ),
    check('bookings_reschedules', sql`${t.reschedules} between 0 and 5`),
    check(
      'bookings_cancelled_by',
      sql`(${t.cancelledBy} is null and ${t.cancelledAt} is null) or (${t.status} = 'cancelled' and ${t.cancelledBy} in ('guest', 'host', 'calendar') and ${t.cancelledAt} is not null)`,
    ),
    check('bookings_video_url', sql`${t.videoUrl} is null or char_length(${t.videoUrl}) <= 2000`),
    check('bookings_approval', sql`${t.approval} is null or ${t.approval} in ('pending', 'approved', 'declined')`),
    check(
      'bookings_decided',
      sql`(${t.decidedAt} is null) = (${t.approval} is null or ${t.approval} = 'pending') and (${t.decidedByMemberId} is null or ${t.decidedAt} is not null)`,
    ),
    check(
      'bookings_declined',
      sql`(${t.approval} is distinct from 'declined' or ${t.status} = 'cancelled') and (${t.declineReason} is null or (${t.approval} = 'declined' and char_length(${t.declineReason}) <= 500))`,
    ),
    foreignKey({
      name: 'bookings_decided_by',
      columns: [t.workspaceId, t.decidedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The pending bookings in a range: the expiry sweep and the host's requests.
    index('bookings_pending')
      .on(t.workspaceId, t.startsAt)
      .where(sql`${t.approval} = 'pending'`),
    ...actorConstraints('bookings', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('bookings', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * Time a member closed on their own calendar (spec 0027): a `block` closes it
 * for every page that books them, a `hold` for every page but a private one.
 * A `once` row is an absolute span (`during`); a `weekly` row is local minutes
 * on a weekday in the zone it was made in, from `from_date` on, subtracted
 * from that day's hours rather than rewriting them. A hold is always `once`.
 */
export const bookingTimeBlocks = pgTable(
  'booking_time_blocks',
  {
    workspaceId: workspaceId(),
    id: id(),
    memberId: uuid('member_id').notNull(),
    kind: text('kind').notNull(),
    repeat: text('repeat').notNull(),
    during: tstzrange('during'),
    /** `during`'s ends, kept beside it: plain comparisons reach a btree index under row level security, `&&` doesn't. */
    startsAt: timestamptz('starts_at').generatedAlwaysAs(sql`lower(during)`),
    endsAt: timestamptz('ends_at').generatedAlwaysAs(sql`upper(during)`),
    weekday: smallint('weekday'),
    startMinute: smallint('start_minute'),
    endMinute: smallint('end_minute'),
    timeZone: text('time_zone'),
    fromDate: date('from_date', { mode: 'string' }),
    /** A hold carved for one private page; null is any private page. */
    pageId: uuid('page_id'),
    label: text('label'),
    /** Time off (spec 0037, kind `away`): why (`vacation`, `sick`, `travel`, `holiday`, `other`). */
    reason: text('reason'),
    /** Time off's note, up to 200 characters, shown only to the member and to Manage over them; never audited. */
    note: text('note'),
    /** Time off's stand in: the member who covers for them (AC-1284). */
    standinMemberId: uuid('standin_member_id'),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'booking_time_blocks_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'booking_time_blocks_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: 'booking_time_blocks_standin',
      columns: [t.workspaceId, t.standinMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The member's one off blocks ending after a range starts, read with every slots request.
    index('booking_time_blocks_once')
      .on(t.workspaceId, t.memberId, t.endsAt)
      .where(sql`${t.repeat} = 'once'`),
    // The member's weekly blocks, read with every slots request.
    index('booking_time_blocks_weekly')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.repeat} = 'weekly'`),
    check('booking_time_blocks_kind', sql`${t.kind} in ('block', 'hold', 'away')`),
    check(
      'booking_time_blocks_shape',
      sql`(${t.repeat} = 'once' and ${t.during} is not null and not isempty(${t.during}) and lower_inc(${t.during}) and not upper_inc(${t.during})
        and ${t.weekday} is null and ${t.startMinute} is null and ${t.endMinute} is null and ${t.fromDate} is null
        and (${t.timeZone} is null) = (${t.kind} <> 'away'))
      or (${t.repeat} = 'weekly' and ${t.kind} = 'block' and ${t.during} is null and ${t.weekday} between 0 and 6
        and ${t.startMinute} >= 0 and ${t.endMinute} > ${t.startMinute} and ${t.endMinute} <= 1440
        and ${t.timeZone} is not null and ${t.fromDate} is not null)`,
    ),
    check('booking_time_blocks_page', sql`${t.pageId} is null or ${t.kind} = 'hold'`),
    check('booking_time_blocks_label', sql`${t.label} is null or char_length(${t.label}) between 1 and 200`),
    check(
      'booking_time_blocks_away',
      sql`(${t.kind} = 'away' and ${t.repeat} = 'once' and ${t.label} is null
        and ${t.reason} in ('vacation', 'sick', 'travel', 'holiday', 'other')
        and (${t.note} is null or char_length(${t.note}) between 1 and 200)
        and (${t.standinMemberId} is null or ${t.standinMemberId} <> ${t.memberId})
        and upper(${t.during}) - lower(${t.during}) <= interval '367 days')
      or (${t.kind} <> 'away' and ${t.reason} is null and ${t.note} is null and ${t.standinMemberId} is null)`,
    ),
    ...actorConstraints('booking_time_blocks', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('booking_time_blocks', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * Who a booking occupies (spec 0029, AC-745): one row per member, the host's
 * kept by the trigger `crm_booking_hosts_mirror` (migration 0058) with the
 * booking's range and status, a collective page's other required members
 * written beside it by the booking. Its exclusion constraint
 * `booking_hosts_no_overlap` (hand written) refuses two confirmed rows of one
 * member whose ranges overlap, so a member is never double booked across
 * every page they are on.
 */
export const bookingHosts = pgTable(
  'booking_hosts',
  {
    workspaceId: workspaceId(),
    bookingId: uuid('booking_id').notNull(),
    memberId: uuid('member_id').notNull(),
    /** The booking's `during`: its meeting widened by its page's buffers. */
    during: tstzrange('during').notNull(),
    /** `during`'s ends, kept beside it: plain comparisons reach a btree index under row level security, `&&` doesn't. */
    startsAt: timestamptz('starts_at').generatedAlwaysAs(sql`lower(during)`),
    endsAt: timestamptz('ends_at').generatedAlwaysAs(sql`upper(during)`),
    /** The booking's status, mirrored. */
    status: text('status').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'booking_hosts_pkey', columns: [t.workspaceId, t.bookingId, t.memberId] }),
    foreignKey({
      name: 'booking_hosts_booking',
      columns: [t.workspaceId, t.bookingId],
      foreignColumns: [bookings.workspaceId, bookings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'booking_hosts_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // A member's confirmed time in a range: every slots read and recheck.
    index('booking_hosts_by_member')
      .on(t.workspaceId, t.memberId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
    check('booking_hosts_status', sql`${t.status} in ('confirmed', 'cancelled')`),
  ],
);

/**
 * A booking page's views (spec 0047, AC-1625): one row per page, UTC day and
 * visitor (a daily HMAC of the address and the user agent, neither kept), with
 * how many times that visitor loaded it. Counted on the page's viewer read when
 * the viewer isn't one of its hosts. Gone with the page (cascade), and after a
 * year by the daily cleanup. Read across workspaces only through crm_operator's
 * counts.
 */
export const bookingPageViews = pgTable(
  'booking_page_views',
  {
    workspaceId: workspaceId(),
    pageId: uuid('page_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    visitor: text('visitor').notNull(),
    views: integer('views').notNull().default(1),
    firstAt: timestamptz('first_at').notNull().defaultNow(),
    lastAt: timestamptz('last_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'booking_page_views_pkey', columns: [t.workspaceId, t.pageId, t.day, t.visitor] }),
    foreignKey({
      name: 'booking_page_views_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    // The daily cleanup's pick: the oldest days first.
    index('booking_page_views_day').on(t.workspaceId, t.day),
    check('booking_page_views_visitor', sql`${t.visitor} ~ '^[0-9a-f]{32}$'`),
    check('booking_page_views_count', sql`${t.views} >= 1`),
  ],
);

/**
 * One off links (spec 0062, AC-6204, migration 0167): a link that books its page up to `max_uses` times, then
 * answers "This link has been used". Only the SHA-256 of its 32 byte token is kept; the token travels in the
 * address's fragment. A use is counted when the booking commits, under the page's booking lock.
 */
export const bookingPageLinks = pgTable(
  'booking_page_links',
  {
    workspaceId: workspaceId(),
    id: id(),
    pageId: uuid('page_id').notNull(),
    label: text('label'),
    tokenHash: text('token_hash').notNull(),
    maxUses: smallint('max_uses').notNull().default(1),
    uses: smallint('uses').notNull().default(0),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'booking_page_links_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'booking_page_links_page',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [bookingPages.workspaceId, bookingPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'booking_page_links_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    uniqueIndex('booking_page_links_token_hash').on(t.workspaceId, t.tokenHash),
    index('booking_page_links_by_page').on(t.workspaceId, t.pageId, t.createdAt),
    check('booking_page_links_label', sql`${t.label} is null or char_length(${t.label}) between 1 and 60`),
    check('booking_page_links_token', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('booking_page_links_uses', sql`${t.maxUses} between 1 and 50 and ${t.uses} between 0 and ${t.maxUses}`),
  ],
);
