// Bulk actions (spec 0022): deleting or editing many records of one object at
// once, and undoing a delete by its batch. Up to 500 records go inline in one
// write; bigger selections run as background jobs.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BULK_OPS } from './bulk-ops.ts';
import { ApiRefusal } from './errors.ts';
import { JobView } from './jobs.ts';
import { FilterGroup } from './values/filters.ts';
import { RecordView } from './records.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

/** The most records one inline bulk call changes; more is refused 422 `CONFIG_INVALID`. */
export const BULK_INLINE_MAX = 500;

/** The most records a selection holds one by one (spec 0022, AC-523). */
export const BULK_IDS_MAX = 10_000;

/** The most records "all matching" may leave out (spec 0022, AC-523). */
export const BULK_EXCEPT_MAX = 1_000;

/** What an inline bulk call of more than 500 records answers: bigger changes start a job (`records.startBulk`). */
export const BULK_TOO_MANY_MESSAGE = 'Change at most 500 records in one request; more run as a background change.';

/**
 * Moves up to 500 records of one object to the trash in one write.
 * `batchId` is a uuid v7 the browser mints: every record deleted carries it,
 * so a retry with the same batch changes nothing and an undo restores exactly
 * that batch (`records.restoreBatch`).
 */
export const DeleteManyInput = WorkspaceScoped.extend({
  objectId: Uuid,
  // Twice the cap, so a selection a little over it answers the engine's CONFIG_INVALID, and junk stops at parsing.
  recordIds: z
    .array(Uuid)
    .min(1, 'Choose at least one record.')
    .max(BULK_INLINE_MAX * 2, BULK_TOO_MANY_MESSAGE),
  batchId: uuidV7('The batch id must be a UUID v7.'),
  mutationId: Uuid,
  /**
   * Only records nothing live links to (spec 0059, a filed company taken
   * back): one that something links to stays, refused `IN_USE`.
   */
  unlinkedOnly: z.boolean().optional(),
});
/** Records to move to the trash. */
export type DeleteManyInput = z.infer<typeof DeleteManyInput>;

/**
 * One record's outcome in a bulk delete: `deleted` (by this call, or an
 * earlier try of it), `already-deleted` by another delete (`RECORD_DELETED`),
 * or `refused` (`NOT_FOUND`: unknown, of another object, or hidden; `IN_USE`:
 * linked, with `unlinkedOnly`).
 */
export const DeleteOutcome = z.object({
  recordId: Uuid,
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

/**
 * Undoes a delete: restores the records still in the trash with its batch
 * id; past 500 (only a delete job makes such a batch) it starts a restore job
 * with `jobId`, the browser's uuid v7, so a retry starts nothing twice.
 */
export const RestoreBatchInput = WorkspaceScoped.extend({
  batchId: Uuid,
  jobId: uuidV7('The job id must be a UUID v7.').optional(),
  mutationId: Uuid,
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
  recordId: Uuid,
  state: z.enum(['restored', 'live', 'refused']),
  /** The record's object, on a record restored or live (one the member may see): its tables read again. */
  objectId: Uuid.optional(),
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
 * An undone delete: restored inline, or (a batch past 500, which only a
 * delete job makes) a restore job started, with no confirm (spec 0022).
 */
export const RestoreBatchResults = z.union([
  RestoreResults.extend({ mode: z.literal('inline') }),
  z.object({ mode: z.literal('job'), job: JobView, echoes: z.number().int().min(0) }),
]);
/** An undone delete's outcomes. */
export type RestoreBatchResults = z.infer<typeof RestoreBatchResults>;

/** One bulk edit operation (AC-529): Set or Clear a single value; Add, Remove, Replace or Clear a list. */
export const BulkOpName = z.enum(BULK_OPS);

/**
 * What a bulk edit changes (AC-529): one attribute, the operation, and the
 * value (absent for Clear), checked by the attribute type's schema on the
 * server. Strict, as a job's params hold it.
 */
export const BulkEdit = z.strictObject({
  attributeId: Uuid,
  op: BulkOpName,
  value: z.unknown().optional(),
});
/** What a bulk edit changes. */
export type BulkEdit = z.infer<typeof BulkEdit>;

/**
 * Edits one attribute of up to 500 records of one object in one write
 * (AC-530): each record's new value is computed from its current one under
 * its lock (`applyOp`), and an unchanged record writes nothing.
 */
export const UpdateManyInput = WorkspaceScoped.extend({
  objectId: Uuid,
  recordIds: z
    .array(Uuid)
    .min(1, 'Choose at least one record.')
    .max(BULK_INLINE_MAX * 2, BULK_TOO_MANY_MESSAGE),
  edit: BulkEdit,
  timeZone: z.string().min(1).max(64).optional(),
  mutationId: Uuid,
});
/** Records to edit. */
export type UpdateManyInput = z.infer<typeof UpdateManyInput>;

/**
 * One record's outcome in a bulk edit: the fresh `record` when it landed,
 * with `written` (the version made) and `before` (the value read under its
 * lock) only when this call changed it, so a retry after a lost answer
 * carries neither (AC-540); or its `refusals`.
 */
export const UpdateOutcome = z.object({
  recordId: Uuid,
  record: RecordView.optional(),
  written: z.record(z.uuid(), Uuid).optional(),
  before: z.unknown().optional(),
  refusals: z.array(ApiRefusal).optional(),
});
/** One record's outcome in a bulk edit. */
export type UpdateOutcome = z.infer<typeof UpdateOutcome>;

/** A bulk edit's outcomes, one per record asked, and how many change events carry its `mutationId`. */
export const UpdateManyResults = z.object({
  results: z.array(UpdateOutcome),
  echoes: z.number().int().min(0),
});
/** A bulk edit's outcomes. */
export type UpdateManyResults = z.infer<typeof UpdateManyResults>;

/**
 * What a bulk job works on (spec 0022, `BulkTarget`): records by id (1 to
 * 10,000); every record a view's filter matches when "Select all" was pressed
 * (`asOf`), minus up to 1,000 left out; every trashed record (of one object
 * or all) deleted by `asOf`, minus those left out; or one delete's batch.
 */
export const BulkTarget = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ids'),
    objectId: Uuid.optional(),
    // Twice the caps here and below, so a selection a little over one answers the engine's 422 CONFIG_INVALID
    // (AC-539) with its words, and only junk stops at parsing.
    recordIds: z
      .array(Uuid)
      .min(1, 'Choose at least one record.')
      .max(
        BULK_IDS_MAX * 2,
        `Select at most ${BULK_IDS_MAX.toLocaleString('en')} records one by one, or select all matching.`,
      ),
  }),
  z.strictObject({
    kind: z.literal('matching'),
    objectId: Uuid,
    filter: FilterGroup.optional(),
    except: z
      .array(Uuid)
      .max(
        BULK_EXCEPT_MAX * 2,
        `You can leave out at most ${BULK_EXCEPT_MAX.toLocaleString('en')} records from all matching.`,
      ),
    asOf: z.iso.datetime({ offset: true }),
    now: z.iso.datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  }),
  z.strictObject({
    kind: z.literal('trash'),
    objectId: Uuid.optional(),
    except: z
      .array(Uuid)
      .max(
        BULK_EXCEPT_MAX * 2,
        `You can leave out at most ${BULK_EXCEPT_MAX.toLocaleString('en')} records from all matching.`,
      ),
    asOf: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({ kind: z.literal('batch'), batchId: Uuid }),
]);
/** What a bulk job works on. */
export type BulkTarget = z.infer<typeof BulkTarget>;

/** What a bulk job does: edit, move to the trash, restore from it, or delete forever. */
export const BulkAction = z.enum(['edit', 'delete', 'restore', 'purge']);
/** What a bulk job does. */
export type BulkAction = z.infer<typeof BulkAction>;

/**
 * Starts a bulk job (spec 0022, AC-528, AC-531): `id` is the browser's uuid
 * v7 (a retry answers the same job), and the job counts exactly what it will
 * touch (`preparing`), then waits for `jobs.confirm` (`ready`, with `total`).
 * An edit names its change. Refusals: 409 `LIMIT_REACHED` (20 unfinished
 * jobs), 422 `CONFIG_INVALID` (limits, a target the action doesn't take, the
 * edit's own rules), `FILTER_INVALID`, `JOB_TOO_LARGE`, 403 `FORBIDDEN`.
 */
export const StartBulkInput = WorkspaceScoped.extend({
  id: uuidV7('The job id must be a UUID v7.'),
  action: BulkAction,
  target: BulkTarget,
  edit: BulkEdit.optional(),
  timeZone: z.string().min(1).max(64).optional(),
  mutationId: Uuid,
});
/** A bulk job to start. */
export type StartBulkInput = z.infer<typeof StartBulkInput>;

/**
 * Bulk record actions, joined into the `records` namespace. `deleteMany`
 * answers 200 with each record's outcome; 403 `FORBIDDEN` when the member
 * may only read the object (nothing deleted), 422 `CONFIG_INVALID` over 500.
 * `restoreBatch` answers each record of the batch it restored or refused, 404
 * `NOT_FOUND` when none is left in the trash. `updateMany` answers each
 * record's outcome; 422 `CONFIG_INVALID` for an excluded attribute, an
 * operation its type doesn't take, Set on a unique attribute for several
 * records or Clear on a required one; 403 when the member may only read the
 * object or the field.
 */
export const bulkRecordsContract = {
  deleteMany: oc.input(DeleteManyInput).output(DeleteManyResults),
  restoreBatch: oc.input(RestoreBatchInput).output(RestoreBatchResults),
  updateMany: oc.input(UpdateManyInput).output(UpdateManyResults),
  startBulk: oc.input(StartBulkInput).output(JobView),
};
