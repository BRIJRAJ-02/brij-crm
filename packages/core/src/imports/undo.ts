// `records.import_undo` (spec 0040, AC-1128, AC-1129): takes an import back,
// through the engine as the member who asked. An item kind on the heavy lane,
// not cancellable, 100 rows a batch, each one engine transaction: the records
// the import created go to the trash with the import's id as their batch
// (restorable as any delete is), and every value it changed goes back to what
// it held, unless it has changed since (its version is no longer the one the
// import wrote), in which case it is kept and counted. A created record
// somebody has worked on since is kept the same way, by the same test over
// the versions the create wrote: an import undone a week later never trashes
// the work done on its records meanwhile, and nor does a note, comment or
// task on one. A far record it made for a relation name stays too once
// somebody else has edited it, linked to it or written on it. A row taken back is
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

/** What the summary says about a record a row made for a relation name that was worked on since. */
export const MADE_KEPT_MESSAGE = 'The record this row made for a linked name was worked on since, so it was kept.';

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
 * Of `recordIds`, those somebody has attached work to: a live note, comment or task. None of them is a value, so the
 * version test above can't see them, and trashing the record took them out of sight with it (late trap #81).
 */
async function withAttachedWork(context: WriteContext, recordIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (recordIds.length === 0) return new Set();
  const ids = sql`array(select jsonb_array_elements_text(${JSON.stringify(recordIds)}::jsonb))::uuid[]`;
  const found = await context.tx.execute<{ id: string }>(sql`
    select n.record_id::text as id from notes n
    where n.workspace_id = ${context.scope.workspaceId} and n.record_id = any(${ids}) and n.deleted_at is null
    union
    select c.record_id::text from comments c
    where c.workspace_id = ${context.scope.workspaceId} and c.record_id = any(${ids}) and c.deleted_at is null
    union
    select l.record_id::text from task_records l
    join tasks t on t.workspace_id = l.workspace_id and t.id = l.task_id and t.deleted_at is null
    where l.workspace_id = ${context.scope.workspaceId} and l.record_id = any(${ids})
    union
    select l.record_id::text from note_records l
    join notes n on n.workspace_id = l.workspace_id and n.id = l.note_id and n.deleted_at is null
    where l.workspace_id = ${context.scope.workspaceId} and l.record_id = any(${ids})
  `);
  return new Set(found.rows.map((row) => row.id));
}

/**
 * Of the far records an import made for its relation names (`createMissing`), those that are no longer only the
 * import's (late trap #80): edited since (a record's revision moves on every write to it, and a record is made at
 * 0), linked to a record the import neither made nor wrote, or holding a note, comment or task. Undoing used to
 * trash them all, so a company other people had since linked deals to, or written on, went with the import.
 */
async function madeWorkedOn(
  context: WriteContext,
  importId: string,
  recordIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (recordIds.length === 0) return new Set();
  const ids = sql`array(select jsonb_array_elements_text(${JSON.stringify(recordIds)}::jsonb))::uuid[]`;
  const workspaceId = context.scope.workspaceId;
  const found = await context.tx.execute<{ id: string }>(sql`
    select r.id::text from records r
    where r.workspace_id = ${workspaceId} and r.id = any(${ids}) and r.revision > 0
    union
    -- A link to a record none of this import's rows wrote. One arm per end, each on its own history index, and NOT
    -- EXISTS, so the planner probes or anti-joins the import's rows rather than holding all of them per link.
    select k.from_record_id::text from record_links k
    where k.workspace_id = ${workspaceId} and k.from_record_id = any(${ids}) and k.active_until is null
      and not exists (
        select 1 from import_rows ir
        where ir.workspace_id = ${workspaceId} and ir.import_id = ${importId} and ir.record_id = k.to_record_id
      )
    union
    select k.to_record_id::text from record_links k
    where k.workspace_id = ${workspaceId} and k.to_record_id = any(${ids}) and k.active_until is null
      and not exists (
        select 1 from import_rows ir
        where ir.workspace_id = ${workspaceId} and ir.import_id = ${importId} and ir.record_id = k.from_record_id
      )
  `);
  const attached = await withAttachedWork(context, recordIds);
  return new Set([...found.rows.map((row) => row.id), ...attached]);
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
      const unedited = await untouchedSince(context, madeRecords);
      const attached = await withAttachedWork(
        context,
        madeRecords.map((each) => each.recordId),
      );
      const untouched = new Set([...unedited].filter((id) => !attached.has(id)));
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
        // A made record others have worked on since stays, as the row's own record does; its row still goes back.
        const workedOn = await madeWorkedOn(context, row.id, [...byObject.values()].flat());
        for (const id of workedOn) gone.add(id);
        try {
          for (const [objectId, all] of byObject) {
            const recordIds = all.filter((id) => !workedOn.has(id));
            if (recordIds.length === 0) continue;
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
        // A row whose made record stays says so on the summary, as a created record kept does.
        const keptRows = madeRows.filter((each) => each.made.some((link) => workedOn.has(link.recordId)));
        if (keptRows.length > 0) {
          await tx
            .update(importRows)
            .set({ errorCode: WORKED_ON_CODE, errorMessage: MADE_KEPT_MESSAGE })
            .where(
              and(
                eq(importRows.workspaceId, scope.workspaceId),
                inArray(
                  importRows.id,
                  keptRows.map((each) => each.staged.id),
                ),
              ),
            );
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
