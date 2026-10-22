// Booking pages for members (spec 0025, milestone 1): `bookingPages.*` lists,
// reads, makes, changes and deletes pages; `bookings.list` lists one page's
// bookings. A member with `booking.manage` changes their own pages; one with
// `booking.admin` changes everyone's.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import {
  BookAsHostInput,
  CreateTimeBlockInput,
  RemoveTimeBlockInput,
  TimeBlockOccurrence,
  TimeBlockView,
} from './blocks.ts';
import { CANCEL_REASON_MAX, PublicSlots } from './public.ts';
import { ScheduleHours } from './schedules.ts';
import { BookingAssignment, BookingAssignmentsInput, ReassignBookingInput, ReassignedBooking } from './rotations.ts';
import { BookingAvailability, BookingLocation, BookingPageSettings, TimeZoneName } from './settings.ts';
import { Uuid, uuidV7 } from '../values/ids.ts';
import { RecordRefDisplay } from '../values/options.ts';
import { RoutingRules } from '../forms/routing.ts';

/** The most fixed hosts, rotations, and hosts in all, on one round robin page (spec 0037, AC-1319). */
export const TEAM_HOSTS_MAX = { fixed: 7, rotations: 3, hosts: 8 } as const;

/**
 * A round robin page's hosts (spec 0037, AC-1319): 0 to 7 fixed hosts who attend every meeting, and 1 to 3
 * rotations, one host from each; at most 8 people in all. The server checks the rest (HOSTS_INVALID).
 */
export const TeamHosts = z.object({
  fixed: z.array(Uuid).max(TEAM_HOSTS_MAX.fixed, 'A page has at most 7 fixed hosts.'),
  rotations: z
    .array(Uuid)
    .min(1, 'Pick a rotation.')
    .max(TEAM_HOSTS_MAX.rotations, 'A page books from at most 3 rotations.'),
});
/** A round robin page's hosts. */
export type TeamHosts = z.infer<typeof TeamHosts>;

/** A page as a member sees it in Settings › Booking pages. */
export const BookingPageView = BookingPageSettings.extend({
  id: Uuid,
  publicKey: z.string(),
  kind: z.enum(['personal', 'collective', 'round_robin']),
  ownerMemberId: Uuid,
  /** The owner's handle, when they have one: the page's address is then `/<handle>/<slug>`, else `/b/<publicKey>`. */
  handle: z.string().optional(),
  /** The hours the page books by now: its schedule's, or the owner's default's (spec 0035), read only here. */
  availability: BookingAvailability,
  /** That schedule's name ("Working hours" while its owner has saved none), read only here. */
  scheduleName: z.string(),
  /** Why a paused page is paused when the system paused it: its last host was removed (spec 0031, AC-814). */
  pausedReason: z.literal('host_removed').optional(),
  /** A round robin page's hosts (spec 0037, AC-1319): its fixed hosts and the rotations it books one host from. */
  hosts: TeamHosts.optional(),
  /** A round robin page's routing rules (spec 0043, AC-1608): each picks some of its hosts. */
  routing: RoutingRules.optional(),
  /** Confirmed bookings starting this calendar month (UTC). */
  bookingsThisMonth: z.number().int().min(0),
  /** The reader may change it: their own page with `booking.manage`, anyone's with `booking.admin`. */
  canChange: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
/** A page as a member sees it. */
export type BookingPageView = z.infer<typeof BookingPageView>;

/** Every page the reader may see: their own, or everyone's with `booking.admin`. */
export const ListBookingPagesInput = WorkspaceScoped;
/** The pages read. */
export type ListBookingPagesInput = z.infer<typeof ListBookingPagesInput>;

/** One page. */
export const GetBookingPageInput = WorkspaceScoped.extend({ pageId: Uuid });
/** One page. */
export type GetBookingPageInput = z.infer<typeof GetBookingPageInput>;

const RELOAD_MESSAGE = 'Reload the app: a page’s hours now come from its schedule.';

/**
 * A page's settings as a write sends them. For one release after spec 0035 a
 * tab still running the old app may send `hoursMode` or `availability`: they
 * are refused, so its change is never silently dropped (AC-975).
 */
export const BookingPageSettingsWrite = BookingPageSettings.partial().extend({
  hoursMode: z.never({ error: RELOAD_MESSAGE }).optional(),
  availability: z.never({ error: RELOAD_MESSAGE }).optional(),
});
/** A page's settings as a write sends them. */
export type BookingPageSettingsWrite = z.infer<typeof BookingPageSettingsWrite>;

/**
 * A new personal page for the caller. `id` is a UUID v7 the browser mints, and
 * the retry key. Settings left out take their defaults: 30 minutes on video,
 * weekdays 09:00 to 17:00 in `timeZone`, no buffers or notice, 60 days ahead,
 * live, and a slug from the title.
 */
export const CreateBookingPageInput = WorkspaceScoped.extend({
  id: uuidV7('The page id must be a UUID v7.'),
  title: BookingPageSettings.shape.title,
  /** The creator's zone: the virtual default's, while the owner has saved no schedule (spec 0035, AC-963). */
  timeZone: TimeZoneName,
  settings: BookingPageSettingsWrite.optional(),
  /** `personal` (the default) or, with `booking.admin`, `round_robin` (spec 0029), which names its hosts. */
  kind: z.enum(['personal', 'round_robin']).optional(),
  hosts: TeamHosts.optional(),
  mutationId: Uuid,
});
/** A new page. */
export type CreateBookingPageInput = z.infer<typeof CreateBookingPageInput>;

/** A change to a page: only the settings given. */
export const UpdateBookingPageInput = WorkspaceScoped.extend({
  pageId: Uuid,
  settings: BookingPageSettingsWrite,
  /** A round robin page's hosts, replacing them (`booking.admin`). */
  hosts: TeamHosts.optional(),
  /** A round robin page's routing rules, replacing them (spec 0043, AC-1608; `booking.admin`). */
  routing: RoutingRules.optional(),
  mutationId: Uuid,
});
/** A change to a page. */
export type UpdateBookingPageInput = z.infer<typeof UpdateBookingPageInput>;

/** Deleting a page: it is hidden, its bookings stay, and its link answers that it's no longer available (AC-648). */
export const DeleteBookingPageInput = WorkspaceScoped.extend({ pageId: Uuid, mutationId: Uuid });
/** Deleting a page. */
export type DeleteBookingPageInput = z.infer<typeof DeleteBookingPageInput>;

/** A booking as the page's members see it. */
export const BookingView = z.object({
  id: Uuid,
  pageId: Uuid,
  hostMemberId: Uuid,
  startsAt: Timestamp,
  endsAt: Timestamp,
  visitorName: z.string(),
  visitorEmail: z.string(),
  visitorTimeZone: z.string(),
  status: z.enum(['confirmed', 'cancelled']),
  personRecordId: Uuid.optional(),
  companyRecordId: Uuid.optional(),
  /** The calendar event couldn't be made: the booking stands, and the host should add it by hand. */
  eventFailed: z.boolean(),
  createdAt: Timestamp,
});
/** A booking. */
export type BookingView = z.infer<typeof BookingView>;

/** At most this many bookings in one read. */
export const BOOKINGS_PAGE_MAX = 100;

/** One page's bookings: upcoming (soonest first) or past (latest first). */
export const ListBookingsInput = WorkspaceScoped.extend({
  pageId: Uuid,
  when: z.enum(['upcoming', 'past']),
});
/** One page's bookings. */
export type ListBookingsInput = z.infer<typeof ListBookingsInput>;

/** Member procedures for booking pages. */
export const bookingPagesContract = {
  list: oc.input(ListBookingPagesInput).output(z.array(BookingPageView)),
  get: oc.input(GetBookingPageInput).output(BookingPageView),
  create: oc.input(CreateBookingPageInput).output(BookingPageView),
  update: oc.input(UpdateBookingPageInput).output(BookingPageView),
  delete: oc.input(DeleteBookingPageInput).output(z.object({ pageId: Uuid })),
};

/** A member's default schedule's hours and days off (spec 0035: `schedules.*` is the full surface). */
export const MemberHours = z.object({ availability: BookingAvailability });
/** A member's own hours. */
export type MemberHours = z.infer<typeof MemberHours>;

/** The caller's own hours; never set yet, weekdays 09:00 to 17:00 in `timeZone`. */
export const GetMemberHoursInput = WorkspaceScoped.extend({
  timeZone: TimeZoneName,
});
/** The caller's own hours. */
export type GetMemberHoursInput = z.infer<typeof GetMemberHoursInput>;

/** Replaces the caller's default schedule's hours, every time on a 15 minute step (spec 0035, AC-961). */
export const UpdateMemberHoursInput = WorkspaceScoped.extend({
  availability: ScheduleHours,
  mutationId: Uuid,
});
/** Replaces the caller's own hours. */
export type UpdateMemberHoursInput = z.infer<typeof UpdateMemberHoursInput>;

/**
 * A booking in Bookings, the workspace's list (spec 0025, AC-646): the
 * booking, its page's title and location, the meeting's video link once the
 * event has one, the visitor's guests and note, and why it was cancelled.
 */
export const BookingListItem = BookingView.extend({
  pageTitle: z.string(),
  location: BookingLocation,
  videoUrl: z.string().optional(),
  guests: z.array(z.string()),
  note: z.string().optional(),
  /** The conversation, for a booking made by chat (spec 0042, AC-1522): who said each line and what. */
  chat: z.array(z.object({ role: z.enum(['visitor', 'assistant']), text: z.string() })).optional(),
  cancelReason: z.string().optional(),
  /** Who cancelled it: the guest from their page, the host, or the host's calendar. */
  cancelledBy: z.enum(['guest', 'host', 'calendar']).optional(),
  /** How many times it has moved (at most 5). */
  reschedules: z.number().int().min(0),
  /** Its host was removed from the workspace (spec 0031, AC-815): it stays for an admin to hand on. */
  hostRemoved: z.boolean().optional(),
  /** Its host's name as the workspace shows it, for "Sam Lee and Grace" on a booking someone else hosts. */
  hostName: z.string(),
  /** Its host left with nobody free to take it (spec 0029, AC-749): "Needs a host" until an admin reassigns it. */
  needsHost: z.boolean(),
  /** Marked as a no show after it (spec 0043, AC-1613). */
  noShow: z.boolean().optional(),
  /**
   * The record it was linked to by hand from its card (polish F2): a deal, or another object's record, as a chip
   * shows it. Absent when there is none, or the reader may not see it (hidden means absent).
   */
  linkedRecord: RecordRefDisplay.optional(),
});
/** A booking in Bookings. */
export type BookingListItem = z.infer<typeof BookingListItem>;

/** At most this many bookings in one read of Bookings. */
export const BOOKINGS_LIST_MAX = 200;

/** Bookings' tabs: confirmed and not yet ended, confirmed and ended, and cancelled. */
export const BookingsTab = z.enum(['upcoming', 'past', 'cancelled']);
/** One of Bookings' tabs. */
export type BookingsTab = z.infer<typeof BookingsTab>;

/**
 * Bookings, the workspace's list: upcoming (confirmed, not yet ended, soonest
 * first), past (confirmed and ended, latest first) or cancelled (latest
 * first), across every page the reader may see (their own, and the ones they
 * host; everyone's with `booking.admin`).
 */
export const ListWorkspaceBookingsInput = WorkspaceScoped.extend({ when: BookingsTab });
/** Bookings, the workspace's list. */
export type ListWorkspaceBookingsInput = z.infer<typeof ListWorkspaceBookingsInput>;

/** The longest range one calendar read covers: 42 days (a month view's six weeks). */
export const BOOKING_CALENDAR_MAX_DAYS = 42;

/**
 * Bookings' calendar for a range (the week view): every booking the reader
 * may see that overlaps it, cancelled ones too, and the reader's own calendar
 * events from their connected calendars (spec 0024), so the week shows what
 * else they have on.
 */
export const BookingCalendarInput = WorkspaceScoped.extend({ from: Timestamp, to: Timestamp }).refine(
  ({ from, to }) => {
    const span = Date.parse(to) - Date.parse(from);
    return span > 0 && span <= BOOKING_CALENDAR_MAX_DAYS * 86_400_000;
  },
  { error: `Ask for a range of at most ${String(BOOKING_CALENDAR_MAX_DAYS)} days.`, path: ['to'] },
);
/** A calendar read. */
export type BookingCalendarInput = z.infer<typeof BookingCalendarInput>;

/** One of the reader's own calendar events (not a booking): spec 0024's meeting, from one of their connections. */
export const CalendarEventItem = z.object({
  id: Uuid,
  /** Which of the reader's connections holds it. */
  connectionId: Uuid,
  /** Which of the reader's calendars holds it (spec 0024 milestone 5): its colour and the week's filter. */
  calendarId: Uuid,
  title: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  allDay: z.boolean(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  location: z.string().optional(),
  videoUrl: z.string().optional(),
});
/** One of the reader's calendar events. */
export type CalendarEventItem = z.infer<typeof CalendarEventItem>;

/**
 * A span the reader's own calendar holds with nobody else invited (the
 * owner's call, 20 October 2026): shown as Busy, by its time alone. Its
 * title and everything else stay in the calendar.
 */
export const BusyTimeItem = z.object({
  /** Which of the reader's connections holds it. */
  connectionId: Uuid,
  /** Which of the reader's calendars holds it (spec 0024 milestone 5): its tint and the week's filter. */
  calendarId: Uuid,
  startsAt: Timestamp,
  endsAt: Timestamp,
});
/** A span the reader's own calendar holds with nobody else invited. */
export type BusyTimeItem = z.infer<typeof BusyTimeItem>;

/**
 * A calendar read's answer: the bookings, the reader's other events, their
 * busy times and the time they closed in the range, each by start.
 */
export const BookingsCalendarView = z.object({
  bookings: z.array(BookingListItem),
  events: z.array(CalendarEventItem),
  busy: z.array(BusyTimeItem),
  blocks: z.array(TimeBlockOccurrence),
});
/** A calendar read's answer. */
export type BookingsCalendarView = z.infer<typeof BookingsCalendarView>;

/** Cancelling a booking from Bookings (AC-640): the guest is told, with the reason when one is given. */
export const CancelBookingInput = WorkspaceScoped.extend({
  bookingId: Uuid,
  reason: z
    .string()
    .trim()
    .max(CANCEL_REASON_MAX, { error: `Keep the reason to ${String(CANCEL_REASON_MAX)} characters.` })
    .optional(),
  mutationId: Uuid,
});
/** Cancelling a booking. */
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;

/** Moving a booking from Bookings (AC-640): to a time its page offers now. */
export const MoveBookingInput = WorkspaceScoped.extend({ bookingId: Uuid, start: Timestamp, mutationId: Uuid });
/** Moving a booking. */
export type MoveBookingInput = z.infer<typeof MoveBookingInput>;

/** The longest range one move slots read covers: 31 days. */
export const MOVE_SLOTS_MAX_DAYS = 31;

/** Where a booking could move in a range: its page's slots of its length, its own time free. */
export const BookingMoveSlotsInput = WorkspaceScoped.extend({
  bookingId: Uuid,
  from: Timestamp,
  to: Timestamp,
}).refine(
  ({ from, to }) => {
    const span = Date.parse(to) - Date.parse(from);
    return span > 0 && span <= MOVE_SLOTS_MAX_DAYS * 86_400_000;
  },
  { error: `Ask for a range of at most ${String(MOVE_SLOTS_MAX_DAYS)} days.`, path: ['to'] },
);
/** A move slots read. */
export type BookingMoveSlotsInput = z.infer<typeof BookingMoveSlotsInput>;

/** The guest page's address for a booking (Copy guest link): read on demand, since it carries the guest's key. */
export const BookingGuestLinkInput = WorkspaceScoped.extend({ bookingId: Uuid });
/** A guest link read. */
export type BookingGuestLinkInput = z.infer<typeof BookingGuestLinkInput>;

/** Member procedures for bookings. */
/** The most meetings one page of Bookings' list answers. */
export const MEETINGS_PAGE_MAX = 100;

/** Where a meeting in Bookings' list came from: a booking link, the member's synced calendars, or either. */
export const MeetingSource = z.enum(['all', 'bookings', 'calendar']);
/** Where a meeting came from. */
export type MeetingSource = z.infer<typeof MeetingSource>;

/**
 * One page of Bookings' list (the owner's ask of 21 October 2026): every meeting on one tab, bookings and the
 * reader's own calendar events together, by start (soonest first upcoming, latest first otherwise), narrowed to a
 * source and to some of the reader's calendars. `cursor` is the last page's `nextCursor`.
 */
export const ListMeetingsInput = WorkspaceScoped.extend({
  when: BookingsTab,
  source: MeetingSource.default('all'),
  /** Only these of the reader's calendars' events (the calendars panel's pick); absent is every one shown. */
  calendarIds: z.array(Uuid).max(50).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(MEETINGS_PAGE_MAX).default(50),
});
/** One page of Bookings' list. */
export type ListMeetingsInput = z.input<typeof ListMeetingsInput>;

/**
 * A meeting in Bookings' list: a booking as the list shows it, or one of the reader's own calendar events with up
 * to six attendees' addresses and how many there are. Never another member's calendar event.
 */
export const MeetingListItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking'), booking: BookingListItem }),
  z.object({
    kind: z.literal('event'),
    event: CalendarEventItem,
    attendees: z.array(z.string()).max(6),
    attendeeCount: z.number().int().nonnegative(),
  }),
]);
/** A meeting in Bookings' list. */
export type MeetingListItem = z.infer<typeof MeetingListItem>;

/** One page of meetings, and where the next begins (absent on the last). */
export const MeetingListPage = z.object({ items: z.array(MeetingListItem), nextCursor: z.string().optional() });
/** One page of meetings. */
export type MeetingListPage = z.infer<typeof MeetingListPage>;

/**
 * Linking a booking to a record by hand (polish F2): a deal, or a record of another object the caller may change
 * (never a person or a company: those are its guest's, filed when it was made). `null` takes the link off.
 */
export const LinkBookingRecordInput = WorkspaceScoped.extend({
  bookingId: Uuid,
  recordId: Uuid.nullable(),
  mutationId: Uuid,
});
/** Linking a booking to a record by hand. */
export type LinkBookingRecordInput = z.infer<typeof LinkBookingRecordInput>;

/** What a booking is linked to now, as a chip shows it; absent once unlinked. */
export const LinkedBookingRecord = z.object({ linkedRecord: RecordRefDisplay.optional() });
/** What a booking is linked to now. */
export type LinkedBookingRecord = z.infer<typeof LinkedBookingRecord>;

/** Marking a booking as a no show (`noShow: true`) or taking the mark back. */
export const MarkNoShowInput = WorkspaceScoped.extend({ bookingId: Uuid, noShow: z.boolean(), mutationId: Uuid });
/** Marking a booking as a no show. */
export type MarkNoShowInput = z.infer<typeof MarkNoShowInput>;

export const bookingsContract = {
  list: oc.input(ListBookingsInput).output(z.array(BookingView)),
  listAll: oc.input(ListWorkspaceBookingsInput).output(z.array(BookingListItem)),
  /** Bookings' list: every meeting, bookings and the reader's calendar events, a page at a time. */
  meetings: oc.input(ListMeetingsInput).output(MeetingListPage),
  calendar: oc.input(BookingCalendarInput).output(BookingsCalendarView),
  hours: oc.input(GetMemberHoursInput).output(MemberHours),
  setHours: oc.input(UpdateMemberHoursInput).output(MemberHours),
  /** Book someone in, in the caller's own time (spec 0027). */
  bookAsHost: oc.input(BookAsHostInput).output(z.object({ bookingId: Uuid })),
  /** Cancel a booking: the guest is told (AC-640). */
  cancel: oc.input(CancelBookingInput).output(z.object({ cancelled: z.boolean() })),
  /** Move a booking to a time its page offers (AC-640). */
  move: oc.input(MoveBookingInput).output(z.object({ moved: z.boolean() })),
  /** Where a booking could move. */
  moveSlots: oc.input(BookingMoveSlotsInput).output(PublicSlots),
  /** The guest page's path, `/b/<key>/manage?t=<token>`. */
  guestLink: oc.input(BookingGuestLinkInput).output(z.object({ path: z.string() })),
  /** Why a round robin booking went to its host (spec 0029, AC-742): its ledger rows, newest first. */
  assignments: oc.input(BookingAssignmentsInput).output(z.array(BookingAssignment)),
  /** Give one seat of a round robin booking to someone else (spec 0029, AC-748): Manage over both hosts. */
  reassign: oc.input(ReassignBookingInput).output(ReassignedBooking),
  /** Mark a past booking as a no show, or undo it (spec 0043, AC-1613): its host or `booking.admin`. */
  markNoShow: oc.input(MarkNoShowInput).output(z.object({ noShow: z.boolean() })),
  /** Link a booking to a record by hand, or take the link off (polish F2): its host, the page's owner or an admin. */
  link: oc.input(LinkBookingRecordInput).output(LinkedBookingRecord),
  /** Time the caller closed on their own calendar (spec 0027). */
  blocks: {
    create: oc.input(CreateTimeBlockInput).output(TimeBlockView),
    remove: oc.input(RemoveTimeBlockInput).output(z.object({ id: Uuid })),
  },
};
