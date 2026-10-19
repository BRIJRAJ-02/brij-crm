// Calendar sync (spec 0024): a member connects their Google calendar (Outlook
// from milestone 4), and the meetings in it sync onto the timelines of the
// people and companies they're with. `calendar.connections.*` lists and
// changes the member's own connections (connecting is the OAuth redirect, not
// a procedure); `calendar.meetings.forRecord` pages a record's meetings. A
// connection's tokens never leave the server: no shape here carries them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most calendar accounts one member may connect (AC-599). */
export const MAX_CALENDAR_CONNECTIONS = 3;

/** Meetings one `calendar.meetings.forRecord` page holds at most, and by default. */
export const MEETING_PAGE = 20;

/** The longest cursor `calendar.meetings.forRecord` takes. */
export const MAX_MEETING_CURSOR = 256;

/** What a meeting shows as to anyone but its holders, when it is private (AC-611). */
export const PRIVATE_MEETING_TITLE = 'Private meeting';

/** A calendar provider: Google now, Microsoft from milestone 4. */
export const CalendarProvider = z.enum(['google', 'microsoft']);
/** A calendar provider. */
export type CalendarProvider = z.infer<typeof CalendarProvider>;

/**
 * Where a connection stands (AC-597): `syncing` its first window,
 * `connected`, or stopped: `expired` (the provider refused the grant),
 * `revoked`, or `failed` (6 hours of failures, milestone 2).
 */
export const CalendarStatus = z.enum(['syncing', 'connected', 'expired', 'revoked', 'failed']);
/** Where a connection stands. */
export type CalendarStatus = z.infer<typeof CalendarStatus>;

/**
 * Who sees a connection's meetings in full (AC-611): `shared`, anyone who
 * can see a linked record; `private`, only the members holding it (everyone
 * else sees "Private meeting" and its time).
 */
export const CalendarSharing = z.enum(['shared', 'private']);
/** Who sees a connection's meetings in full. */
export type CalendarSharing = z.infer<typeof CalendarSharing>;

/** A connection's last failure: a stable code and a plain message, never a token. */
export const CalendarError = z.object({ code: z.string(), message: z.string() });
/** A connection's last failure. */
export type CalendarError = z.infer<typeof CalendarError>;

/** One of the member's calendar connections, as Settings › Calendar shows it. */
export const CalendarConnectionView = z.object({
  id: z.uuid(),
  provider: CalendarProvider,
  accountEmail: z.string(),
  status: CalendarStatus,
  sharing: CalendarSharing,
  isDefault: z.boolean(),
  /** The last sync that finished (AC-621). */
  lastSyncedAt: Timestamp.optional(),
  lastError: CalendarError.optional(),
  createdAt: Timestamp,
});
/** One of the member's calendar connections. */
export type CalendarConnectionView = z.infer<typeof CalendarConnectionView>;

/**
 * The member's own connections, newest first. `enabled` is false where
 * calendar sync isn't set up (`CALENDAR_SYNC` off): the screen says so and
 * offers no connect button, though connections made before still list.
 */
export const CalendarConnections = z.object({
  enabled: z.boolean(),
  /** Providers the member may connect here (Google now). */
  providers: z.array(CalendarProvider),
  connections: z.array(CalendarConnectionView),
  max: z.number().int().positive(),
});
/** The member's own connections. */
export type CalendarConnections = z.infer<typeof CalendarConnections>;

/** The member's connections. */
export const ListCalendarConnectionsInput = WorkspaceScoped;
/** The member's connections. */
export type ListCalendarConnectionsInput = z.infer<typeof ListCalendarConnectionsInput>;

/**
 * A change to one of the member's own connections: its sharing level, or
 * making it the default (`isDefault: true`; the member's other connection
 * stops being it). Only the fields given.
 */
export const UpdateCalendarConnectionInput = WorkspaceScoped.extend({
  connectionId: z.uuid(),
  sharing: CalendarSharing.optional(),
  isDefault: z.literal(true).optional(),
  mutationId: z.uuid(),
});
/** A change to one of the member's own connections. */
export type UpdateCalendarConnectionInput = z.infer<typeof UpdateCalendarConnectionInput>;

/**
 * Disconnecting one of the member's own connections (AC-599): sync stops at
 * once, its tokens are deleted, and the meetings no other connection holds go.
 */
export const RemoveCalendarConnectionInput = WorkspaceScoped.extend({
  connectionId: z.uuid(),
  mutationId: z.uuid(),
});
/** Disconnecting one of the member's own connections. */
export type RemoveCalendarConnectionInput = z.infer<typeof RemoveCalendarConnectionInput>;

/** What a disconnect did: the meetings it removed, counted. */
export const RemovedCalendarConnection = z.object({
  connectionId: z.uuid(),
  meetingsRemoved: z.number().int().min(0),
});
/** What a disconnect did. */
export type RemovedCalendarConnection = z.infer<typeof RemovedCalendarConnection>;

/** An attendee's answer to the invitation. */
export const AttendeeResponse = z.enum(['accepted', 'declined', 'tentative', 'needs_action']);
/** An attendee's answer to the invitation. */
export type AttendeeResponse = z.infer<typeof AttendeeResponse>;

/**
 * How an attendee matched (AC-606): `linked` to one person, `ambiguous`
 * (several people hold the email, none linked), `unknown` (nobody, or one the
 * reader can't see), or a workspace `member`.
 */
export const AttendeeMatch = z.enum(['linked', 'ambiguous', 'unknown', 'member']);
/** How an attendee matched. */
export type AttendeeMatch = z.infer<typeof AttendeeMatch>;

/** One attendee, as the reader may see them: a linked person only when the reader may see that person. */
export const MeetingAttendeeView = z.object({
  email: z.string(),
  name: z.string().optional(),
  response: AttendeeResponse,
  isOrganizer: z.boolean(),
  match: AttendeeMatch,
  memberId: z.uuid().optional(),
  person: RecordRefDisplay.optional(),
});
/** One attendee, as the reader may see them. */
export type MeetingAttendeeView = z.infer<typeof MeetingAttendeeView>;

/**
 * A meeting as one member sees it (AC-608, AC-611). A private one the reader
 * doesn't hold has `detailsHidden`: its title is "Private meeting", and it
 * carries no attendees, location or video link, only its time.
 */
export const MeetingView = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  allDay: z.boolean(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  isPrivate: z.boolean(),
  detailsHidden: z.boolean(),
  location: z.string().optional(),
  videoUrl: z.url().optional(),
  attendees: z.array(MeetingAttendeeView),
});
/** A meeting as one member sees it. */
export type MeetingView = z.infer<typeof MeetingView>;

/**
 * A page of a record's meetings: upcoming first (soonest first), then past
 * ones (newest first). `cursor` is the last page's `nextCursor`; a cursor the
 * server didn't make is refused 400 `INPUT_INVALID` naming `cursor`.
 */
export const MeetingsForRecordInput = WorkspaceScoped.extend({
  recordId: z.uuid(),
  cursor: z.string().min(1).max(MAX_MEETING_CURSOR).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MEETING_PAGE, `Ask for at most ${String(MEETING_PAGE)} meetings.`)
    .optional(),
});
/** A page of a record's meetings. */
export type MeetingsForRecordInput = z.infer<typeof MeetingsForRecordInput>;

/** A page of meetings, and the cursor for the next when there are more. */
export const MeetingPage = z.object({
  items: z.array(MeetingView),
  nextCursor: z.string().optional(),
});
/** A page of meetings. */
export type MeetingPage = z.infer<typeof MeetingPage>;

/**
 * Where a page of meetings ends, inside the opaque cursor (base64url JSON):
 * the moment the first page read as now (so upcoming and past never shift
 * under a reader), which half it was in, and the last meeting's start and id.
 */
export const MeetingCursor = z.strictObject({
  now: z.iso.datetime({ precision: 6 }),
  phase: z.enum(['upcoming', 'past']),
  startsAt: z.iso.datetime({ precision: 6 }),
  id: z.uuid(),
});
/** Where a page of meetings ends. */
export type MeetingCursor = z.infer<typeof MeetingCursor>;

/** The calendar procedures (spec 0024). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const calendarContract = {
  connections: {
    list: oc.input(ListCalendarConnectionsInput).output(CalendarConnections),
    update: oc.input(UpdateCalendarConnectionInput).output(CalendarConnectionView),
    remove: oc.input(RemoveCalendarConnectionInput).output(RemovedCalendarConnection),
  },
  meetings: {
    forRecord: oc.input(MeetingsForRecordInput).output(MeetingPage),
  },
};
