// Time off (spec 0037, AC-1281 to AC-1288): a member's whole days away, with a reason, an optional note and an
// optional stand in. Stored as an `away` block, so every page stops offering them and rotations skip them; nothing
// already booked moves by itself, the bookings inside are listed back instead. The dates are calendar dates in the
// member's default schedule's zone at save, kept with the entry.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { DateValue, Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** Why someone is away (AC-1281). */
export const TimeOffReason = z.enum(['vacation', 'sick', 'travel', 'holiday', 'other']);
/** Why someone is away. */
export type TimeOffReason = z.infer<typeof TimeOffReason>;

/** Time off's numbers (spec 0037's Numbers): days in one entry, upcoming entries per member, a note's length. */
export const TIME_OFF_LIMITS = { days: 366, upcoming: 50, note: 200, past: 20 } as const;

/** The days from `from` to `to`, both counted (calendar dates, no zone). */
export function timeOffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const TimeOffNote = z.string().trim().max(TIME_OFF_LIMITS.note, { error: 'Keep the note to 200 characters.' });

/** The fields an entry is drawn with, checked the same way on create and change. */
const TimeOffFields = {
  fromDate: DateValue,
  toDate: DateValue,
  reason: TimeOffReason,
  note: TimeOffNote.optional(),
  /** Who covers: an active member other than them (AC-1281). Absent: nobody. */
  standinMemberId: Uuid.optional(),
};

const datesInOrder = {
  check: ({ fromDate, toDate }: { readonly fromDate: string; readonly toDate: string }) => toDate >= fromDate,
  issue: { error: 'The last day can’t be before the first.', path: ['toDate'] },
};
const notTooLong = {
  check: ({ fromDate, toDate }: { readonly fromDate: string; readonly toDate: string }) =>
    timeOffDays(fromDate, toDate) <= TIME_OFF_LIMITS.days,
  issue: { error: 'Time off is at most 366 days. Add another entry for more.', path: ['toDate'] },
};

/** `timeOff.create`: whole days away for the caller, or (`memberId`) a colleague they Manage. */
export const CreateTimeOffInput = WorkspaceScoped.extend({
  /** Minted by the client once per dialog: a retry gives back the entry the first made. */
  id: Uuid,
  memberId: Uuid.optional(),
  ...TimeOffFields,
  mutationId: Uuid,
})
  .refine(datesInOrder.check, datesInOrder.issue)
  .refine(notTooLong.check, notTooLong.issue);
/** `timeOff.create`'s input. */
export type CreateTimeOffInput = z.infer<typeof CreateTimeOffInput>;

/** `timeOff.update`: an entry's dates, reason, note and stand in, all given, checked against `updatedAt`. */
export const UpdateTimeOffInput = WorkspaceScoped.extend({
  id: Uuid,
  ...TimeOffFields,
  updatedAt: Timestamp,
  mutationId: Uuid,
})
  .refine(datesInOrder.check, datesInOrder.issue)
  .refine(notTooLong.check, notTooLong.issue);
/** `timeOff.update`'s input. */
export type UpdateTimeOffInput = z.infer<typeof UpdateTimeOffInput>;

/** `timeOff.delete`. */
export const DeleteTimeOffInput = WorkspaceScoped.extend({ id: Uuid, mutationId: Uuid });
/** `timeOff.delete`'s input. */
export type DeleteTimeOffInput = z.infer<typeof DeleteTimeOffInput>;

/** `timeOff.list`: the caller's own, or (`memberId`) a colleague's in their See reach. */
export const ListTimeOffInput = WorkspaceScoped.extend({ memberId: Uuid.optional() });
/** `timeOff.list`'s input. */
export type ListTimeOffInput = z.infer<typeof ListTimeOffInput>;

/**
 * One entry as a screen shows it. `reason`, `note` and `standinMemberId` are there only for the member and for
 * Manage over them (AC-1286): See reads "Away" and the dates alone.
 */
export const TimeOffEntry = z.object({
  id: Uuid,
  memberId: Uuid,
  fromDate: DateValue,
  toDate: DateValue,
  /** The zone the dates were chosen in (the member's default schedule's, at save). */
  timeZone: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  reason: TimeOffReason.optional(),
  note: z.string().optional(),
  standinMemberId: Uuid.optional(),
  updatedAt: Timestamp,
  /** Who last changed it, when that wasn't the member ("Changed by", AC-1265). */
  changedBy: z.object({ memberId: Uuid, at: Timestamp }).optional(),
});
/** One time off entry. */
export type TimeOffEntry = z.infer<typeof TimeOffEntry>;

/** A member's time off: upcoming (not yet ended) soonest first, then the last 20 past ones, latest first. */
export const TimeOffList = z.object({
  memberId: Uuid,
  upcoming: z.array(TimeOffEntry),
  past: z.array(TimeOffEntry),
  /** Whether the reader may add, change and remove it (themself with `booking.manage`, or Manage over them). */
  canManage: z.boolean(),
});
/** A member's time off. */
export type TimeOffList = z.infer<typeof TimeOffList>;

/** A confirmed meeting the member hosts inside saved time off (AC-1285): flagged Host away, never moved. */
export const TimeOffBooking = z.object({
  id: Uuid,
  visitorName: z.string(),
  pageTitle: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp,
});
/** A meeting inside time off. */
export type TimeOffBooking = z.infer<typeof TimeOffBooking>;

/** A saved entry, and the meetings already booked inside it (at most 50, soonest first). */
export const TimeOffSaved = z.object({
  entry: TimeOffEntry,
  bookingsInside: z.array(TimeOffBooking),
  /** Meetings inside past the ones listed. */
  moreInside: z.number().int().min(0),
});
/** A saved entry and the meetings inside it. */
export type TimeOffSaved = z.infer<typeof TimeOffSaved>;

/**
 * The time off namespace (spec 0037's Services). `list`: self, or See over the member (404 outside it). `create`,
 * `update`, `delete`: self with `booking.manage`, or Manage over the member (403 for See, 404 outside it); 409
 * `TIME_OFF_LIMIT` past 50 upcoming entries, 409 `STALE` for a changed entry, 422 `CONFIG_INVALID` for a stand in
 * who can't cover.
 */
export const timeOffContract = {
  list: oc.input(ListTimeOffInput).output(TimeOffList),
  create: oc.input(CreateTimeOffInput).output(TimeOffSaved),
  update: oc.input(UpdateTimeOffInput).output(TimeOffSaved),
  delete: oc.input(DeleteTimeOffInput).output(z.object({ id: Uuid })),
};
