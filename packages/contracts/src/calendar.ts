// Calendar sync (spec 0024): a member connects their Google calendar (Outlook
// from milestone 4), and the meetings in it sync onto the timelines of the
// people and companies they're with. `calendar.connections.*` lists and
// changes the member's own connections (connecting is the OAuth redirect, not
// a procedure); `calendar.meetings.forRecord` pages a record's meetings, and
// `.addAttendee` adds an unknown attendee as a person; `calendar.settings`
// reads and changes the workspace's calendar settings. A
// connection's tokens never leave the server: no shape here carries them.
//
// Milestone 5 (amendment of 20 October 2026): `calendar.calendars.*` lists
// the member's accounts with every calendar in them and changes one
// calendar's switches and colour; `calendar.destination.*` picks where new
// bookings go; `calendar.connections.refresh` lists an account's calendars
// again. Spec 0037's `calendar.health` (AC-1307) is the only calendar read
// about other members: a status and when it began, never an account's
// address, a calendar's name, a provider's words or an event.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { Hue } from './values/hues.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** The most calendar accounts one member may connect (AC-1000, which raised AC-599's 3). */
export const MAX_CALENDAR_CONNECTIONS = 6;

/** The most calendars kept per account (AC-991): the main one first, then by name. */
export const MAX_CALENDARS_PER_ACCOUNT = 50;

/** The most members one `calendar.health` asks about (spec 0037, AC-1307). */
export const MAX_HEALTH_MEMBERS = 50;

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
  id: Uuid,
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
  /** Providers the member may connect here: Google, and Outlook where `CALENDAR_OUTLOOK=on`. */
  providers: z.array(CalendarProvider),
  connections: z.array(CalendarConnectionView),
  max: z.number().int().positive(),
});
/** The member's own connections. */
export type CalendarConnections = z.infer<typeof CalendarConnections>;

/** What the member may do with a calendar at its provider (AC-991): only `owner` and `writer` take new bookings. */
export const CalendarAccessRole = z.enum(['owner', 'writer', 'reader', 'free_busy']);
/** What the member may do with a calendar at its provider. */
export type CalendarAccessRole = z.infer<typeof CalendarAccessRole>;

/**
 * Why a calendar was left out (AC-995): it couldn't be read for free and busy, or synced, at `at`, said in plain
 * words that name no provider error.
 */
export const CalendarWarning = z.object({ code: z.string(), message: z.string(), at: Timestamp });
/** Why a calendar was left out. */
export type CalendarWarning = z.infer<typeof CalendarWarning>;

/**
 * One calendar of one of the member's accounts (AC-993): its name, the hue it draws in (the member's pick, else the
 * provider's colour's nearest), its three switches, and whether new bookings go there. Only its member ever reads it.
 */
export const CalendarView = z.object({
  id: Uuid,
  connectionId: Uuid,
  name: z.string(),
  hue: Hue,
  /** The member's pick; absent, the hue comes from the provider's colour. */
  colourOverride: Hue.optional(),
  accessRole: CalendarAccessRole,
  isPrimary: z.boolean(),
  checkConflicts: z.boolean(),
  showInWeek: z.boolean(),
  sync: z.boolean(),
  isDestination: z.boolean(),
  /** An owner or writer calendar on an account that still works (AC-1004). */
  canBeDestination: z.boolean(),
  timeZone: z.string().optional(),
  warning: CalendarWarning.optional(),
});
/** One calendar of one of the member's accounts. */
export type CalendarView = z.infer<typeof CalendarView>;

/** One of the member's accounts with its calendars, the main one first, then by name. */
export const CalendarAccountView = CalendarConnectionView.extend({ calendars: z.array(CalendarView) });
/** One of the member's accounts with its calendars. */
export type CalendarAccountView = z.infer<typeof CalendarAccountView>;

/**
 * The member's accounts and calendars (AC-993), newest account first, and where new bookings go. `fellBack` names
 * the calendar that was the destination when the provider removed it, until the member dismisses it or picks
 * another (AC-1005).
 */
export const CalendarList = z.object({
  enabled: z.boolean(),
  providers: z.array(CalendarProvider),
  max: z.number().int().positive(),
  accounts: z.array(CalendarAccountView),
  destinationId: Uuid.optional(),
  fellBack: z.object({ removedName: z.string() }).optional(),
});
/** The member's accounts and calendars. */
export type CalendarList = z.infer<typeof CalendarList>;

/** The member's accounts and calendars. */
export const ListCalendarsInput = WorkspaceScoped;
/** The member's accounts and calendars. */
export type ListCalendarsInput = z.infer<typeof ListCalendarsInput>;

/**
 * A change to one of the member's own calendars (AC-993): any of its three switches, and its colour (`null` goes
 * back to the provider's). Only the fields given.
 */
export const UpdateCalendarInput = WorkspaceScoped.extend({
  calendarId: Uuid,
  checkConflicts: z.boolean().optional(),
  showInWeek: z.boolean().optional(),
  sync: z.boolean().optional(),
  colourOverride: Hue.nullable().optional(),
  mutationId: Uuid,
});
/** A change to one of the member's own calendars. */
export type UpdateCalendarInput = z.infer<typeof UpdateCalendarInput>;

/** Where the member's new bookings go (AC-996): one of their calendars they can write. */
export const SetCalendarDestinationInput = WorkspaceScoped.extend({ calendarId: Uuid, mutationId: Uuid });
/** Where the member's new bookings go. */
export type SetCalendarDestinationInput = z.infer<typeof SetCalendarDestinationInput>;

/** The member read the notice that their destination fell back (AC-1005). */
export const DismissCalendarNoticeInput = WorkspaceScoped.extend({ mutationId: Uuid });
/** The member read the notice that their destination fell back. */
export type DismissCalendarNoticeInput = z.infer<typeof DismissCalendarNoticeInput>;

/** Where new bookings go now. */
export const CalendarDestination = z.object({ destinationId: Uuid.optional() });
/** Where new bookings go now. */
export type CalendarDestination = z.infer<typeof CalendarDestination>;

/** Refresh: lists one of the member's accounts' calendars again on its next sync, brought forward to now (AC-991). */
export const RefreshCalendarConnectionInput = WorkspaceScoped.extend({ connectionId: Uuid, mutationId: Uuid });
/** Refresh an account's calendars. */
export type RefreshCalendarConnectionInput = z.infer<typeof RefreshCalendarConnectionInput>;

/**
 * A member's calendar health as a colleague may see it (spec 0037, AC-1307): `connected`; `skipped` (some
 * conflict calendar can't be read); `reconnect` (the destination's account, or every conflict calendar, has
 * stopped); `none` (no calendar). Never an address, a calendar's name, a provider's words or an event.
 */
export const CalendarHealthStatus = z.enum(['connected', 'skipped', 'reconnect', 'none']);
/** A member's calendar health. */
export type CalendarHealthStatus = z.infer<typeof CalendarHealthStatus>;

/** One member's calendar health, and since when (absent for `none`, and for `connected` when nothing ever broke). */
export const MemberCalendarHealth = z.object({
  memberId: Uuid,
  status: CalendarHealthStatus,
  since: Timestamp.optional(),
});
/** One member's calendar health. */
export type MemberCalendarHealth = z.infer<typeof MemberCalendarHealth>;

/** Asking after members' calendar health: those the reader may not see are left out of the answer. */
export const CalendarHealthInput = WorkspaceScoped.extend({
  memberIds: z
    .array(Uuid)
    .min(1)
    .max(MAX_HEALTH_MEMBERS, `Ask about at most ${String(MAX_HEALTH_MEMBERS)} members.`),
});
/** Asking after members' calendar health. */
export type CalendarHealthInput = z.infer<typeof CalendarHealthInput>;

/** The asked members' calendar health, in the order asked. */
export const CalendarHealth = z.object({ members: z.array(MemberCalendarHealth) });
/** The asked members' calendar health. */
export type CalendarHealth = z.infer<typeof CalendarHealth>;

/**
 * A booking page's own "Add events to" (AC-997): the calendar it names (one of the page owner's), and whether
 * bookings can go there now. `default` follows the owner's own destination; `unusable` names a calendar that can't
 * take bookings, or the one it named went (no `calendarId`), so they go to the owner's. A colleague never reads a
 * calendar's name; the owner reads names from their own list, and a gone calendar's from `removedName`.
 */
export const PageDestinationView = z.object({
  calendarId: Uuid.optional(),
  status: z.enum(['default', 'page', 'unusable']),
  isOwner: z.boolean(),
  /** The page's calendar went (removed at the provider, or its account disconnected): its name, to the owner only. */
  removedName: z.string().max(255).optional(),
});
/** A booking page's own "Add events to". */
export type PageDestinationView = z.infer<typeof PageDestinationView>;

/** A booking page's own "Add events to". */
export const GetPageDestinationInput = WorkspaceScoped.extend({ pageId: Uuid });
/** A booking page's own "Add events to". */
export type GetPageDestinationInput = z.infer<typeof GetPageDestinationInput>;

/** Setting a booking page's own "Add events to": one of the owner's writable calendars, or `null` for theirs. */
export const SetPageDestinationInput = WorkspaceScoped.extend({
  pageId: Uuid,
  calendarId: Uuid.nullable(),
  mutationId: Uuid,
});
/** Setting a booking page's own "Add events to". */
export type SetPageDestinationInput = z.infer<typeof SetPageDestinationInput>;

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
  connectionId: Uuid,
  sharing: CalendarSharing.optional(),
  isDefault: z.literal(true).optional(),
  mutationId: Uuid,
});
/** A change to one of the member's own connections. */
export type UpdateCalendarConnectionInput = z.infer<typeof UpdateCalendarConnectionInput>;

/**
 * Disconnecting one of the member's own connections (AC-599): sync stops at
 * once, its tokens are deleted, and the meetings no other connection holds go.
 */
export const RemoveCalendarConnectionInput = WorkspaceScoped.extend({
  connectionId: Uuid,
  mutationId: Uuid,
});
/** Disconnecting one of the member's own connections. */
export type RemoveCalendarConnectionInput = z.infer<typeof RemoveCalendarConnectionInput>;

/** Sync now: brings one of the member's own connections' next sync forward. */
export const SyncCalendarNowInput = WorkspaceScoped.extend({ connectionId: Uuid, mutationId: Uuid });
/** Sync now. */
export type SyncCalendarNowInput = z.infer<typeof SyncCalendarNowInput>;

/** Whether Sync now queued a sync (a stopped connection queues none). */
export const SyncCalendarNowResult = z.object({ queued: z.boolean() });
/** Whether Sync now queued a sync. */
export type SyncCalendarNowResult = z.infer<typeof SyncCalendarNowResult>;

/** What a disconnect did: the meetings it removed, counted. */
export const RemovedCalendarConnection = z.object({
  connectionId: Uuid,
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
  memberId: Uuid.optional(),
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
  id: Uuid,
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
  recordId: Uuid,
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
  id: Uuid,
});
/** Where a page of meetings ends. */
export type MeetingCursor = z.infer<typeof MeetingCursor>;

/**
 * Adding a meeting's attendee the CRM doesn't know as a person (AC-609): the
 * meeting on a record the reader sees, and the attendee by their email.
 */
export const AddMeetingAttendeeInput = WorkspaceScoped.extend({
  recordId: Uuid,
  meetingId: Uuid,
  email: z.string().trim().min(3).max(320),
  mutationId: Uuid,
});
/** Adding a meeting's attendee as a person. */
export type AddMeetingAttendeeInput = z.infer<typeof AddMeetingAttendeeInput>;

/** The person an Add as person made. */
export const AddedMeetingAttendee = z.object({ recordId: Uuid });
/** The person an Add as person made. */
export type AddedMeetingAttendee = z.infer<typeof AddedMeetingAttendee>;

/**
 * The workspace's calendar settings (AC-609): whether the sync makes people
 * for unknown external attendees (off by default), and whether the reader
 * may change it (owners and admins).
 */
export const CalendarSettingsView = z.object({
  createUnknownPeople: z.boolean(),
  canManage: z.boolean(),
});
/** The workspace's calendar settings. */
export type CalendarSettingsView = z.infer<typeof CalendarSettingsView>;

/** The workspace's calendar settings. */
export const GetCalendarSettingsInput = WorkspaceScoped;
/** The workspace's calendar settings. */
export type GetCalendarSettingsInput = z.infer<typeof GetCalendarSettingsInput>;

/** A change to the workspace's calendar settings (owners and admins). */
export const UpdateCalendarSettingsInput = WorkspaceScoped.extend({
  createUnknownPeople: z.boolean(),
  mutationId: Uuid,
});
/** A change to the workspace's calendar settings. */
export type UpdateCalendarSettingsInput = z.infer<typeof UpdateCalendarSettingsInput>;

/** The calendar procedures (spec 0024). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const calendarContract = {
  connections: {
    list: oc.input(ListCalendarConnectionsInput).output(CalendarConnections),
    update: oc.input(UpdateCalendarConnectionInput).output(CalendarConnectionView),
    remove: oc.input(RemoveCalendarConnectionInput).output(RemovedCalendarConnection),
    syncNow: oc.input(SyncCalendarNowInput).output(SyncCalendarNowResult),
    refresh: oc.input(RefreshCalendarConnectionInput).output(SyncCalendarNowResult),
  },
  calendars: {
    list: oc.input(ListCalendarsInput).output(CalendarList),
    update: oc.input(UpdateCalendarInput).output(CalendarView),
  },
  destination: {
    set: oc.input(SetCalendarDestinationInput).output(CalendarDestination),
    dismissNotice: oc.input(DismissCalendarNoticeInput).output(CalendarDestination),
  },
  pageDestination: {
    get: oc.input(GetPageDestinationInput).output(PageDestinationView),
    set: oc.input(SetPageDestinationInput).output(PageDestinationView),
  },
  health: oc.input(CalendarHealthInput).output(CalendarHealth),
  meetings: {
    forRecord: oc.input(MeetingsForRecordInput).output(MeetingPage),
    addAttendee: oc.input(AddMeetingAttendeeInput).output(AddedMeetingAttendee),
  },
  settings: {
    get: oc.input(GetCalendarSettingsInput).output(CalendarSettingsView),
    update: oc.input(UpdateCalendarSettingsInput).output(CalendarSettingsView),
  },
};
