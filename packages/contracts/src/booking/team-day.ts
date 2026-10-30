// The Team day (spec 0030, as spec 0037's Amends 0030 changes it, job J12): Bookings › Calendar's Team view, one day
// with one column per member in the reader's See reach (`members.visible`, AC-1434). Each column holds that member's
// open hours, their Away band (time off, AC-1437), their bookings (by reference into `bookings`, masked as the
// Booking actions table says), their blocks and holds (labels only to Manage over them, AC-772), and their outside
// calendars as Busy spans, never titles (AC-770); the reader's own column shows their own events in full. The answer
// also carries the "Needs a host" lane (AC-1435) and the day's issues, derived on read (AC-1436).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { DateValue, Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { BookingListItem, CalendarEventItem } from './pages.ts';
import { TimeZoneName } from './settings.ts';
import { TimeOffReason } from './time-off.ts';

/** The Team day's numbers (spec 0030, AC-778): columns and items one answer holds at most. */
export const TEAM_DAY = { members: 50, items: 2000, asked: 200 } as const;

/** How the columns are ordered (AC-1438): me first then by name (the default), or by job title, then by name. */
export const TeamDayOrder = z.enum(['name', 'title']);
/** How the columns are ordered. */
export type TeamDayOrder = z.infer<typeof TeamDayOrder>;

/**
 * `bookings.teamDay` (AC-778): one day in the reader's zone. `memberIds` narrows it to some of the members the reader
 * may see (anyone else asked for is left out, never refused, AC-769); `withBookings` keeps only members with a
 * booking that day; `order` orders the columns.
 */
export const TeamDayInput = WorkspaceScoped.extend({
  day: DateValue,
  timeZone: TimeZoneName,
  memberIds: z.array(Uuid).max(TEAM_DAY.asked, { error: 'Pick at most 200 people.' }).optional(),
  withBookings: z.literal(true).optional(),
  order: TeamDayOrder.optional(),
});
/** `bookings.teamDay`'s input. */
export type TeamDayInput = z.infer<typeof TeamDayInput>;

/** A stretch of time, its end exclusive. */
export const TeamDaySpan = z.object({ startsAt: Timestamp, endsAt: Timestamp });
/** A stretch of time. */
export type TeamDaySpan = z.infer<typeof TeamDaySpan>;

/** Time a member closed, as a column holds it (a block or a hold). */
const CLOSED_TIME = {
  /** The block's id plus, for a weekly block, its date: unique in the answer. */
  key: z.string(),
  blockId: Uuid,
  repeat: z.enum(['once', 'weekly']),
  label: z.string().optional(),
  startsAt: Timestamp,
  endsAt: Timestamp,
};

/**
 * One thing in a member's column. `booking` names a booking in the answer's `bookings` (a co-host's seat shows it in
 * their column too). `block` and `hold` are time the member closed, labelled only for the member and Manage over them
 * (AC-772). `busy` is a span of their outside calendars by its time alone (AC-770). `event` is one of the reader's own
 * calendar events, in their own column only.
 */
export const TeamDayItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking'), bookingId: Uuid, startsAt: Timestamp, endsAt: Timestamp }),
  z.object({ kind: z.literal('block'), ...CLOSED_TIME }),
  z.object({ kind: z.literal('hold'), ...CLOSED_TIME }),
  z.object({ kind: z.literal('busy'), startsAt: Timestamp, endsAt: Timestamp }),
  z.object({ kind: z.literal('event'), event: CalendarEventItem }),
]);
/** One thing in a member's column. */
export type TeamDayItem = z.infer<typeof TeamDayItem>;

/**
 * One member's column. `open` is their open hours that day (their default schedule, its date override applied, read
 * in its own zone), on the reader's clock; empty is a day off. `away` is time off over the day (AC-1437): the reason
 * and note only for the member and Manage over them (AC-1286). `canManage`: the reader may book, block and reassign
 * for them (AC-773). `booked`: their confirmed bookings that day, for the header's status.
 */
export const TeamDayColumn = z.object({
  memberId: Uuid,
  name: z.string(),
  /** Their job title (spec 0031, AC-1441), shown under the name; a label only, never read by any access check. */
  jobTitle: z.string().optional(),
  /** Their default schedule's zone. */
  timeZone: z.string(),
  canManage: z.boolean(),
  open: z.array(TeamDaySpan),
  away: z
    .object({
      reason: TimeOffReason.optional(),
      note: z.string().optional(),
      span: TeamDaySpan,
    })
    .optional(),
  booked: z.number().int().min(0),
  items: z.array(TeamDayItem),
});
/** One member's column. */
export type TeamDayColumn = z.infer<typeof TeamDayColumn>;

/**
 * The day's issues among the visible columns (AC-1436), derived on read, nothing stored: a confirmed booking outside
 * its host's open hours, and a clash (a confirmed booking overlapping another confirmed booking or a calendar event of
 * the same member).
 */
export const TeamDayIssue = z.object({
  kind: z.enum(['outsideHours', 'clash']),
  memberId: Uuid,
  bookingId: Uuid,
  /** For a clash: the other booking, when it is one (a calendar event has no id the reader may see). */
  withBookingId: Uuid.optional(),
});
/** One of the day's issues. */
export type TeamDayIssue = z.infer<typeof TeamDayIssue>;

/**
 * A Team day (AC-778). `columns` in their order (the reader first unless ordered by title); `bookings` every booking
 * the columns and the lane name, once each; `needsHost` the "Needs a host" lane's bookings by start (AC-1435), set only
 * for people with Manage over at least one member or `booking.admin`; `truncated` when more members matched than one
 * answer holds ("Showing 50 of 64"); `from` and `to` the day's bounds on the reader's clock.
 */
export const TeamDay = z.object({
  day: DateValue,
  from: Timestamp,
  to: Timestamp,
  columns: z.array(TeamDayColumn),
  bookings: z.array(BookingListItem),
  needsHost: z.array(Uuid).optional(),
  issues: z.array(TeamDayIssue),
  truncated: z.object({ shown: z.number().int().min(0), total: z.number().int().min(0) }).optional(),
});
/** A Team day. */
export type TeamDay = z.infer<typeof TeamDay>;

/** `bookings.teamDay`: any member with `booking.manage`; the columns are the members in their See reach. */
export const teamDayProcedure = oc.input(TeamDayInput).output(TeamDay);
