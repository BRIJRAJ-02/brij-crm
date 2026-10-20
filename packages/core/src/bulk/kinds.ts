// Bulk changes as background jobs (spec 0022, milestone 3): edit, delete and
// restore of more than 500 records, or of every record a view matches. Each
// kind is a member's job: its snapshot counts exactly the records it will
// touch, through the starter's door (a record they can't see is never
// listed), and waits for the confirm; then each batch of 500 runs the same
// engine write as the inline call, inside the batch's transaction, entered
// again as the starter at every slice (a member demoted mid job stops). Each
// batch's outbox rows are coarse for the object and carry `fromJob`, so open
// views refetch at most every 5 seconds. A snapshot of zero ends the job at
// once ("Nothing left to change."). Logs never carry params or values.
import { sql, type SQL } from 'drizzle-orm';
import { BulkEdit, BulkTarget } from '@crm/contracts';
import * as z from 'zod';
import { updateManyIn } from '../engine/bulk-edit.ts';
import { uuidArray } from '../engine/ids.ts';
import { matchingIdsIn } from '../engine/query/page.ts';
import { isRefusal } from '../engine/refusals.ts';
import { deleteIn, inBatch, restoreIn, trashScope } from '../engine/trash.ts';
import type { WriteContext } from '../engine/write.ts';
import { visibleRecords } from '../access/visibility.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';

/** The job kinds of bulk changes, by action. */
export const BULK_KINDS = {
  edit: 'records.bulk_edit',
  delete: 'records.bulk_delete',
  restore: 'records.bulk_restore',
  purge: 'records.purge',
} as const;

/** A bulk job's params: its object (edit and delete), what it works on, an edit's change and the starter's time zone. */
export const BulkJobParams = z.strictObject({
  objectId: z.uuid().optional(),
  target: BulkTarget,
  edit: BulkEdit.optional(),
  timeZone: z.string().min(1).max(64).optional(),
});
/** A bulk job's params. */
export type BulkJobParams = z.infer<typeof BulkJobParams>;

/** The item code of a record a restore or a purge found out of the trash (spec 0022): stored on `job_items` only. */
export const RECORD_LIVE = 'RECORD_LIVE';

/** Its words. */
const RECORD_LIVE_MESSAGE = 'That record isn’t in the trash.';

/** A sample for the shared kind contract test: one id, of no object. */
const SAMPLE: BulkJobParams = {
  objectId: '00000000-0000-7000-8000-000000000001',
  target: { kind: 'ids', recordIds: ['00000000-0000-7000-8000-000000000002'] },
};

/**
 * Reads ids page by page with `read` (after a keyset, in id order) and keeps
 * those `keep` lets through, until `limit` are kept or the rows run out: a
 * snapshot page that drops hidden records still comes back full while more
 * exist, since the runner takes a short page as the end.
 */
async function filled(
  read: (after: string | undefined, limit: number) => Promise<readonly { id: string; objectId: string }[]>,
  keep: (rows: readonly { id: string; objectId: string }[]) => Promise<ReadonlySet<string>>,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const kept: string[] = [];
  let from = after;
  for (;;) {
    const rows = await read(from, limit);
    const shown = await keep(rows);
    for (const row of rows) if (shown.has(row.id) && kept.length < limit) kept.push(row.id);
    if (rows.length < limit || kept.length >= limit) return kept;
    from = rows.at(-1)?.id;
  }
}

/** The next ids of the target after `after`, for the action, through the starter's door (`context.scope`). */
export async function snapshotIds(
  context: WriteContext,
  action: keyof typeof BULK_KINDS,
  params: BulkJobParams,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const { tx, scope } = context;
  const { target } = params;
  const keyset = (from: string | undefined): SQL => (from === undefined ? sql`true` : sql`r.id > ${from}::uuid`);
  const visible = async (rows: readonly { id: string; objectId: string }[]) =>
    visibleRecords(
      tx,
      scope.access,
      rows.map((row) => ({ objectId: row.objectId, recordId: row.id })),
    );
  const rowsOf = async (where: SQL, from: string | undefined, size: number) =>
    (
      await tx.execute<{ id: string; object_id: string }>(sql`
        select r.id::text as id, r.object_id::text as object_id from records r
        where ${where} and ${keyset(from)} order by r.id limit ${size}
      `)
    ).rows.map((row) => ({ id: row.id, objectId: row.object_id }));
  switch (target.kind) {
    case 'matching':
      return matchingIdsIn(
        tx,
        scope,
        {
          objectId: target.objectId,
          ...(target.filter === undefined ? {} : { filter: target.filter }),
          ...(target.now === undefined ? {} : { now: target.now }),
          ...(target.timeZone === undefined ? {} : { timeZone: target.timeZone }),
        },
        { after, limit, asOf: target.asOf, except: target.except },
      );
    case 'ids': {
      // Live records for an edit or a delete, trashed ones for a restore or a purge; of the job's object when it has one.
      const state =
        action === 'edit' || action === 'delete' ? sql`r.deleted_at is null` : sql`r.deleted_at is not null`;
      const object = params.objectId === undefined ? sql`true` : sql`r.object_id = ${params.objectId}::uuid`;
      const where = sql`r.id = any(${uuidArray(target.recordIds)}) and ${state} and ${object}`;
      return filled((from, size) => rowsOf(where, from, size), visible, after, limit);
    }
    case 'trash': {
      // The trash's own scope: objects the starter may read, inside their record rules.
      const where = await trashScope(tx, scope.access, target.objectId);
      const except = target.except.length === 0 ? sql`true` : sql`not (r.id = any(${uuidArray(target.except)}))`;
      const rows = await rowsOf(
        sql`${where} and r.deleted_at <= ${target.asOf}::timestamptz and ${except}`,
        after,
        limit,
      );
      return rows.map((row) => row.id);
    }
    case 'batch':
      return filled((from, size) => rowsOf(inBatch(target.batchId), from, size), visible, after, limit);
  }
}

/** The batch's item states from each record's outcome, by record id. */
function statesOf<T>(
  items: readonly { readonly position: number; readonly itemId: string }[],
  outcomes: readonly T[],
  idOf: (outcome: T) => string,
  stateOf: (outcome: T) => Omit<ItemOutcome, 'position'>,
): readonly ItemOutcome[] {
  const byId = new Map(outcomes.map((outcome) => [idOf(outcome), outcome]));
  return items.map((item): ItemOutcome => {
    const outcome = byId.get(item.itemId);
    return outcome === undefined
      ? { position: item.position, state: 'skipped', code: 'NOT_FOUND', message: 'That record does not exist.' }
      : { position: item.position, ...stateOf(outcome) };
  });
}

/** A refusal of the whole batch (the starter lost write, the field went read only) ends the job with its words. */
async function orFailed(work: () => Promise<StepOutcome>): Promise<StepOutcome> {
  try {
    return await work();
  } catch (error) {
    if (!isRefusal(error)) throw error;
    // A passing refusal (a deadlock that outlasted its tries) is a batch error, tried again by the runner.
    if (error.refusal.code === 'QUERY_CANCELLED') throw error;
    return { finished: false, failed: { code: error.refusal.code, message: error.refusal.message } };
  }
}

/** What every bulk kind shares: a member's heavy, cancellable item job, snapshot and confirm, 500 a batch. */
function bulkKind(
  action: keyof typeof BULK_KINDS,
  step: KindDefinition<BulkJobParams>['step'],
): KindDefinition<BulkJobParams> {
  return defineKind<BulkJobParams>({
    kind: BULK_KINDS[action],
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: BulkJobParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 500,
    sample: SAMPLE,
    emptySnapshotSucceeds: true,
    snapshot: (context, params, after, limit) => snapshotIds(context, action, params, after, limit),
    step,
  });
}

/** `records.bulk_edit`: `updateManyIn` over each batch; refusals never stop it, a record trashed since is skipped. */
export function bulkEditKind(): KindDefinition<BulkJobParams> {
  return bulkKind('edit', (context, { job, items = [] }) =>
    orFailed(async () => {
      const { objectId, edit, timeZone } = job.params;
      if (objectId === undefined || edit === undefined) throw new Error('A bulk edit names its object and change.');
      const outcomes = await updateManyIn(context, {
        objectId,
        recordIds: items.map((item) => item.itemId),
        edit: {
          attributeId: edit.attributeId,
          op: edit.op,
          ...(edit.value === undefined ? {} : { value: edit.value }),
        },
        timeZone,
      });
      context.record({ coarseObjects: [objectId] });
      return {
        finished: false,
        items: statesOf(
          items,
          outcomes,
          (outcome) => outcome.recordId,
          (outcome) => {
            if (outcome.state !== 'refused') return { state: 'done' };
            const [first] = outcome.refusals;
            const code = first?.code ?? 'INTERNAL';
            return code === 'RECORD_DELETED'
              ? { state: 'skipped', code }
              : { state: 'refused', code, ...(first === undefined ? {} : { message: first.message }) };
          },
        ),
      };
    }),
  );
}

/** `records.bulk_delete`: `deleteIn` with the job's id as the batch, so the finish toast's Undo restores it. */
export function bulkDeleteKind(): KindDefinition<BulkJobParams> {
  return bulkKind('delete', (context, { job, items = [] }) =>
    orFailed(async () => {
      const { objectId } = job.params;
      if (objectId === undefined) throw new Error('A bulk delete names its object.');
      const outcomes = await deleteIn(context, {
        objectId,
        recordIds: items.map((item) => item.itemId),
        batchId: job.id,
      });
      context.record({ coarseObjects: [objectId] });
      return {
        finished: false,
        items: statesOf(
          items,
          outcomes,
          (outcome) => outcome.recordId,
          (outcome) =>
            outcome.state === 'deleted'
              ? { state: 'done' }
              : outcome.state === 'already-deleted'
                ? { state: 'skipped', code: 'RECORD_DELETED' }
                : {
                    state: 'refused',
                    code: outcome.refusal?.code ?? 'NOT_FOUND',
                    message: 'That record does not exist.',
                  },
        ),
      };
    }),
  );
}

/** `records.bulk_restore`: `restoreIn` over each batch; a live record is skipped, a conflict or a full workspace refused. */
export function bulkRestoreKind(): KindDefinition<BulkJobParams> {
  return bulkKind('restore', (context, { items = [] }) =>
    orFailed(async () => {
      const outcomes = await restoreIn(
        context,
        items.map((item) => item.itemId),
      );
      const objects = [
        ...new Set(outcomes.flatMap((outcome) => (outcome.objectId === undefined ? [] : [outcome.objectId]))),
      ];
      if (objects.length > 0) context.record({ coarseObjects: objects });
      return {
        finished: false,
        items: statesOf(
          items,
          outcomes,
          (outcome) => outcome.recordId,
          (outcome): Omit<ItemOutcome, 'position'> => {
            if (outcome.state === 'restored') return { state: 'done' };
            if (outcome.state === 'live') return { state: 'skipped', code: RECORD_LIVE, message: RECORD_LIVE_MESSAGE };
            const code = outcome.refusal?.code ?? 'NOT_FOUND';
            return code === 'NOT_FOUND'
              ? { state: 'skipped', code, message: outcome.refusal?.message ?? '' }
              : { state: 'refused', code, message: outcome.refusal?.message ?? '' };
          },
        ),
      };
    }),
  );
}

/** Every bulk kind a process runs. */
export function bulkKinds(): readonly KindDefinition<BulkJobParams>[] {
  return [bulkEditKind(), bulkDeleteKind(), bulkRestoreKind()];
}
