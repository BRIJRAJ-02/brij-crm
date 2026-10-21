// Calendar sync (spec 0024, milestone 1): members' calendar connections and
// the meetings synced from them, in their own tables beside the records
// engine, not records. A connection holds its provider tokens encrypted
// (`tokens`, AES-256-GCM sealed by the service with `CALENDAR_TOKEN_KEY`),
// never selected by a read the API serves. One meeting per event across every
// member's calendar (its iCalendar UID and, for a recurring instance, its
// original start); `meeting_sources` says which connections hold it, and the
// meeting goes with its last source. `meeting_records` is what timelines read,
// by record and start. A link's foreign key to its record has no `on delete`
// action: the purge deletes the links (and clears an attendee's person) first,
// in the same transaction, as it does for tasks.
//
// Milestone 5 (the amendment of 20 October 2026): every calendar of each
// account is a row of `calendar_calendars`, with its own switches (check for
// conflicts, show on my week, sync meetings), colour, sync token and push
// channel; one per member is where new bookings go (`is_destination`). A
// meeting's sources and a member's busy times are kept per calendar (the
// provider's calendar id, `calendar_id`), so the same event in two calendars
// of one account is two copies, and one calendar leaving never drops the
// other's. The connection's own `sync_state`, `channel` and `is_default`
// stay for the release the expand migration (0052) ships in; nothing reads
// them, and the contract migration a release later drops them.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, calendarActorType, id, timestamptz, workspaceId } from './common.ts';
import { records } from './records.ts';
import { actorConstraints, members, workspaces } from './workspaces.ts';

/** Raw bytes: the sealed tokens. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Which provider a connection is with: Google now, Microsoft from milestone 4. */
export const calendarProvider = pgEnum('calendar_provider', ['google', 'microsoft']);

/** Where a connection stands (AC-597): syncing its first window, connected, or stopped and why. */
export const calendarStatus = pgEnum('calendar_status', ['syncing', 'connected', 'expired', 'revoked', 'failed']);

/** Who sees a connection's meetings in full (AC-611): anyone who can see a linked record, or only its holders. */
export const calendarSharing = pgEnum('calendar_sharing', ['shared', 'private']);

/** A meeting's state in the calendar. A cancelled event leaves its source, so a stored one is rarely cancelled. */
export const meetingStatus = pgEnum('meeting_status', ['confirmed', 'tentative', 'cancelled']);

/** An attendee's answer to the invitation. */
export const attendeeResponse = pgEnum('attendee_response', ['accepted', 'declined', 'tentative', 'needs_action']);

/**
 * How an attendee matched (AC-606): one person (`linked`), several (`ambiguous`,
 * none linked), nobody (`unknown`), or a workspace member (`member`).
 */
export const attendeeMatch = pgEnum('attendee_match', ['linked', 'ambiguous', 'unknown', 'member']);

/** What a member may do with one calendar at its provider (AC-991): a destination must be `owner` or `writer`. */
export const calendarAccessRole = pgEnum('calendar_access_role', ['owner', 'writer', 'reader', 'free_busy']);

/** Why a meeting is on a record: an attendee is that person, or an attendee's email domain is that company's. */
export const meetingLinkVia = pgEnum('meeting_link_via', ['attendee', 'domain']);

/** One member's connection to one calendar account. At most 6 per member (AC-1000), checked by the service. */
export const calendarConnections = pgTable(
  'calendar_connections',
  {
    workspaceId: workspaceId(),
    id: id(),
    memberId: uuid('member_id').notNull(),
    provider: calendarProvider('provider').notNull(),
    /** The account's address, trimmed and lower case. */
    accountEmail: text('account_email').notNull(),
    status: calendarStatus('status').notNull().default('syncing'),
    sharing: calendarSharing('sharing').notNull().default('shared'),
    /** The member's default connection, where booking writes events (one per member). */
    isDefault: boolean('is_default').notNull().default(false),
    /** The sealed JSON of the access token, refresh token and expiry. Never selected by a read the API serves. */
    tokens: bytea('tokens').notNull(),
    /** Per calendar id, the provider's sync token (or delta link), stored only once its batch committed. */
    syncState: jsonb('sync_state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The push channel (milestone 2): its id, resource id, expiry and hashed token. */
    channel: jsonb('channel'),
    lastSyncedAt: timestamptz('last_synced_at'),
    /** The last failure, as `{ code, message }`, never a token. */
    lastError: jsonb('last_error'),
    /** When the failures in a row began (milestone 2's 6 hour rule). */
    failingSince: timestamptz('failing_since'),
    /**
     * When the account's calendars were last listed (milestone 5, AC-991): null asks the next sync to list
     * them first (a new connection, or Refresh), and the sync lists them again once a day.
     */
    calendarsListedAt: timestamptz('calendars_listed_at'),
    ...auditColumns(),
    updatedByType: calendarActorType('updated_by'),
  },
  (t) => [
    primaryKey({ name: 'calendar_connections_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'calendar_connections_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // One connection per member per provider account (AC-599); also the member's list.
    uniqueIndex('calendar_connections_account').on(t.workspaceId, t.memberId, t.provider, t.accountEmail),
    // The connection with its member: what a calendar's own foreign key names, so a calendar is its account's member's.
    uniqueIndex('calendar_connections_with_member').on(t.workspaceId, t.id, t.memberId),
    uniqueIndex('calendar_connections_default')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.isDefault}`),
    check(
      'calendar_connections_email',
      sql`char_length(${t.accountEmail}) between 3 and 320 and ${t.accountEmail} = lower(btrim(${t.accountEmail}))`,
    ),
    ...actorConstraints('calendar_connections', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints(
      'calendar_connections',
      'updated_by',
      t.workspaceId,
      { type: t.updatedByType, id: t.updatedById, memberId: t.updatedByMemberId },
      { withCalendar: true },
    ),
  ],
);

/** One meeting, however many members' calendars hold it (AC-603). Descriptions and attachments are never stored. */
export const meetings = pgTable(
  'meetings',
  {
    workspaceId: workspaceId(),
    id: id(),
    icalUid: text('ical_uid').notNull(),
    /** A recurring instance's original start; null for a single event. */
    originalStart: timestamptz('original_start'),
    title: text('title').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    videoUrl: text('video_url'),
    status: meetingStatus('status').notNull().default('confirmed'),
    organizerEmail: text('organizer_email'),
    /** True when any holding connection is private or the event itself is private (AC-611, AC-612). */
    isPrivate: boolean('is_private').notNull().default(false),
    /**
     * Synced from a member who has since been removed (spec 0031, AC-815): the
     * meeting stays, and says its organiser left.
     */
    organizerRemoved: boolean('organizer_removed').notNull().default(false),
    /** Every attendee is a workspace member: it syncs, but shows on no record (AC-605). */
    isInternal: boolean('is_internal').notNull().default(false),
    /** Made by `createEvent` (milestone 3). */
    createdByCrm: boolean('created_by_crm').notNull().default(false),
    /** The booking that made it (spec 0025). */
    bookingId: uuid('booking_id'),
    ...auditColumns(),
    createdByType: calendarActorType('created_by'),
    updatedByType: calendarActorType('updated_by'),
  },
  (t) => [
    primaryKey({ name: 'meetings_pkey', columns: [t.workspaceId, t.id] }),
    uniqueIndex('meetings_event').on(t.workspaceId, t.icalUid, sql`coalesce(${t.originalStart}, 'epoch'::timestamptz)`),
    index('meetings_by_start').on(t.workspaceId, t.startsAt),
    check('meetings_times', sql`${t.endsAt} >= ${t.startsAt}`),
    check('meetings_title', sql`char_length(${t.title}) <= 1024`),
    check('meetings_ical_uid', sql`char_length(${t.icalUid}) between 1 and 1024`),
    check('meetings_location', sql`char_length(${t.location}) <= 500`),
    check('meetings_video_url', sql`char_length(${t.videoUrl}) <= 2048`),
    ...actorConstraints(
      'meetings',
      'created_by',
      t.workspaceId,
      { type: t.createdByType, id: t.createdById, memberId: t.createdByMemberId },
      { withCalendar: true },
    ),
    ...actorConstraints(
      'meetings',
      'updated_by',
      t.workspaceId,
      { type: t.updatedByType, id: t.updatedById, memberId: t.updatedByMemberId },
      { withCalendar: true },
    ),
  ],
);

/**
 * Which calendar of which connection holds a meeting, under which provider event id (milestone 5: one row per
 * calendar, so the same event in two calendars of one account is two copies). A meeting goes with its last source.
 */
export const meetingSources = pgTable(
  'meeting_sources',
  {
    workspaceId: workspaceId(),
    meetingId: uuid('meeting_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    /** The provider's calendar id (`calendar_calendars.provider_calendar_id`). */
    calendarId: text('calendar_id').notNull(),
    etag: text('etag'),
    /** This copy of the event is marked private in its calendar (AC-612). */
    markedPrivate: boolean('marked_private').notNull().default(false),
    /** The copy `createEvent` made (milestone 3): where a booking's move and cancel act (AC-998). */
    createdByCrm: boolean('created_by_crm').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'meeting_sources_pkey',
      columns: [t.workspaceId, t.meetingId, t.connectionId, t.calendarId],
    }),
    foreignKey({
      name: 'meeting_sources_meeting',
      columns: [t.workspaceId, t.meetingId],
      foreignColumns: [meetings.workspaceId, meetings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meeting_sources_connection',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [calendarConnections.workspaceId, calendarConnections.id],
    }).onDelete('cascade'),
    // A cancelled event comes back by its calendar and event id alone; also the connection's foreign key check.
    uniqueIndex('meeting_sources_event').on(t.workspaceId, t.connectionId, t.calendarId, t.providerEventId),
  ],
);

/** A meeting's attendees, as the last sync of any holding connection saw them. */
export const meetingAttendees = pgTable(
  'meeting_attendees',
  {
    workspaceId: workspaceId(),
    meetingId: uuid('meeting_id').notNull(),
    /** Trimmed and lower case. */
    email: text('email').notNull(),
    name: text('name'),
    position: smallint('position').notNull(),
    response: attendeeResponse('response').notNull().default('needs_action'),
    isOrganizer: boolean('is_organizer').notNull().default(false),
    /** The workspace member with that email, when one is. */
    memberId: uuid('member_id'),
    /** The one person whose email addresses hold it (AC-606). */
    personRecordId: uuid('person_record_id'),
    match: attendeeMatch('match').notNull(),
  },
  (t) => [
    primaryKey({ name: 'meeting_attendees_pkey', columns: [t.workspaceId, t.meetingId, t.email] }),
    foreignKey({
      name: 'meeting_attendees_meeting',
      columns: [t.workspaceId, t.meetingId],
      foreignColumns: [meetings.workspaceId, meetings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'meeting_attendees_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // No `on delete` action: the purge clears the person first (as it deletes task links).
    foreignKey({
      name: 'meeting_attendees_person',
      columns: [t.workspaceId, t.personRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // The purge's clear and the foreign key's check.
    index('meeting_attendees_by_person')
      .on(t.workspaceId, t.personRecordId)
      .where(sql`${t.personRecordId} is not null`),
    // Add as person (milestone 2): every meeting that lists an address no one in the CRM holds.
    index('meeting_attendees_unknown')
      .on(t.workspaceId, t.email)
      .where(sql`${t.match} = 'unknown'`),
    check('meeting_attendees_email', sql`char_length(${t.email}) between 3 and 320`),
    check('meeting_attendees_name', sql`char_length(${t.name}) <= 320`),
    check('meeting_attendees_linked', sql`(${t.match} = 'linked') = (${t.personRecordId} is not null)`),
  ],
);

/**
 * The records a meeting shows on: what timelines read, by record and start
 * (`starts_at` kept equal to the meeting's, so a record's meetings page in
 * order from one index).
 */
export const meetingRecords = pgTable(
  'meeting_records',
  {
    workspaceId: workspaceId(),
    meetingId: uuid('meeting_id').notNull(),
    recordId: uuid('record_id').notNull(),
    via: meetingLinkVia('via').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'meeting_records_pkey', columns: [t.workspaceId, t.meetingId, t.recordId] }),
    foreignKey({
      name: 'meeting_records_meeting',
      columns: [t.workspaceId, t.meetingId],
      foreignColumns: [meetings.workspaceId, meetings.id],
    }).onDelete('cascade'),
    // No `on delete` action: the purge deletes a removed record's links first.
    foreignKey({
      name: 'meeting_records_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // A record's timeline and `meetings.forRecord`, newest first; also the purge's delete and the key's check.
    index('meeting_records_by_record').on(t.workspaceId, t.recordId, t.startsAt.desc(), t.meetingId),
  ],
);

/** The workspace's calendar settings, one row once an admin changes one. */
export const calendarSettings = pgTable(
  'calendar_settings',
  {
    workspaceId: workspaceId().primaryKey(),
    /** Make people for unknown external attendees (AC-609, milestone 2). Off by default. */
    createUnknownPeople: boolean('create_unknown_people').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    foreignKey({ name: 'calendar_settings_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }),
    ...actorConstraints('calendar_settings', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('calendar_settings', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
  ],
);

/**
 * A member's own time that holds nobody else (the owner's call, 20 October
 * 2026: such events show as Busy on the Bookings week). An event with no
 * other attendee is no meeting (AC-605), so it never reaches a record; the
 * sync keeps only when it starts and ends, under the connection that holds
 * it, never its title, place or anything else. Gone with the connection.
 */
export const calendarBusyTimes = pgTable(
  'calendar_busy_times',
  {
    workspaceId: workspaceId(),
    connectionId: uuid('connection_id').notNull(),
    /** The provider's calendar id (milestone 5): the calendar that holds it, which tints it on the week. */
    calendarId: text('calendar_id').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'calendar_busy_times_pkey',
      columns: [t.workspaceId, t.connectionId, t.calendarId, t.providerEventId],
    }),
    foreignKey({
      name: 'calendar_busy_times_connection',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [calendarConnections.workspaceId, calendarConnections.id],
    }).onDelete('cascade'),
    check('calendar_busy_times_times', sql`${t.endsAt} > ${t.startsAt}`),
    check('calendar_busy_times_event', sql`char_length(${t.providerEventId}) between 1 and 1024`),
    // The week calendar's read: one calendar's busy times ending after the week starts.
    index('calendar_busy_times_by_end').on(t.workspaceId, t.connectionId, t.calendarId, t.endsAt),
  ],
);

/**
 * One calendar of a connected account (milestone 5, AC-991 to AC-1005), listed from the provider after connecting,
 * once a day and on Refresh. Its switches: `check_conflicts` (free and busy reads it, AC-994), `show_in_week` (the
 * member's Bookings week shows it, AC-1001) and `sync` (its meetings reach records, AC-1002). A calendar with
 * `sync` or `show_in_week` on is pulled: it has its own sync token and push channel (AC-1003); one that only checks
 * for conflicts is read live and never stored. One per member is where new bookings go (`is_destination`), always
 * one they can write. Gone with its connection.
 */
export const calendarCalendars = pgTable(
  'calendar_calendars',
  {
    workspaceId: workspaceId(),
    id: id(),
    connectionId: uuid('connection_id').notNull(),
    /** Copied from the connection: the destination's index and the member's reads. */
    memberId: uuid('member_id').notNull(),
    /** Google's calendar id, or Graph's. */
    providerCalendarId: text('provider_calendar_id').notNull(),
    name: text('name').notNull(),
    /** The provider's colour (`#rrggbb`), only ever shown through the nearest calendar hue. */
    providerColour: text('provider_colour'),
    /** A calendar hue the member picked (a tag hue's name), over the provider's. */
    colourOverride: text('colour_override'),
    accessRole: calendarAccessRole('access_role').notNull(),
    /** The account's main calendar. */
    isPrimary: boolean('is_primary').notNull().default(false),
    checkConflicts: boolean('check_conflicts').notNull().default(false),
    showInWeek: boolean('show_in_week').notNull().default(false),
    sync: boolean('sync').notNull().default(false),
    timeZone: text('time_zone'),
    /** Where the member's new bookings go (AC-996): one per member. */
    isDestination: boolean('is_destination').notNull().default(false),
    /**
     * On the destination: the name of the calendar it replaced when the provider removed that one, or it stopped
     * taking events (AC-1005), until the member dismisses the notice or picks another.
     */
    fellBackFrom: text('fell_back_from'),
    /** This calendar's sync token (or delta link), stored only once its batch committed. */
    syncState: jsonb('sync_state')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The push channel (Google) or subscription (Graph): its id, resource, expiry and hashed secret. */
    channel: jsonb('channel'),
    /** The last failure reading it, as `{ code, message, source }`, never a token or the provider's words. */
    lastError: jsonb('last_error'),
    failingSince: timestamptz('failing_since'),
    ...auditColumns(),
    createdByType: calendarActorType('created_by'),
    updatedByType: calendarActorType('updated_by'),
  },
  (t) => [
    primaryKey({ name: 'calendar_calendars_pkey', columns: [t.workspaceId, t.id] }),
    // The account and its member together: a calendar's member is always its connection's member.
    foreignKey({
      name: 'calendar_calendars_connection',
      columns: [t.workspaceId, t.connectionId, t.memberId],
      foreignColumns: [calendarConnections.workspaceId, calendarConnections.id, calendarConnections.memberId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'calendar_calendars_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    uniqueIndex('calendar_calendars_account').on(t.workspaceId, t.connectionId, t.providerCalendarId),
    uniqueIndex('calendar_calendars_destination')
      .on(t.workspaceId, t.memberId)
      .where(sql`${t.isDestination}`),
    // A member's calendars, for free and busy and the week.
    index('calendar_calendars_by_member').on(t.workspaceId, t.memberId),
    check(
      'calendar_calendars_destination_writable',
      sql`not ${t.isDestination} or ${t.accessRole} in ('owner', 'writer')`,
    ),
    check('calendar_calendars_name', sql`char_length(${t.name}) between 1 and 255`),
    check('calendar_calendars_provider_id', sql`char_length(${t.providerCalendarId}) between 1 and 1024`),
    check('calendar_calendars_colour', sql`${t.providerColour} ~ '^#[0-9a-f]{6}$'`),
    check('calendar_calendars_hue', sql`char_length(${t.colourOverride}) between 1 and 32`),
    check('calendar_calendars_zone', sql`char_length(${t.timeZone}) <= 64`),
    check('calendar_calendars_fell_back', sql`char_length(${t.fellBackFrom}) between 1 and 255`),
    ...actorConstraints(
      'calendar_calendars',
      'created_by',
      t.workspaceId,
      { type: t.createdByType, id: t.createdById, memberId: t.createdByMemberId },
      { withCalendar: true },
    ),
    ...actorConstraints(
      'calendar_calendars',
      'updated_by',
      t.workspaceId,
      { type: t.updatedByType, id: t.updatedById, memberId: t.updatedByMemberId },
      { withCalendar: true },
    ),
  ],
);
