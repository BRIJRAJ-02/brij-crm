// `records.import_undo` (spec 0040, AC-1128, AC-1129): takes an import back,
// through the engine as the member who asked. An item kind on the heavy lane,
// not cancellable, 100 rows a batch, each one engine transaction: the records
// the import created go to the trash with the import's id as their batch
// (restorable as any delete is), and every value it changed goes back to what
// it held, unless it has changed since (its version is no longer the one the
// import wrote), in which case it is kept and counted. A row taken back is
// marked `undone`, so a batch tried again never puts anything back twice; a
// row whose every value was edited since stays `updated`, its note saying so.
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';
import { schema } from '@crm/db';
import { isRefusal } from '../engine/refusals.ts';
import { updateRecord } from '../engine/records.ts';
import { deleteIn } from '../engine/trash.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { RECORDS_IMPORT_UNDO } from './service.ts';

const { importRows, imports } = schema;

/** The kind's params: the import it takes back. */
export const ImportUndoParams = z.strictObject({ importId: z.uuid() });
/** The kind's params. */
export type ImportUndoParams = z.infer<typeof ImportUndoParams>;

/** Rows a batch takes back. */
export const UNDO_BATCH = 100;

/** The code an item carries when every value it changed was edited since, so all were kept. */
export const KEPT_CODE = 'VERSION_CHANGED';

/** What an updated row stored: each attribute's value before the import, and the version the import wrote. */
const Before = z.record(z.string(), z.object({ value: z.unknown(), versionId: z.string().optional() }));
const Written = z.record(z.string(), z.string());

/** One staged row as the undo reads it. */
type UndoRow = {
  readonly id: string;
  readonly outcome: string;
  readonly record_id: string | null;
  readonly before: unknown;
  readonly written: unknown;
};

/** The words for values kept because they changed since the import. */
export const keptMessage = (count: number): string =>
  count === 1 ? '1 value changed since, kept.' : `${String(count)} values changed since, kept.`;

/**
 * Puts one updated record's values back, one attribute at a time, each in its
 * own savepoint with the version the import wrote: one changed since is kept.
 * Answers how many went back and how many were kept.
 */
async function putBack(
  context: WriteContext,
  recordId: string,
  before: z.infer<typeof Before>,
  written: z.infer<typeof Written>,
): Promise<{ readonly restored: number; readonly kept: number; readonly refused?: string }> {
  let restored = 0;
  let kept = 0;
  let refused: string | undefined;
  for (const [attributeId, was] of Object.entries(before)) {
    const versionId = written[attributeId];
    if (versionId === undefined) continue;
    const result = await context.perRecord((inner) =>
      updateRecord(inner, {
        recordId,
        values: { [attributeId]: { value: was.value ?? null, ifVersionId: versionId } },
      }),
    );
    if (result.ok) restored += 1;
    else if (result.refusals.some((refusal) => refusal.code === KEPT_CODE)) kept += 1;
    else refused ??= result.refusals[0]?.message ?? 'This value could not be put back.';
  }
  return refused === undefined ? { restored, kept } : { restored, kept, refused };
}

/** The undo kind. */
export function recordsImportUndo(): KindDefinition<ImportUndoParams> {
  return defineKind<ImportUndoParams>({
    kind: RECORDS_IMPORT_UNDO,
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: ImportUndoParams,
    cancellable: false,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: UNDO_BATCH,
    sample: { importId: '0192f1a4-0000-7000-8000-000000000001' },
    async step(context, { job, items = [] }): Promise<StepOutcome> {
      const { tx, scope } = context;
      const [row] = await tx
        .select({ id: imports.id, objectId: imports.objectId })
        .from(imports)
        .where(and(eq(imports.workspaceId, scope.workspaceId), eq(imports.id, job.params.importId)));
      if (row === undefined) {
        return { finished: true, items: items.map((item) => ({ position: item.position, state: 'skipped' })) };
      }
      const found = await tx.execute<UndoRow>(sql`
        select id::text, outcome::text, record_id::text, before, written from import_rows
        where workspace_id = ${scope.workspaceId} and import_id = ${row.id}
          and id = any(array(select jsonb_array_elements_text(${JSON.stringify(items.map((item) => item.itemId))}::jsonb))::uuid[])
      `);
      const byId = new Map(found.rows.map((each) => [each.id, each]));
      const outcomes = new Map<string, ItemOutcome>();
      const undone: string[] = [];

      // Created records: to the trash in one call, the import's id their batch.
      const created = items.flatMap((item) => {
        const staged = byId.get(item.itemId);
        return staged?.outcome === 'created' && staged.record_id !== null
          ? [{ item, rowId: staged.id, recordId: staged.record_id }]
          : [];
      });
      if (created.length > 0) {
        try {
          const deleted = await deleteIn(context, {
            objectId: row.objectId,
            recordIds: created.map((each) => each.recordId),
            batchId: row.id,
          });
          const byRecord = new Map(deleted.map((outcome) => [outcome.recordId, outcome]));
          for (const each of created) {
            const outcome = byRecord.get(each.recordId);
            if (outcome?.state === 'deleted') {
              outcomes.set(each.item.itemId, { position: each.item.position, state: 'done' });
              undone.push(each.rowId);
            } else if (outcome?.state === 'already-deleted') {
              outcomes.set(each.item.itemId, {
                position: each.item.position,
                state: 'skipped',
                code: 'RECORD_DELETED',
              });
              undone.push(each.rowId);
            } else {
              outcomes.set(each.item.itemId, {
                position: each.item.position,
                state: 'refused',
                code: outcome?.refusal?.code ?? 'NOT_FOUND',
                message: 'That record does not exist.',
              });
            }
          }
          context.record({ coarseObjects: [row.objectId] });
        } catch (error) {
          // The member lost write on the object: the undo ends with its words.
          if (!isRefusal(error) || error.refusal.code === 'QUERY_CANCELLED') throw error;
          return { finished: false, failed: { code: error.refusal.code, message: error.refusal.message } };
        }
      }

      // Updated records: each value back, unless it changed since.
      for (const item of items) {
        const staged = byId.get(item.itemId);
        if (outcomes.has(item.itemId)) continue;
        if (staged?.outcome !== 'updated' || staged.record_id === null) {
          // Already taken back by an earlier try, or nothing to take back.
          outcomes.set(item.itemId, { position: item.position, state: 'skipped' });
          continue;
        }
        const before = Before.safeParse(staged.before);
        const written = Written.safeParse(staged.written);
        if (!before.success || !written.success) {
          outcomes.set(item.itemId, { position: item.position, state: 'skipped' });
          continue;
        }
        const result = await putBack(context, staged.record_id, before.data, written.data);
        if (result.refused !== undefined && result.restored === 0) {
          outcomes.set(item.itemId, {
            position: item.position,
            state: 'refused',
            code: 'UNDO_REFUSED',
            message: result.refused,
          });
          continue;
        }
        // Every value edited since stays, and the row stays `updated`, saying so on the summary.
        if (result.restored > 0) undone.push(staged.id);
        outcomes.set(
          item.itemId,
          result.restored === 0
            ? { position: item.position, state: 'skipped', code: KEPT_CODE, message: keptMessage(result.kept) }
            : { position: item.position, state: 'done' },
        );
        if (result.kept > 0) {
          await tx
            .update(importRows)
            .set({ errorCode: KEPT_CODE, errorMessage: keptMessage(result.kept) })
            .where(and(eq(importRows.workspaceId, scope.workspaceId), eq(importRows.id, staged.id)));
        }
      }
      if (undone.length > 0) {
        await tx
          .update(importRows)
          .set({ outcome: 'undone' })
          .where(and(eq(importRows.workspaceId, scope.workspaceId), inArray(importRows.id, undone)));
      }
      return {
        finished: false,
        items: items.map((item) => outcomes.get(item.itemId) ?? { position: item.position, state: 'skipped' }),
      };
    },
  });
}
