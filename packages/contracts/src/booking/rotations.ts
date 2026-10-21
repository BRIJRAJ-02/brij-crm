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
  /** Their count in the window, calibration included: everyone's for `booking.admin`, else only the reader's own. */
  count: z.number().min(0).optional(),
  /** They have a calendar connected; without one they are booked from their hours and bookings only (warning). */
  hasCalendar: z.boolean(),
});
/** One member of a rotation. */
export type RotationMemberView = z.infer<typeof RotationMemberView>;

/** A rotation as Settings shows it. */
export const RotationView = RotationSettings.extend({
  id: Uuid,
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

/** A change to a rotation: only the settings given; `members`, when given, replaces the list (AC-757). */
export const UpdateRotationInput = WorkspaceScoped.extend({
  rotationId: Uuid,
  settings: RotationSettings.partial(),
  members: RotationMembersInput.optional(),
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

/** Member procedures for rotations. */
export const rotationsContract = {
  list: oc.input(ListRotationsInput).output(z.array(RotationView)),
  create: oc.input(CreateRotationInput).output(RotationView),
  update: oc.input(UpdateRotationInput).output(RotationView),
  delete: oc.input(DeleteRotationInput).output(z.object({ rotationId: Uuid })),
};
