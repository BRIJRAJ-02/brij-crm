// Home's two reads of its own (spec 0041): Team today, each member's
// meetings in the reader's day, and the metrics row, this week against last.
// Every other card on Home reads what the data layer already has.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The longest day Team today reads: 48 hours, so any time zone's day (23 to 25 hours) fits. */
export const TEAM_TODAY_MAX_HOURS = 48;

/** The most members Team today answers, in id order: a larger team reads the Team calendar instead. */
export const TEAM_TODAY_MEMBERS_MAX = 100;

/** The most meetings one member's row carries. */
export const TEAM_TODAY_ITEMS_MAX = 40;

/** The reader's day: midnight to midnight on their clock, as UTC timestamps. */
export const TeamTodayInput = WorkspaceScoped.extend({ from: Timestamp, to: Timestamp }).refine(
  ({ from, to }) => {
    const span = Date.parse(to) - Date.parse(from);
    return span > 0 && span <= TEAM_TODAY_MAX_HOURS * 3_600_000;
  },
  { error: `Ask for a range of at most ${String(TEAM_TODAY_MAX_HOURS)} hours.`, path: ['to'] },
);
/** The reader's day. */
export type TeamTodayInput = z.infer<typeof TeamTodayInput>;

/**
 * One span a member is taken: a booking they host, a meeting from one of
 * their connected calendars, or busy time with nobody else invited. `title`
 * is present only when the reader may see it: their own, a booking the
 * reader may see, or a meeting whose every holding calendar of that member
 * shows Full details to teammates and that isn't private. Anything else is
 * Busy, by its time alone.
 */
export const TeamTodayItem = z.object({
  id: z.string(),
  kind: z.enum(['booking', 'meeting', 'busy']),
  title: z.string().optional(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  allDay: z.boolean(),
});
/** One span a member is taken. */
export type TeamTodayItem = z.infer<typeof TeamTodayItem>;

/** One member's day, by start. */
export const TeamTodayMember = z.object({
  memberId: Uuid,
  items: z.array(TeamTodayItem),
  /** On time off during the day (spec 0037, AC-1287): the column's status reads "Away". Never the reason. */
  away: z.boolean().optional(),
});
/** One member's day. */
export type TeamTodayMember = z.infer<typeof TeamTodayMember>;

/** Every active member's day (at most `TEAM_TODAY_MEMBERS_MAX`), the reader first. */
export const TeamTodayView = z.object({ members: z.array(TeamTodayMember) });
/** Every active member's day. */
export type TeamTodayView = z.infer<typeof TeamTodayView>;

/** The start of the reader's week (their Monday's midnight), as a UTC timestamp: at most 8 days ago. */
export const HomeMetricsInput = WorkspaceScoped.extend({ weekStart: Timestamp });
/** The start of the reader's week. */
export type HomeMetricsInput = z.infer<typeof HomeMetricsInput>;

/** A count this week so far, and over all of last week. */
export const WeekCount = z.object({ thisWeek: z.number().int().min(0), lastWeek: z.number().int().min(0) });
/** A count this week and last. */
export type WeekCount = z.infer<typeof WeekCount>;

/**
 * Won deals' value this week and last, in the Value attribute's currency
 * (decimal text). Deals in other currencies are never added in: `others`
 * says some were left out.
 */
export const WeekMoney = z.object({
  currency: z.string(),
  thisWeek: z.string(),
  lastWeek: z.string(),
  others: z.boolean(),
});
/** Won deals' value this week and last. */
export type WeekMoney = z.infer<typeof WeekMoney>;

/**
 * Home's metrics row. A tile the reader may not see is absent, never zero:
 * People and Deals need the object at read with no record rule, the won
 * value its Stage and Value fields too, and submissions `forms.manage`.
 * Meetings booked counts confirmed bookings starting in each week: everyone's
 * with `booking.admin`, else the ones the reader hosts (`booking.manage`).
 */
export const HomeMetricsView = z.object({
  meetings: WeekCount.optional(),
  people: WeekCount.optional(),
  deals: WeekCount.optional(),
  won: WeekMoney.optional(),
  submissions: WeekCount.optional(),
});
/** Home's metrics row. */
export type HomeMetricsView = z.infer<typeof HomeMetricsView>;

/** Home's procedures. */
export const homeContract = {
  /** Team today: every member's meetings in the reader's day, titles only where the reader may see them. */
  teamToday: oc.input(TeamTodayInput).output(TeamTodayView),
  /** The metrics row: this week so far against all of last week. */
  metrics: oc.input(HomeMetricsInput).output(HomeMetricsView),
};
