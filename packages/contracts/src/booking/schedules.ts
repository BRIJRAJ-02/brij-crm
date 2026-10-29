// Availability schedules (spec 0035): a member's named sets of hours, one of
// them their default, and the schedule each booking page books by. The hours
// keep the `BookingAvailability` shape a page's hours always had, so the slot
// engine reads them unchanged. A member edits their own with `booking.manage`;
// one with `booking.admin` edits anyone's (AC-971).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Uuid, uuidV7 } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { BookingAvailability, minutesOf, TimeZoneName, WEEKDAYS } from './settings.ts';

/** At most this many schedules per member (AC-961). */
export const SCHEDULES_MAX = 20;

/** The name the virtual default and every migrated member's hours go by (AC-963, AC-973). */
export const DEFAULT_SCHEDULE_NAME = 'Working hours';

/** A schedule's name: 1 to 60 characters, unique among the member's ignoring case (AC-961). */
export const ScheduleName = z
  .string()
  .trim()
  .min(1, 'Give the schedule a name.')
  .max(60, 'Keep the name to 60 characters.');
/** A schedule's name. */
export type ScheduleName = z.infer<typeof ScheduleName>;

/** Whether a stored `HH:MM` sits on a 15 minute step: 09:00, 09:15 … 24:00 (AC-961). */
export function isQuarterHour(time: string): boolean {
  return minutesOf(time) % 15 === 0;
}

const QUARTER_HOUR_MESSAGE = 'Use times on the quarter hour, such as 09:15.';

/**
 * What a schedule with no hours at all is refused with (27 October 2026). A
 * page booking by it offers a visitor an empty calendar for ever, with
 * nothing on either side saying why, so the empty week is refused where it is
 * saved rather than discovered by whoever was meant to book.
 */
export const NO_HOURS_AT_ALL =
  'Open at least one time on one day. A page booking by this schedule would offer no times at all.';

/**
 * Whether a week has no bookable time at all: every day empty. A date
 * override still counts as hours, so "closed all week except 24 December"
 * saves. Known soft edge: an override whose date has passed counts too, so a
 * schedule whose only open date was last year still saves and offers nothing.
 * Checking that needs today's date in the schedule's zone, which this pure
 * schema has no business knowing; the slot engine already shows the host an
 * empty calendar, and the empty week was the case worth refusing.
 */
export function hasNoHours(hours: { readonly weekly: Record<string, readonly unknown[]> }): boolean {
  return WEEKDAYS.every((day) => (hours.weekly[day] ?? []).length === 0);
}

/**
 * A schedule's hours as a write sends them (AC-961): the shape a page's hours
 * always had, read in the schedule's zone, every time on a 15 minute step.
 * Hours stored before spec 0035 are read as they are; only a write is held
 * to the step, each range off it named by its path.
 */
export const ScheduleHours = BookingAvailability.superRefine((hours, context) => {
  for (const day of WEEKDAYS) {
    hours.weekly[day].forEach((range, index) => {
      if (!range.every(isQuarterHour)) {
        context.addIssue({ code: 'custom', message: QUARTER_HOUR_MESSAGE, path: ['weekly', day, index] });
      }
    });
  }
  hours.overrides.forEach((override, at) => {
    override.ranges.forEach((range, index) => {
      if (!range.every(isQuarterHour)) {
        context.addIssue({ code: 'custom', message: QUARTER_HOUR_MESSAGE, path: ['overrides', at, 'ranges', index] });
      }
    });
  });
  // An override opens a named date, so a week that is empty every day still books if one of them does.
  if (hasNoHours(hours) && !hours.overrides.some((override) => override.ranges.length > 0)) {
    context.addIssue({ code: 'custom', message: NO_HOURS_AT_ALL, path: ['weekly'] });
  }
});
/** A schedule's hours as a write sends them. */
export type ScheduleHours = z.infer<typeof ScheduleHours>;

/** A booking page that books by a schedule: its id and title, for "Used by". */
export const ScheduleUser = z.object({ id: Uuid, title: z.string() });
/** A page that books by a schedule. */
export type ScheduleUser = z.infer<typeof ScheduleUser>;

/**
 * One schedule as its owner (or an admin) sees it. `id` is null for the
 * virtual default, shown until the member saves any hours (AC-963): it is
 * stored the first time they change it. `pages` are the live pages booking
 * by it: those naming it, and for the default those following the default.
 */
export const ScheduleView = z.object({
  id: Uuid.nullable(),
  memberId: Uuid,
  name: z.string(),
  isDefault: z.boolean(),
  availability: BookingAvailability,
  pages: z.array(ScheduleUser),
  /** The stale check the editor sends back (`STALE`); null for the virtual default. */
  updatedAt: Timestamp.nullable(),
});
/** One schedule. */
export type ScheduleView = z.infer<typeof ScheduleView>;

/** A member's schedules: the default first, then by name (AC-969). */
export const ScheduleList = z.object({
  memberId: Uuid,
  schedules: z.array(ScheduleView),
});
/** A member's schedules. */
export type ScheduleList = z.infer<typeof ScheduleList>;

/** A member's schedules: the caller's own, or another member's with `booking.admin`. */
export const ListSchedulesInput = WorkspaceScoped.extend({
  memberId: Uuid.optional(),
  /** The browser's zone, the virtual default's when the member has saved none. */
  timeZone: TimeZoneName,
});
/** A member's schedules. */
export type ListSchedulesInput = z.infer<typeof ListSchedulesInput>;

/** One schedule: the caller's own, anyone's with `booking.admin`, or one a page they book on uses (AC-971). */
export const GetScheduleInput = WorkspaceScoped.extend({ id: Uuid });
/** One schedule. */
export type GetScheduleInput = z.infer<typeof GetScheduleInput>;

/**
 * A new schedule (AC-964). `id` is a UUID v7 the browser mints, and the retry
 * key. With no `availability` it takes the default's hours and zone (the
 * virtual default's in `timeZone` while none is stored). `isDefault` makes it
 * the default: how the virtual default is saved the first time.
 */
export const CreateScheduleInput = WorkspaceScoped.extend({
  id: uuidV7('The schedule id must be a UUID v7.'),
  memberId: Uuid.optional(),
  name: ScheduleName,
  timeZone: TimeZoneName,
  availability: ScheduleHours.optional(),
  isDefault: z.boolean().optional(),
  mutationId: Uuid,
});
/** A new schedule. */
export type CreateScheduleInput = z.infer<typeof CreateScheduleInput>;

/** A change to a schedule: its name, its hours or both, refused `STALE` when it changed since `updatedAt`. */
export const UpdateScheduleInput = WorkspaceScoped.extend({
  id: Uuid,
  name: ScheduleName.optional(),
  availability: ScheduleHours.optional(),
  updatedAt: Timestamp,
  mutationId: Uuid,
});
/** A change to a schedule. */
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInput>;

/** Makes a schedule its member's default; the old default's mark moves at once (AC-962). */
export const SetDefaultScheduleInput = WorkspaceScoped.extend({ id: Uuid, mutationId: Uuid });
/** Makes a schedule the default. */
export type SetDefaultScheduleInput = z.infer<typeof SetDefaultScheduleInput>;

/** A copy named "<name> copy", with the same hours and overrides (AC-964); `newId` is the retry key. */
export const DuplicateScheduleInput = WorkspaceScoped.extend({
  id: Uuid,
  newId: uuidV7('The schedule id must be a UUID v7.'),
  mutationId: Uuid,
});
/** A copy of a schedule. */
export type DuplicateScheduleInput = z.infer<typeof DuplicateScheduleInput>;

/** Deletes a schedule that isn't the default; the pages naming it follow the default (AC-967). */
export const DeleteScheduleInput = WorkspaceScoped.extend({ id: Uuid, mutationId: Uuid });
/** Deletes a schedule. */
export type DeleteScheduleInput = z.infer<typeof DeleteScheduleInput>;

/** What a delete moved: how many pages now follow the default. */
export const DeleteScheduleResult = z.object({
  id: Uuid,
  repointed: z.object({ pages: z.number().int().min(0) }),
});
/** What a delete moved. */
export type DeleteScheduleResult = z.infer<typeof DeleteScheduleResult>;

/** A member whose schedules the reader may view: the Viewing Select's choices (AC-971). */
export const ScheduleMember = z.object({ id: Uuid, name: z.string() });
/** A member whose schedules the reader may view. */
export type ScheduleMember = z.infer<typeof ScheduleMember>;

/**
 * Whose schedules the reader may view, by name (AC-971): themselves, and with
 * `booking.admin` every active member. One service, so spec 0037's reach
 * replaces `booking.admin` here as in the writes.
 */
export const ScheduleMembers = z.object({ members: z.array(ScheduleMember) });
/** Whose schedules the reader may view. */
export type ScheduleMembers = z.infer<typeof ScheduleMembers>;

/** Member procedures for availability schedules. */
export const schedulesContract = {
  members: oc.input(WorkspaceScoped).output(ScheduleMembers),
  list: oc.input(ListSchedulesInput).output(ScheduleList),
  get: oc.input(GetScheduleInput).output(ScheduleView),
  create: oc.input(CreateScheduleInput).output(ScheduleView),
  update: oc.input(UpdateScheduleInput).output(ScheduleView),
  setDefault: oc.input(SetDefaultScheduleInput).output(ScheduleView),
  duplicate: oc.input(DuplicateScheduleInput).output(ScheduleView),
  delete: oc.input(DeleteScheduleInput).output(DeleteScheduleResult),
};
