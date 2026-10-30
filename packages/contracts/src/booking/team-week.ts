// The Team week (spec 0037, job J6, AC-1289 to AC-1296): the roster, done on spec 0035's own data. People down the
// side, the days of one dated week across, each cell that day's hours from the member's default schedule: its date
// override when it has one ("this week only"), else its weekly hours; Away from time off. A cell's change writes a date
// override through the one schedule write path, so the roster has no table of its own.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { DateValue, Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { isQuarterHour } from './schedules.ts';
import { DayRanges, TimeRange, WEEKDAYS } from './settings.ts';
import { TimeOffReason } from './time-off.ts';
import { isMonday, TEAM_WEEK } from './roster.ts';

export { footerOf, isMonday, mergedMinutes, mondayOf, plusDays, TEAM_WEEK, weekDates } from './roster.ts';

const NOT_A_MONDAY = 'Pick a week by its Monday.';

/** A week, named by its Monday. */
export const MondayDate = DateValue.refine(isMonday, { error: NOT_A_MONDAY });
/** A week, named by its Monday. */
export type MondayDate = z.infer<typeof MondayDate>;

const QUARTER_HOUR_MESSAGE = 'Use times on the quarter hour, such as 09:15.';

/** One day's ranges as a Team week write sends them: at most 6, none overlapping, each on a 15 minute step. */
export const RosterRanges = DayRanges.refine((ranges) => ranges.every((range) => range.every(isQuarterHour)), {
  error: QUARTER_HOUR_MESSAGE,
});
/** One day's ranges as a Team week write sends them. */
export type RosterRanges = z.infer<typeof RosterRanges>;

/** Where a cell's hours come from: the weekly hours, or that date's override ("this week only"). */
export const TeamWeekSource = z.enum(['usual', 'override']);
/** Where a cell's hours come from. */
export type TeamWeekSource = z.infer<typeof TeamWeekSource>;

/**
 * One cell: that day's hours (local times in the member's schedule zone), where they come from, and `away` when time
 * off covers the day. The reason and the note only for the member and for Manage over them (AC-1286); See reads Away.
 */
export const TeamWeekDay = z.object({
  date: DateValue,
  ranges: z.array(TimeRange),
  source: TeamWeekSource,
  /** The weekly hours for that weekday: what "Usual hours" puts back. */
  usual: z.array(TimeRange),
  away: z.object({ reason: TimeOffReason.optional(), note: z.string().optional() }).optional(),
});
/** One cell. */
export type TeamWeekDay = z.infer<typeof TeamWeekDay>;

/**
 * One member's row: their name, the zone their default schedule keeps and its offset from UTC on that week's Monday,
 * the seven days Monday first, their merged working minutes (Away days left out), how many of their pages book by
 * another schedule (AC-1295), whether the reader may change their hours, and the default schedule a write is checked
 * against (`id` null and `updatedAt` null while they never saved hours: the first write stores it, AC-963).
 */
export const TeamWeekRow = z.object({
  memberId: Uuid,
  name: z.string(),
  timeZone: z.string(),
  offsetMinutes: z.number().int(),
  days: z.array(TeamWeekDay).length(7),
  weekMinutes: z.number().int().min(0),
  otherSchedules: z.number().int().min(0),
  canChange: z.boolean(),
  schedule: z.object({ id: Uuid.nullable(), updatedAt: Timestamp.nullable() }),
  /** Whether the workspace link can book them (in its pool and switched on); set only while the workspace has one. */
  inLink: z.boolean().optional(),
});
/** One member's row. */
export type TeamWeekRow = z.infer<typeof TeamWeekRow>;

/** The footer's day (AC-1294): how many of the page's rows work that day, and their merged minutes added up. */
export const TeamWeekTotal = z.object({
  date: DateValue,
  working: z.number().int().min(0),
  minutes: z.number().int().min(0),
  /** Of those working, how many the workspace link can book; only while the workspace has one. */
  linked: z.number().int().min(0).optional(),
});
/** The footer's day. */
export type TeamWeekTotal = z.infer<typeof TeamWeekTotal>;

/**
 * A week of the roster (AC-1289): the rows of one page (the reader first on the first page, then by name), the
 * footer over them, the next page's cursor, and the reach of the stepper: `thisWeek` (the first week a cell may be
 * changed in; earlier ones are read only), `earliest` and `latest`.
 */
export const TeamWeek = z.object({
  weekStart: DateValue,
  thisWeek: DateValue,
  earliest: DateValue,
  latest: DateValue,
  rows: z.array(TeamWeekRow),
  footer: z.array(TeamWeekTotal).length(7),
  /**
   * The workspace booking link whose coverage the footer counts (the brief's decision 3): the workspace's first one,
   * a live one before a paused one, then the oldest. Absent when the workspace has none.
   */
  link: z.object({ pageId: Uuid, title: z.string() }).optional(),
  nextCursor: z.string().optional(),
});
/** A week of the roster. */
export type TeamWeek = z.infer<typeof TeamWeek>;

/** `availability.teamWeek`: one week, by its Monday, searched by name, a page at a time. */
export const TeamWeekInput = WorkspaceScoped.extend({
  weekStart: MondayDate,
  search: z.string().trim().max(100, { error: 'Keep the search to 100 characters.' }).optional(),
  cursor: z.string().max(400).optional(),
});
/** `availability.teamWeek`'s input. */
export type TeamWeekInput = z.infer<typeof TeamWeekInput>;

/** What one day becomes: its own ranges ("this week only"), Off (an override with none), or back to usual hours. */
export const DayHours = z.union([RosterRanges, z.literal('off'), z.literal('usual')]);
/** What one day becomes. */
export type DayHours = z.infer<typeof DayHours>;

/**
 * `availability.setDay` (AC-1291): one date's hours on the member's default schedule, checked against the schedule's
 * `updatedAt` as the reader saw it (null while it was never stored), so a save never overwrites another's unseen.
 */
export const SetDayInput = WorkspaceScoped.extend({
  memberId: Uuid,
  date: DateValue,
  hours: DayHours,
  updatedAt: Timestamp.nullable(),
  mutationId: Uuid,
});
/** `availability.setDay`'s input. */
export type SetDayInput = z.infer<typeof SetDayInput>;

/** What a day's write answers: the day as it is now, and the schedule's new version. */
export const SetDayResult = z.object({
  day: TeamWeekDay,
  schedule: z.object({ id: Uuid, updatedAt: Timestamp }),
});
/** What a day's write answers. */
export type SetDayResult = z.infer<typeof SetDayResult>;

const MembersToChange = z
  .array(Uuid)
  .min(1, { error: 'Pick at least one person.' })
  .max(TEAM_WEEK.bulkMax, { error: 'Pick at most 50 people at once.' })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Name each person once.' });

/**
 * `availability.copyWeek` (AC-1292): the days of one week onto another for each member: a day with an override copies
 * it, a day on usual hours removes the other week's override. One audited write per member.
 */
export const CopyWeekInput = WorkspaceScoped.extend({
  memberIds: MembersToChange,
  fromWeekStart: MondayDate,
  toWeekStart: MondayDate,
  mutationId: Uuid,
}).refine((input) => input.fromWeekStart !== input.toWeekStart, {
  error: 'Pick another week to copy to.',
  path: ['toWeekStart'],
});
/** `availability.copyWeek`'s input. */
export type CopyWeekInput = z.infer<typeof CopyWeekInput>;

/** A week of hours, Monday first, each day's ranges on a 15 minute step. */
export const WeeklyHours = z
  .object({
    mon: RosterRanges,
    tue: RosterRanges,
    wed: RosterRanges,
    thu: RosterRanges,
    fri: RosterRanges,
    sat: RosterRanges,
    sun: RosterRanges,
  })
  .refine((weekly) => WEEKDAYS.some((day) => weekly[day].length > 0), {
    error: 'Open at least one time on one day.',
  });
/** A week of hours. */
export type WeeklyHours = z.infer<typeof WeeklyHours>;

/**
 * `availability.setUsualHours` (AC-1292): one week of usual hours onto each member's default schedule (their own zone
 * kept, their date overrides kept). One audited write per member.
 */
export const SetUsualHoursInput = WorkspaceScoped.extend({
  memberIds: MembersToChange,
  weekly: WeeklyHours,
  mutationId: Uuid,
});
/** `availability.setUsualHours`'s input. */
export type SetUsualHoursInput = z.infer<typeof SetUsualHoursInput>;

/** How many members a bulk write changed (one that was already so isn't counted). */
export const BulkHoursResult = z.object({ changed: z.number().int().min(0) });
/** How many members a bulk write changed. */
export type BulkHoursResult = z.infer<typeof BulkHoursResult>;

/** The Team week's procedures. */
export const availabilityContract = {
  teamWeek: oc.input(TeamWeekInput).output(TeamWeek),
  setDay: oc.input(SetDayInput).output(SetDayResult),
  copyWeek: oc.input(CopyWeekInput).output(BulkHoursResult),
  setUsualHours: oc.input(SetUsualHoursInput).output(BulkHoursResult),
};
