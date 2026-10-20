// Starting a bulk change as a background job (spec 0022, milestone 3), and
// undoing a delete whose batch is past what one request restores. The door's
// check for the action comes first (object write for an edit, a delete or a
// restore of one object; the field's write and the edit's own rules for an
// edit; `records.purge` for a purge), then the job starts inside the same
// write with a snapshot and a confirm (spec 0008): it counts exactly what it
// will touch and waits. The runner enters the starter again at every slice.
import { sql } from 'drizzle-orm';
import {
  BULK_EXCEPT_MAX,
  BULK_IDS_MAX,
  PERMISSIONS,
  type BulkAction,
  type BulkEdit,
  type BulkTarget,
  type JobView,
} from '@crm/contracts';
import { can } from '../access/policy.ts';
import { checkObject, UNKNOWN_OBJECT, visibleRecords } from '../access/visibility.ts';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkBulkEdit } from '../engine/bulk-edit.ts';
import { checkId } from '../engine/ids.ts';
import { checkMatching } from '../engine/query/page.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inBatch, MAX_INLINE_RECORDS, restoreBatch, type RestoreOutcome } from '../engine/trash.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { getJob, startJob } from '../jobs/service.ts';
import { BULK_KINDS, type BulkJobParams } from './kinds.ts';

/** A bulk job to start (`records.startBulk`). */
export interface StartBulkInput {
  /** The browser's uuid v7: the retry key, so a retry answers the job already made. */
  readonly id: string;
  readonly action: BulkAction;
  readonly target: BulkTarget;
  readonly edit?: BulkEdit | undefined;
  readonly timeZone?: string | undefined;
}

/** The words of a refused start (AC-539). */
export const BULK_START_WORDS = {
  tooManyIds: `Select at most ${BULK_IDS_MAX.toLocaleString('en')} records one by one, or select all matching.`,
  tooManyExcept: `You can leave out at most ${BULK_EXCEPT_MAX.toLocaleString('en')} records from all matching. Clear and select them one by one instead.`,
  needsObject: 'Name the object whose records change.',
  needsEdit: 'Say what the edit changes.',
  wrongTarget: 'That change can’t work on those records.',
} as const;

/** The object a target names, if any. */
function objectOf(target: BulkTarget): string | undefined {
  return target.kind === 'matching' || target.kind === 'ids' || target.kind === 'trash' ? target.objectId : undefined;
}

/** Checks the target's own limits and its fit with the action (422 `CONFIG_INVALID`). */
function checkTarget(action: BulkAction, target: BulkTarget): void {
  if (target.kind === 'ids' && target.recordIds.length > BULK_IDS_MAX) {
    throw refuse('CONFIG_INVALID', BULK_START_WORDS.tooManyIds);
  }
  if ((target.kind === 'matching' || target.kind === 'trash') && target.except.length > BULK_EXCEPT_MAX) {
    throw refuse('CONFIG_INVALID', BULK_START_WORDS.tooManyExcept);
  }
  const live = action === 'edit' || action === 'delete';
  const fits = live ? target.kind === 'ids' || target.kind === 'matching' : target.kind !== 'matching';
  if (!fits || (target.kind === 'batch' && action !== 'restore'))
    throw refuse('CONFIG_INVALID', BULK_START_WORDS.wrongTarget);
}

/**
 * Checks the action through the door, inside the start's write (AC-538):
 * edit (object and field write, the edit's rules), delete (object write),
 * restore of one object (object write; a restore across objects is checked
 * per record by its batches), purge (`records.purge`, 403 `FORBIDDEN`). An
 * "all matching" filter is compiled as the starter would read it.
 */
async function checkAction(context: WriteContext, input: StartBulkInput, objectId: string | undefined): Promise<void> {
  const { tx, scope } = context;
  if (input.action === 'purge') {
    if (!can(scope.access, 'records.purge')) throw refuse('FORBIDDEN', PERMISSIONS['records.purge'].message);
    if (objectId !== undefined) await checkObject(tx, scope.access, objectId, 'read');
    return;
  }
  if (input.action === 'edit' || input.action === 'delete') {
    if (objectId === undefined) throw refuse('CONFIG_INVALID', BULK_START_WORDS.needsObject);
    await checkObject(tx, scope.access, objectId, 'read');
    await checkObject(tx, scope.access, objectId, 'write');
    if (input.action === 'edit') {
      if (input.edit === undefined) throw refuse('CONFIG_INVALID', BULK_START_WORDS.needsEdit);
      // Many records: Set on a unique attribute is refused here, before anything is counted.
      await checkBulkEdit(tx, scope, objectId, input.edit, 2);
    }
  } else if (objectId !== undefined) {
    await checkObject(tx, scope.access, objectId, 'read');
    await checkObject(tx, scope.access, objectId, 'write');
  }
  if (input.target.kind === 'matching') {
    await checkMatching(tx, scope, {
      objectId: input.target.objectId,
      ...(input.target.filter === undefined ? {} : { filter: input.target.filter }),
      ...(input.target.now === undefined ? {} : { now: input.target.now }),
      ...(input.target.timeZone === undefined ? {} : { timeZone: input.target.timeZone }),
    });
  }
}

/** The target with `asOf` no later than now: a record made after the start is never caught (AC-528). */
function boundedTarget(target: BulkTarget): BulkTarget {
  if (target.kind !== 'matching' && target.kind !== 'trash') return target;
  const asOf = Date.parse(target.asOf);
  return Number.isNaN(asOf) || asOf <= Date.now() ? target : { ...target, asOf: new Date().toISOString() };
}

/** Starts the job inside a write, after the door's check. */
async function startIn(
  context: WriteContext,
  registry: JobRegistry,
  input: StartBulkInput,
  options: { readonly confirm: boolean },
): Promise<string> {
  checkTarget(input.action, input.target);
  const targetObject = objectOf(input.target);
  const objectId = targetObject === undefined ? undefined : checkId(targetObject, UNKNOWN_OBJECT);
  await checkAction(context, input, objectId);
  const params: BulkJobParams = {
    ...(objectId === undefined ? {} : { objectId }),
    target: boundedTarget(input.target),
    ...(input.edit === undefined ? {} : { edit: input.edit }),
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
  };
  const { jobId } = await startJob(context, registry, {
    id: input.id,
    kind: BULK_KINDS[input.action],
    params,
    snapshot: true,
    confirm: options.confirm,
    ...(objectId === undefined ? {} : { subject: { type: 'object', id: objectId } }),
  });
  return jobId;
}

/**
 * Starts a bulk change as a job (spec 0022, AC-528, AC-531, AC-534, AC-535):
 * the door's check for the action, then a job that counts its records and
 * waits for `jobs.confirm`. A retry with the same id answers the same job
 * (AC-540). Refusals: 422 `CONFIG_INVALID` (more than 10,000 ids or 1,000
 * left out, a target the action doesn't take, the edit's rules),
 * `FILTER_INVALID`, 403 `FORBIDDEN`, 409 `LIMIT_REACHED` (20 unfinished jobs).
 */
export async function startBulk(
  scope: EngineScope,
  registry: JobRegistry,
  input: StartBulkInput,
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const { result } = await runWrite(scope, (context) => startIn(context, registry, input, { confirm: true }), hooks);
  return getJob(scope, registry, result);
}

/** An undone delete: restored inline, or, past 500, a restore job started (with no confirm: an undo doesn't ask twice). */
export type UndoDeleteAnswer =
  | { readonly mode: 'inline'; readonly results: readonly RestoreOutcome[] }
  | { readonly mode: 'job'; readonly job: JobView };

/**
 * Undoes a delete by its batch (spec 0022, AC-526, AC-528, AC-534): up to
 * 500 of its records the member sees still in the trash come back inline
 * (`restoreBatch`); more (only a delete job makes such a batch) start a
 * `records.bulk_restore` job over the batch with `jobId`, counted and run
 * with no confirm. `NOT_FOUND` when none is left.
 */
export async function undoDelete(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly batchId: string; readonly jobId?: string | undefined },
  hooks: readonly AfterWrite[] = [],
): Promise<UndoDeleteAnswer> {
  checkScope(scope);
  const batchId = checkId(input.batchId, 'Nothing from that delete is still in the trash.');
  const many = await inWorkspace(scope, async (tx) => {
    // Counted over what the member sees, so the answer never hints at hidden records.
    const rows = await tx.execute<{ id: string; object_id: string }>(
      sql`select id::text, object_id::text from records where ${inBatch(batchId)} order by id limit ${MAX_INLINE_RECORDS * 4}`,
    );
    const seen = await visibleRecords(
      tx,
      scope.access,
      rows.rows.map((row) => ({ objectId: row.object_id, recordId: row.id })),
    );
    return seen.size > MAX_INLINE_RECORDS;
  });
  if (!many || input.jobId === undefined) {
    return { mode: 'inline', results: await restoreBatch(scope, { batchId }, hooks) };
  }
  const jobId = input.jobId;
  await runWrite(
    scope,
    (context) =>
      startIn(
        context,
        registry,
        { id: jobId, action: 'restore', target: { kind: 'batch', batchId } },
        { confirm: false },
      ),
    hooks,
  );
  return { mode: 'job', job: await getJob(scope, registry, jobId) };
}
