// Rotations (spec 0029): a pool of members that round robin booking pages
// share work across fairly. `rotations.*` lists them (any member with
// `booking.manage` sees the ones they're in, their own share only), and makes,
// changes and deletes them (`booking.admin`). `bookings.assignments` says why
// a booking went to its host.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Uuid, uuidV7 } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** How many members a rotation holds (AC-728). */
export const ROTATION_MEMBERS = { min: 2, max: 20 } as const;
/**
 * The most people "Everyone on the roster" (the workspace link's rotation, which follows membership) lists and takes
 * per person settings for in one change. Its members aren't chosen, so the 2 to 20 above doesn't hold for it.
 */
export const ROSTER_MEMBERS_MAX = 200;
/** The windows fairness may count over, in days (AC-728). */
export const ROTATION_WINDOWS = [7, 30, 90] as const;
/** The five priority levels, lowest first (AC-728); 2 is medium, the default. */
export const ROTATION_PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'] as const;

/**
 * How a rotation picks: Fair (fewest in the window for their weight), Priority (highest priority free first), or
 * Even (as Fair, but anyone the gap or more ahead waits until the others catch up; spec 0037, AC-1325).
 */
export const RotationStrategy = z.enum(['fair', 'priority', 'even']);
/** How a rotation picks. */
export type RotationStrategy = z.infer<typeof RotationStrategy>;

/** A rotation's own settings (AC-728). */
export const RotationSettings = z.object({
  name: z.string().trim().min(1, 'Give the rotation a name.').max(80, 'Keep the name to 80 characters.'),
  strategy: RotationStrategy,
  windowDays: z.union(
    ROTATION_WINDOWS.map((days) => z.literal(days)),
    { error: 'Count over 7, 30 or 90 days.' },
  ),
  /** Even's gap, in meetings at equal weights: 1 to 10, 3 by default. */
  evenGap: z.number().int().min(1, 'The gap is 1 to 10 meetings.').max(10, 'The gap is 1 to 10 meetings.'),
  /**
   * Where a returning guest goes (spec 0037, AC-1328): their owner when the owner is in it and free (`owner`, the
   * default), the host they met last (`last_host`), or the rotation as anyone else (`none`).
   */
  returning: z.enum(['owner', 'last_host', 'none']),
});
/** A rotation's own settings. */
export type RotationSettings = z.infer<typeof RotationSettings>;

/** One member as a rotation holds them (AC-728). */
export const RotationMemberInput = z.object({
  memberId: Uuid,
  weight: z.number().int().min(1, 'A weight is 1 to 100.').max(100, 'A weight is 1 to 100.'),
  /** 0 lowest to 4 highest. */
  priority: z.number().int().min(0).max(4),
  /** At most this many of the rotation's bookings on one of their days; null for no cap. */
  dailyCap: z.number().int().min(1, 'A daily cap is 1 to 50.').max(50, 'A daily cap is 1 to 50.').nullable(),
  /** At most this many in one of their weeks, Monday to Sunday (spec 0037, AC-1326); null for no cap. */
  weeklyCap: z.number().int().min(1, 'A weekly cap is 1 to 200.').max(200, 'A weekly cap is 1 to 200.').nullable(),
  isOn: z.boolean(),
});
/** One member as a rotation holds them. */
export type RotationMemberInput = z.infer<typeof RotationMemberInput>;

/** A rotation's members: 2 to 20, each once. */
export const RotationMembersInput = z
  .array(RotationMemberInput)
  .min(ROTATION_MEMBERS.min, `A rotation needs at least ${String(ROTATION_MEMBERS.min)} members.`)
  .max(ROTATION_MEMBERS.max, `A rotation holds at most ${String(ROTATION_MEMBERS.max)} members.`)
  .refine((list) => new Set(list.map((member) => member.memberId)).size === list.length, {
    error: 'Add each member once.',
  });

/** One member of a rotation as Settings shows them. */
export const RotationMemberView = RotationMemberInput.extend({
  name: z.string(),
  /** Their count in the window, calibration and adjustments included (below 0 after a negative adjustment): everyone's for `booking.admin`, else only the reader's own. */
  count: z.number().optional(),
  /** Their upcoming bookings this rotation seats them on (AC-750), shown with `count`. */
  upcoming: z.number().int().min(0).optional(),
  /**
   * They have a calendar connected; without one they are booked from their hours and bookings only (warning). Only
   * for `booking.admin` and about the reader themself: a rotation gives no reads about its members' calendars (spec
   * 0037, AC-1315); the screen asks `calendar.health`, through See reach, instead.
   */
  hasCalendar: z.boolean().optional(),
});
/** One member of a rotation. */
export type RotationMemberView = z.infer<typeof RotationMemberView>;

/** A rotation as Settings shows it. */
export const RotationView = RotationSettings.extend({
  id: Uuid,
  /**
   * `everyone`: "Everyone on the roster", the workspace link's rotation, whose members are every active member who
   * isn't a guest, joining and leaving with the workspace; only their own settings (on or off, weight, priority,
   * caps) change. Absent for a rotation of chosen people.
   */
  follows: z.literal('everyone').optional(),
  members: z.array(RotationMemberView),
  /** How many live booking pages book from it. */
  pages: z.number().int().min(0),
  /** The reader may change it (`booking.admin`). */
  canChange: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
/** A rotation as Settings shows it. */
export type RotationView = z.infer<typeof RotationView>;

/** The rotations the reader may see: all with `booking.admin`, else the ones they're in. */
export const ListRotationsInput = WorkspaceScoped;
/** The rotations read. */
export type ListRotationsInput = z.infer<typeof ListRotationsInput>;

/** A new rotation. `id` is a UUID v7 the browser mints, and the retry key. */
export const CreateRotationInput = WorkspaceScoped.extend({
  id: uuidV7('The rotation id must be a UUID v7.'),
  settings: RotationSettings,
  members: RotationMembersInput,
  mutationId: Uuid,
});
/** A new rotation. */
export type CreateRotationInput = z.infer<typeof CreateRotationInput>;

/**
 * A rotation's members as a change sends them: the whole list for a rotation of chosen people (2 to 20, checked by
 * the server), or the people whose own settings change in "Everyone on the roster" (1 to 200).
 */
export const RotationMembersChange = z
  .array(RotationMemberInput)
  .min(1, 'Name at least one member.')
  .max(ROSTER_MEMBERS_MAX, `Change at most ${String(ROSTER_MEMBERS_MAX)} people at once.`)
  .refine((list) => new Set(list.map((member) => member.memberId)).size === list.length, {
    error: 'Add each member once.',
  });
/** A rotation's members as a change sends them. */
export type RotationMembersChange = z.infer<typeof RotationMembersChange>;

/**
 * A change to a rotation: only the settings given; `members`, when given, replaces the list (AC-757), or, for
 * "Everyone on the roster", sets those people's own settings and leaves everyone else as they are.
 */
export const UpdateRotationInput = WorkspaceScoped.extend({
  rotationId: Uuid,
  settings: RotationSettings.partial(),
  members: RotationMembersChange.optional(),
  mutationId: Uuid,
});
/** A change to a rotation. */
export type UpdateRotationInput = z.infer<typeof UpdateRotationInput>;

/** Deleting a rotation no page books from (AC-758). */
export const DeleteRotationInput = WorkspaceScoped.extend({ rotationId: Uuid, mutationId: Uuid });
/** Deleting a rotation. */
export type DeleteRotationInput = z.infer<typeof DeleteRotationInput>;

/** Why a booking went to its host (AC-742). */
export const AssignmentReason = z.enum([
  'fair',
  'priority',
  'even',
  'owner',
  'last_host',
  'standin',
  'only_free',
  'routed',
  'manual',
  'reassigned',
  'adjustment',
]);
/** Why a booking went to its host. */
export type AssignmentReason = z.infer<typeof AssignmentReason>;

/** One ledger row of a booking, as its detail says it (AC-742). */
export const BookingAssignment = z.object({
  id: Uuid,
  rotationId: Uuid,
  rotationName: z.string(),
  memberId: Uuid,
  memberName: z.string(),
  reason: AssignmentReason,
  /** The host's count then, calibration included, and their weight, when the strategy compared them. */
  count: z.number().min(0).optional(),
  weight: z.number().int().optional(),
  windowDays: z.number().int().optional(),
  assignedAt: Timestamp,
  /** Cancelled or reassigned since: it no longer counts. */
  voidedAt: Timestamp.optional(),
});
/** One ledger row of a booking. */
export type BookingAssignment = z.infer<typeof BookingAssignment>;

/** A booking's assignments, newest first. */
export const BookingAssignmentsInput = WorkspaceScoped.extend({ bookingId: Uuid });
/** A booking's assignments. */
export type BookingAssignmentsInput = z.infer<typeof BookingAssignmentsInput>;

/**
 * Reassigning one seat of an upcoming round robin booking (spec 0029, AC-748; spec 0037, AC-1337): to the named
 * member, or the next in its rotation; the first rotation's seat when `rotationId` is left out.
 */
export const ReassignBookingInput = WorkspaceScoped.extend({
  bookingId: Uuid,
  rotationId: Uuid.optional(),
  memberId: Uuid.optional(),
  mutationId: Uuid,
});
/** Reassigning a booking's seat. */
export type ReassignBookingInput = z.infer<typeof ReassignBookingInput>;

/** What a reassign did: the booking's organiser now, and whether any seat changed. */
export const ReassignedBooking = z.object({ hostMemberId: Uuid, changed: z.boolean() });
/** What a reassign did. */
export type ReassignedBooking = z.infer<typeof ReassignedBooking>;

/** The most a count adjustment moves a member's count, either way (spec 0037, AC-1329). */
export const ADJUSTMENT_MAX = 20;

/**
 * Adjusting a member's count in a rotation (spec 0037, AC-1329): a whole number from -20 to +20, never 0, with a
 * note. A ledger row counted in the window like an assignment; undone by voiding it.
 */
export const AdjustCountInput = WorkspaceScoped.extend({
  rotationId: Uuid,
  memberId: Uuid,
  units: z
    .number()
    .int('Adjust by a whole number.')
    .min(-ADJUSTMENT_MAX, `Adjust by at most ${String(ADJUSTMENT_MAX)} either way.`)
    .max(ADJUSTMENT_MAX, `Adjust by at most ${String(ADJUSTMENT_MAX)} either way.`)
    .refine((units) => units !== 0, { error: 'Adjust by at least 1 either way.' }),
  note: z.string().trim().min(1, 'Say why, in a few words.').max(200, 'Keep the note to 200 characters.'),
  mutationId: Uuid,
});
/** Adjusting a member's count. */
export type AdjustCountInput = z.infer<typeof AdjustCountInput>;

/** Undoing a count adjustment (spec 0037, AC-1329). */
export const UndoAdjustmentInput = WorkspaceScoped.extend({ rotationId: Uuid, adjustmentId: Uuid, mutationId: Uuid });
/** Undoing a count adjustment. */
export type UndoAdjustmentInput = z.infer<typeof UndoAdjustmentInput>;

/** One count adjustment as the Distribution tab lists it. */
export const RotationAdjustment = z.object({
  id: Uuid,
  memberId: Uuid,
  memberName: z.string(),
  units: z.number().int(),
  note: z.string(),
  byName: z.string(),
  at: Timestamp,
  /** Undone since: it no longer counts. */
  voidedAt: Timestamp.optional(),
});
/** One count adjustment. */
export type RotationAdjustment = z.infer<typeof RotationAdjustment>;

/** One member's row on the Distribution tab (spec 0037, AC-1330), over the rotation's window. */
export const DistributionRow = z.object({
  memberId: Uuid,
  name: z.string(),
  weight: z.number().int(),
  isOn: z.boolean(),
  /** Live units in the window, calibration and adjustments included. */
  count: z.number(),
  /** Their share of the window's count by weight, among the members switched on: `booking.admin` only (AC-752). */
  fairShare: z.number().optional(),
  /** `count` less `fairShare`: above zero, ahead of their share. `booking.admin` only. */
  difference: z.number().optional(),
  /** The window's adjustments, summed. */
  adjusted: z.number().int(),
  /** How they got their meetings in the window, by reason. */
  reasons: z.partialRecord(AssignmentReason, z.number().int()),
  /** Meetings each of the last 12 weeks (Monday to Sunday, UTC), oldest first. */
  weeks: z.array(z.number().int()).length(12),
});
/** One member's Distribution row. */
export type DistributionRow = z.infer<typeof DistributionRow>;

/** A rotation's Distribution tab: the window, the rows the reader may see, and the adjustments. */
export const RotationDistribution = z.object({
  rotationId: Uuid,
  windowDays: z.number().int(),
  /** The first day of each of the 12 weeks, `YYYY-MM-DD`, oldest first. */
  weekStarts: z.array(z.string()).length(12),
  rows: z.array(DistributionRow),
  adjustments: z.array(RotationAdjustment),
  /** The reader may adjust counts (`booking.admin`, or the rotation's editors once spec 0037 adds them). */
  canAdjust: z.boolean(),
});
/** A rotation's Distribution tab. */
export type RotationDistribution = z.infer<typeof RotationDistribution>;

/** Reading a rotation's distribution. */
export const RotationDistributionInput = WorkspaceScoped.extend({ rotationId: Uuid });
/** Reading a rotation's distribution. */
export type RotationDistributionInput = z.infer<typeof RotationDistributionInput>;

/** Reassigning every upcoming booking a rotation seats a member on (spec 0029, AC-750). */
export const ReassignUpcomingInput = WorkspaceScoped.extend({ rotationId: Uuid, memberId: Uuid, mutationId: Uuid });
/** Reassigning a member's upcoming bookings in a rotation. */
export type ReassignUpcomingInput = z.infer<typeof ReassignUpcomingInput>;

/**
 * What reassigning a member's upcoming bookings did: how many it queued. Each is flagged "Needs a host" until the
 * worker seats someone else; any nobody can take stays flagged, and the admins are emailed.
 */
export const ReassignedUpcoming = z.object({ queued: z.number().int() });
/** What reassigning a member's upcoming bookings did. */
export type ReassignedUpcoming = z.infer<typeof ReassignedUpcoming>;

/** Member procedures for rotations. */
export const rotationsContract = {
  list: oc.input(ListRotationsInput).output(z.array(RotationView)),
  create: oc.input(CreateRotationInput).output(RotationView),
  update: oc.input(UpdateRotationInput).output(RotationView),
  /** The Distribution tab (spec 0037, AC-1330). */
  distribution: oc.input(RotationDistributionInput).output(RotationDistribution),
  /** Adjusts a member's count with a note (AC-1329). */
  adjust: oc.input(AdjustCountInput).output(RotationAdjustment),
  /** Hands a member's upcoming bookings in the rotation to the others (AC-750). */
  reassignUpcoming: oc.input(ReassignUpcomingInput).output(ReassignedUpcoming),
  /** Undoes an adjustment (AC-1329). */
  undoAdjustment: oc.input(UndoAdjustmentInput).output(RotationAdjustment),
  delete: oc.input(DeleteRotationInput).output(z.object({ rotationId: Uuid })),
};
