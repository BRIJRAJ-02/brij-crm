// Bulk actions (spec 0022): deleting many records of one object at once, and
// undoing a delete by its batch. Milestone 1 is inline only, up to 500
// records; bigger selections wait for background jobs (milestone 3).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiRefusal } from './errors.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most records one inline bulk call changes; more is refused 422 `CONFIG_INVALID`. */
export const BULK_INLINE_MAX = 500;

/** The most records a selection holds one by one (spec 0022, AC-523). */
export const BULK_IDS_MAX = 10_000;

/** What a bulk change of more than 500 records says until background jobs take it (spec 0022, milestones 1 and 2). */
export const BULK_TOO_MANY_MESSAGE = 'Changes to more than 500 records arrive soon.';

/**
 * Moves up to 500 records of one object to the trash in one write.
 * `batchId` is a uuid v7 the browser mints: every record deleted carries it,
 * so a retry with the same batch changes nothing and an undo restores exactly
 * that batch (`records.restoreBatch`).
 */
export const DeleteManyInput = WorkspaceScoped.extend({
  objectId: z.uuid(),
  // Twice the cap, so a selection a little over it answers the engine's CONFIG_INVALID, and junk stops at parsing.
  recordIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one record.')
    .max(BULK_INLINE_MAX * 2, BULK_TOO_MANY_MESSAGE),
  batchId: z.uuid({ version: 'v7', message: 'The batch id must be a UUID v7.' }),
  mutationId: z.uuid(),
});
/** Records to move to the trash. */
export type DeleteManyInput = z.infer<typeof DeleteManyInput>;

/**
 * One record's outcome in a bulk delete: `deleted` (by this call, or an
 * earlier try of it), `already-deleted` by another delete (`RECORD_DELETED`),
 * or `refused` (`NOT_FOUND`: unknown, of another object, or hidden).
 */
export const DeleteOutcome = z.object({
  recordId: z.uuid(),
  state: z.enum(['deleted', 'already-deleted', 'refused']),
  refusal: ApiRefusal.optional(),
});
/** One record's outcome in a bulk delete. */
export type DeleteOutcome = z.infer<typeof DeleteOutcome>;

/** A bulk delete's outcomes, one per record asked, and how many change events carry its `mutationId`. */
export const DeleteManyResults = z.object({
  results: z.array(DeleteOutcome),
  echoes: z.number().int().min(0),
});
/** A bulk delete's outcomes. */
export type DeleteManyResults = z.infer<typeof DeleteManyResults>;

/** Undoes a delete: restores the records still in the trash with its batch id. */
export const RestoreBatchInput = WorkspaceScoped.extend({
  batchId: z.uuid(),
  mutationId: z.uuid(),
});
/** A delete to undo. */
export type RestoreBatchInput = z.infer<typeof RestoreBatchInput>;

/**
 * One record's outcome in a restore: `restored`, `live` already (a retry, or
 * restored elsewhere), or `refused` with why (`UNIQUE_CONFLICT`,
 * `LIMIT_REACHED`, `FORBIDDEN` on an object the member may only read,
 * `NOT_FOUND` past the 30 days or gone).
 */
export const RestoreOutcome = z.object({
  recordId: z.uuid(),
  state: z.enum(['restored', 'live', 'refused']),
  /** The record's object, on a record restored or live (one the member may see): its tables read again. */
  objectId: z.uuid().optional(),
  refusal: ApiRefusal.optional(),
});
/** One record's outcome in a restore. */
export type RestoreOutcome = z.infer<typeof RestoreOutcome>;

/** A restore's outcomes, one per record, and how many change events carry its `mutationId`. */
export const RestoreResults = z.object({
  results: z.array(RestoreOutcome),
  echoes: z.number().int().min(0),
});
/** A restore's outcomes. */
export type RestoreResults = z.infer<typeof RestoreResults>;

/**
 * An undone delete: restored inline (milestone 3 adds `{ mode: 'job' }` for a
 * batch past 500, which only a delete job makes).
 */
export const RestoreBatchResults = RestoreResults.extend({ mode: z.literal('inline') });
/** An undone delete's outcomes. */
export type RestoreBatchResults = z.infer<typeof RestoreBatchResults>;

/**
 * Bulk record actions, joined into the `records` namespace. `deleteMany`
 * answers 200 with each record's outcome; 403 `FORBIDDEN` when the member
 * may only read the object (nothing deleted), 422 `CONFIG_INVALID` over 500.
 * `restoreBatch` answers each record of the batch it restored or refused, 404
 * `NOT_FOUND` when none is left in the trash.
 */
export const bulkRecordsContract = {
  deleteMany: oc.input(DeleteManyInput).output(DeleteManyResults),
  restoreBatch: oc.input(RestoreBatchInput).output(RestoreBatchResults),
};
