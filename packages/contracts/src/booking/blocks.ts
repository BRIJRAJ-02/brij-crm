// Time a member closes on their own calendar (spec 0027): a block closes it on
// every page that books them, a hold on every page but a private one. Drawn on
// Bookings › Calendar as a date and local minutes in the member's zone; the
// server turns them into instants once.
import * as z from 'zod';
import { DateValue, Timestamp } from '../values/attribute-values.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { TimeZoneName } from './settings.ts';

/** `block` closes the time on every page; `hold` on every page but a private one. */
export const TimeBlockKind = z.enum(['block', 'hold']);
/** A block's kind. */
export type TimeBlockKind = z.infer<typeof TimeBlockKind>;

/** `once` is the one span drawn; `weekly` repeats it on that weekday from that date on. A hold is always `once`. */
export const TimeBlockRepeat = z.enum(['once', 'weekly']);
/** How a block repeats. */
export type TimeBlockRepeat = z.infer<typeof TimeBlockRepeat>;

/** Why the time is closed, which only the member sees. */
export const TimeBlockLabel = z.string().trim().max(200, 'Keep the reason to 200 characters.');

/** The shortest and longest span a block may close, in minutes. */
export const TIME_BLOCK_MINUTES = { min: 5, max: 1440 } as const;

/**
 * Closes a span on the caller's own calendar: `date` and minutes from its
 * local midnight in `timeZone` (1440 is the next midnight).
 */
export const CreateTimeBlockInput = WorkspaceScoped.extend({
  kind: TimeBlockKind,
  repeat: TimeBlockRepeat,
  date: DateValue,
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  timeZone: TimeZoneName,
  label: TimeBlockLabel.optional(),
  /** A hold for one private page; absent holds for any private page. */
  pageId: z.uuid().optional(),
  mutationId: z.uuid(),
})
  .refine(({ startMinute, endMinute }) => endMinute - startMinute >= TIME_BLOCK_MINUTES.min, {
    error: 'The end time has to be after the start time.',
    path: ['endMinute'],
  })
  .refine(({ kind, repeat }) => kind === 'block' || repeat === 'once', {
    error: 'A hold is one span on one date.',
    path: ['repeat'],
  })
  .refine(({ kind, pageId }) => kind === 'hold' || pageId === undefined, {
    error: 'Only a hold names a page.',
    path: ['pageId'],
  });
/** Closes a span on the caller's own calendar. */
export type CreateTimeBlockInput = z.infer<typeof CreateTimeBlockInput>;

/** Reopens the time one of the caller's blocks closed: a weekly block stops every week. */
export const RemoveTimeBlockInput = WorkspaceScoped.extend({ id: z.uuid(), mutationId: z.uuid() });
/** Reopens a block's time. */
export type RemoveTimeBlockInput = z.infer<typeof RemoveTimeBlockInput>;

/** A block as its member sees it. */
export const TimeBlockView = z.object({
  id: z.uuid(),
  kind: TimeBlockKind,
  repeat: TimeBlockRepeat,
  label: z.string().optional(),
  pageId: z.uuid().optional(),
  /** A `once` block's span. */
  startsAt: Timestamp.optional(),
  endsAt: Timestamp.optional(),
  /** A `weekly` block's weekday (0 Sunday to 6 Saturday), local minutes, zone and first date. */
  weekday: z.number().int().min(0).max(6).optional(),
  startMinute: z.number().int().optional(),
  endMinute: z.number().int().optional(),
  timeZone: z.string().optional(),
  fromDate: DateValue.optional(),
});
/** A block as its member sees it. */
export type TimeBlockView = z.infer<typeof TimeBlockView>;

/** One time a block closes inside a calendar read: a once block's span, or one week's turn of a weekly block. */
export const TimeBlockOccurrence = z.object({
  /** The block's id plus, for a weekly block, its date: unique within a read. */
  key: z.string(),
  blockId: z.uuid(),
  kind: TimeBlockKind,
  repeat: TimeBlockRepeat,
  label: z.string().optional(),
  startsAt: Timestamp,
  endsAt: Timestamp,
});
/** One time a block closes inside a calendar read. */
export type TimeBlockOccurrence = z.infer<typeof TimeBlockOccurrence>;
