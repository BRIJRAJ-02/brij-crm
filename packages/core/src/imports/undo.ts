// `records.import_undo` (spec 0040, AC-1128, AC-1129): takes an import back,
// through the engine as the member who asked. An item kind on the heavy lane,
// not cancellable, 100 rows a batch, each one engine transaction: the records
// the import created go to the trash with the import's id as their batch
// (restorable as any delete is), and every value it changed goes back to what
// it held, unless it has changed since (its version is no longer the one the
// import wrote), in which case it is kept and counted. A created record
// somebody has worked on since is kept the same way, by the same test over
// the versions the create wrote: an import undone a week later never trashes
// the work done on its records meanwhile. A row taken back is
// marked `undone`, so a batch tried again never puts anything back twice; a
// row whose every value was edited since stays `updated`, its note saying so.
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';
import { schema } from '@crm/db';
import { isRefusal } from '../engine/refusals.ts';
import { readRecords, updateRecord } from '../engine/records.ts';
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
  readonly made: unknown;
};

/** Far records a row made for its relation names (`createMissing`). */
const Made = z.array(z.object({ objectId: z.uuid(), recordId: z.uuid() }));

/** The words for values kept because they changed since the import. */
export const keptMessage = (count: number): string =>
  count === 1 ? '1 value changed since, kept.' : `${String(count)} values changed since, kept.`;

/** The code an item carries when a record the import created was worked on since, so it stays. */
export const WORKED_ON_CODE = 'RECORD_CHANGED';

/** What the summary says about a created record that was worked on since the import made it. */
export const WORKED_ON_MESSAGE = 'This record was edited since the import, so it was kept.';

/**
 * Which of `recordIds` nobody has touched since the import created them, so
 * the undo may trash them. A record is untouched when every value the import
 * wrote still carries the version it wrote, and no other attribute has been
 * given one since. A row stored before this was kept (no `written`) is
 * untouched as far as we can tell, which is the behaviour the undo had.
 */
async function untouchedSince(
  context: WriteContext,
  rows: readonly { readonly recordId: string; readonly written: z.infer<typeof Written> | undefined }[],
): Promise<ReadonlySet<string>> {
  const checkable = rows.flatMap((row) => (row.written === undefined ? [] : [row]));
  const untouched = new Set(rows.flatMap((row) => (row.written === undefined ? [row.recordId] : [])));
  if (checkable.length === 0) return untouched;
  const now = new Map(
    (
      await readRecords(
        context.tx,
        context.scope.access,
        checkable.map((row) => row.recordId),
      )
    ).map((view) => [view.id, view]),
  );
  for (const row of checkable) {
    const view = now.get(row.recordId);
    // Gone already, or out of sight: left to the delete below, which answers for it.
    if (view === undefined) {
      untouched.add(row.recordId);
      continue;
    }
    const wrote = row.written ?? {};
    const changed = Object.entries(wrote).some(([attributeId, versionId]) => view.versions[attributeId] !== versionId);
    const added = Object.keys(view.versions).some((attributeId) => !Object.hasOwn(wrote, attributeId));
    if (!changed && !added) untouched.add(row.recordId);
  }
  return untouched;
}

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
        select id::text, outcome::text, record_id::text, before, written, made from import_rows
        where workspace_id = ${scope.workspaceId} and import_id = ${row.id}
          and id = any(array(select jsonb_array_elements_text(${JSON.stringify(items.map((item) => item.itemId))}::jsonb))::uuid[])
      `);
      const byId = new Map(found.rows.map((each) => [each.id, each]));
      const outcomes = new Map<string, ItemOutcome>();
      const undone: string[] = [];

      // Created records: to the trash in one call, the import's id their batch.
      const madeRecords = items.flatMap((item) => {
        const staged = byId.get(item.itemId);
        if (staged?.outcome !== 'created' || staged.record_id === null) return [];
        const written = Written.safeParse(staged.written);
        return [
          {
            item,
            rowId: staged.id,
            recordId: staged.record_id,
            written: written.success ? written.data : undefined,
          },
        ];
      });
      // A record somebody has worked on since the import made it is not the import's to take back: it stays,
      // counted on the summary. Undoing used to trash it however much had been written on it since.
      const untouched = await untouchedSince(context, madeRecords);
      const created = madeRecords.filter((each) => untouched.has(each.recordId));
      const workedOn = madeRecords.filter((each) => !untouched.has(each.recordId));
      for (const each of workedOn) {
        outcomes.set(each.item.itemId, {
          position: each.item.position,
          state: 'skipped',
          code: WORKED_ON_CODE,
          message: WORKED_ON_MESSAGE,
        });
      }
      // The row stays `created`, saying why on the summary, as a row whose every value changed stays `updated`.
      if (workedOn.length > 0) {
        await tx
          .update(importRows)
          .set({ errorCode: WORKED_ON_CODE, errorMessage: WORKED_ON_MESSAGE })
          .where(
            and(
              eq(importRows.workspaceId, scope.workspaceId),
              inArray(
                importRows.id,
                workedOn.map((each) => each.rowId),
              ),
            ),
          );
      }
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

      // Far records rows made for their relation names: to the trash with the import's id, each far object at once.
      const madeRows = items.flatMap((item) => {
        const staged = byId.get(item.itemId);
        if (staged === undefined || staged.outcome === 'undone' || staged.outcome === 'refused') return [];
        const made = Made.safeParse(staged.made);
        return made.success && made.data.length > 0 ? [{ item, staged, made: made.data }] : [];
      });
      if (madeRows.length > 0) {
        const byObject = new Map<string, string[]>();
        for (const each of madeRows) {
          for (const link of each.made)
            byObject.set(link.objectId, [...(byObject.get(link.objectId) ?? []), link.recordId]);
        }
        const gone = new Set<string>();
        try {
          for (const [objectId, recordIds] of byObject) {
            const deleted = await deleteIn(context, { objectId, recordIds, batchId: row.id });
            for (const outcome of deleted) {
              if (outcome.state === 'deleted' || outcome.state === 'already-deleted') gone.add(outcome.recordId);
            }
          }
          context.record({ coarseObjects: [...byObject.keys()] });
        } catch (error) {
          if (!isRefusal(error) || error.refusal.code === 'QUERY_CANCELLED') throw error;
          return { finished: false, failed: { code: error.refusal.code, message: error.refusal.message } };
        }
        // A row that only made far records (its own record skipped) is taken back by this alone.
        // A made record the member can no longer delete (a record rule changed) keeps its row, said as refused.
        for (const each of madeRows) {
          const kept = each.made.some((link) => !gone.has(link.recordId));
          if (kept) {
            if (each.staged.outcome !== 'created' && each.staged.outcome !== 'updated') {
              outcomes.set(each.item.itemId, {
                position: each.item.position,
                state: 'refused',
                code: 'UNDO_REFUSED',
                message: 'A record this row made could not be moved to the trash.',
              });
            }
            continue;
          }
          if (each.staged.outcome === 'created' || each.staged.outcome === 'updated') continue;
          outcomes.set(each.item.itemId, { position: each.item.position, state: 'done' });
          undone.push(each.staged.id);
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
        result: { importId: row.id },
      };
    },
  });
}
