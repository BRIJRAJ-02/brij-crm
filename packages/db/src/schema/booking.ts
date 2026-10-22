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
    /** Unique per workspace among live pages. */
    slug: text('slug').notNull(),
    kind: text('kind').notNull().default('personal'),
    ownerMemberId: uuid('owner_member_id').notNull(),
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
    /** The forms question shape (milestone 2). */
    questions: jsonb('questions').notNull().default([]),
    /** A team page's routing rules (spec 0043, AC-1608): `RoutingRules`, tried at each booking. */
    routing: jsonb('routing').notNull().default({ rules: [] }),
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
     * Where this page's bookings go (spec 0024 milestone 5, AC-997): one of the owner's writable calendars, or null
     * for the owner's own "Add events to". Its foreign key (hand written in 0052) sets only this column to null when
     * the calendar goes.
     */
    destinationCalendarId: uuid('destination_calendar_id'),
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
    uniqueIndex('booking_pages_public_key').on(t.publicKey),
    uniqueIndex('booking_pages_slug')
      .on(t.workspaceId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('booking_pages_by_owner')
      .on(t.workspaceId, t.ownerMemberId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    // The pages naming a schedule: its "Used by" count and the repoint when it is deleted.
    index('booking_pages_by_schedule')
      .on(t.workspaceId, t.scheduleId)
      .where(sql`${t.scheduleId} is not null`),
    check('booking_pages_public_key_shape', sql`${t.publicKey} ~ '^[A-Za-z0-9_-]{16}$'`),
    check('booking_pages_slug_shape', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 60`),
    check('booking_pages_kind', sql`${t.kind} in ('personal', 'collective', 'round_robin')`),
    check('booking_pages_status', sql`${t.status} in ('live', 'paused')`),
    check('booking_pages_paused_reason', sql`${t.pausedReason} is null or ${t.pausedReason} = 'host_removed'`),
    check('booking_pages_hours_mode', sql`${t.hoursMode} in ('mine', 'own')`),
    check('booking_pages_reschedule_host', sql`${t.rescheduleHost} in ('same', 'rotation')`),
    check('booking_pages_title', sql`char_length(${t.title}) between 1 and 120`),
    check('booking_pages_description', sql`char_length(${t.description}) <= 2000`),
    check(
      'booking_pages_durations',
      sql`cardinality(${t.durations}) between 1 and 4 and ${t.durations} <@ ${sql.raw(DURATION_SET)}::smallint[]`,
    ),
    check('booking_pages_buffers', sql`${t.bufferBefore} between 0 and 60 and ${t.bufferAfter} between 0 and 60`),
    check('booking_pages_notice', sql`${t.minNoticeMinutes} between 0 and 20160`),
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
    // The page's bookings list, newest first.
    index('bookings_by_page').on(t.workspaceId, t.pageId, t.startsAt.desc(), t.id),
    // A host's confirmed bookings in a range (the slots read; the exclusion constraint's index serves overlap).
    index('bookings_by_host')
      .on(t.workspaceId, t.hostMemberId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
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
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ name: 'booking_time_blocks_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'booking_time_blocks_member',
      columns: [t.workspaceId, t.memberId],
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
    check('booking_time_blocks_kind', sql`${t.kind} in ('block', 'hold')`),
    check(
      'booking_time_blocks_shape',
      sql`(${t.repeat} = 'once' and ${t.during} is not null and not isempty(${t.during}) and lower_inc(${t.during}) and not upper_inc(${t.during})
        and ${t.weekday} is null and ${t.startMinute} is null and ${t.endMinute} is null and ${t.timeZone} is null and ${t.fromDate} is null)
      or (${t.repeat} = 'weekly' and ${t.kind} = 'block' and ${t.during} is null and ${t.weekday} between 0 and 6
        and ${t.startMinute} >= 0 and ${t.endMinute} > ${t.startMinute} and ${t.endMinute} <= 1440
        and ${t.timeZone} is not null and ${t.fromDate} is not null)`,
    ),
    check('booking_time_blocks_page', sql`${t.pageId} is null or ${t.kind} = 'hold'`),
    check('booking_time_blocks_label', sql`${t.label} is null or char_length(${t.label}) between 1 and 200`),
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
