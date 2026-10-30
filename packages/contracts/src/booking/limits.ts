// Meeting limits (spec 0037, AC-1297 to AC-1299): at most N meetings a day and N a week for one member, across every
// page they host, so a person in three rotations isn't booked three times over. Each limit is optional. Days and
// weeks are counted in the member's default schedule's zone, weeks from Monday; confirmed bookings they host count,
// cancelled ones don't. At a limit every page stops offering them for that day or week.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** Meeting limits' ranges (spec 0037's Numbers): 1 to 50 a day, 1 to 200 a week. */
export const MEETING_LIMITS = { perDay: { min: 1, max: 50 }, perWeek: { min: 1, max: 200 } } as const;

const PerDay = z
  .number()
  .int({ error: 'Use a whole number of meetings.' })
  .min(MEETING_LIMITS.perDay.min, { error: 'Use 1 to 50 meetings a day.' })
  .max(MEETING_LIMITS.perDay.max, { error: 'Use 1 to 50 meetings a day.' });
const PerWeek = z
  .number()
  .int({ error: 'Use a whole number of meetings.' })
  .min(MEETING_LIMITS.perWeek.min, { error: 'Use 1 to 200 meetings a week.' })
  .max(MEETING_LIMITS.perWeek.max, { error: 'Use 1 to 200 meetings a week.' });

/** `limits.get`: the caller's own, or (`memberId`) a colleague's in their See reach. */
export const GetLimitsInput = WorkspaceScoped.extend({ memberId: Uuid.optional() });
/** `limits.get`'s input. */
export type GetLimitsInput = z.infer<typeof GetLimitsInput>;

/**
 * `limits.set`: both limits as they should be (absent is no limit), for the caller (with `availability.own`) or
 * (`memberId`) a colleague they Manage. Last write wins.
 */
export const SetLimitsInput = WorkspaceScoped.extend({
  memberId: Uuid.optional(),
  perDay: PerDay.optional(),
  perWeek: PerWeek.optional(),
  mutationId: Uuid,
});
/** `limits.set`'s input. */
export type SetLimitsInput = z.infer<typeof SetLimitsInput>;

/** A member's meeting limits and this day's and week's counts, as Availability's Limits section shows them. */
export const MeetingLimits = z.object({
  memberId: Uuid,
  /** At most this many meetings a day; absent is no limit. */
  perDay: PerDay.optional(),
  /** At most this many meetings a week (Monday to Sunday); absent is no limit. */
  perWeek: PerWeek.optional(),
  /** Confirmed meetings they host today, in `timeZone`. */
  today: z.number().int().min(0),
  /** Confirmed meetings they host this week (from Monday), in `timeZone`. */
  thisWeek: z.number().int().min(0),
  /** The zone days and weeks are counted in: their default schedule's. */
  timeZone: z.string(),
  /** Whether the reader may change them: themself with `availability.own`, or Manage over their hours. */
  canChange: z.boolean(),
  /** Who last changed them, when that wasn't the member ("Changed by", AC-1265). */
  changedBy: z.object({ memberId: Uuid, at: Timestamp }).optional(),
});
/** A member's meeting limits. */
export type MeetingLimits = z.infer<typeof MeetingLimits>;

/**
 * The limits namespace (spec 0037's Services). `get`: self, or See over the member (404 outside it). `set`: self
 * with `availability.own`, or Manage over the member's hours (403 for See, 404 outside it); 422 for a number out of
 * range.
 */
export const limitsContract = {
  get: oc.input(GetLimitsInput).output(MeetingLimits),
  set: oc.input(SetLimitsInput).output(MeetingLimits),
};
