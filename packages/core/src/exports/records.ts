// Exporting a view's records as CSV (spec 0040, AC-1130 to AC-1135), on the
// same `exports` rows, chunks, download and cleanup as the submissions
// export (forms/export.ts). A member who can read the object (and the view)
// starts one: its filter and sorts (the saved ones, or the unsaved ones on
// screen), its visible columns, the record's name first. A `records.export`
// job (theirs, heavy lane, cancellable) first snapshots the ids the view
// matches, in its order, as that member (late trap #40: paging a live view by
// keyset could skip a record whose sorted value moved), keeps them as the
// job's items, then writes 200 a batch, read through the door as they are
// then, so record rules apply and hidden fields are absent. Each value is
// written as `exportCell` does (the text the importer reads back), formula
// guarded where the type can hold text. More than 100,000 matching rows is
// refused before anything starts.
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  CSV_BOM,
  csvCell,
  csvJoin,
  exportCell,
  FilterGroup,
  guardsType,
  SortRules,
  TRANSFER_LIMITS,
  type ExportNames,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { fieldLevel } from '../access/policy.ts';
import { checkId } from '../engine/ids.ts';
import { countIn, orderedIdsIn } from '../engine/query/page.ts';
import { readRecords } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';
import {
  EXPORT_BYTES_MAX,
  EXPORT_KEPT_DAYS,
  EXPORTS_KEPT_MAX,
  exportAccessKey,
  ownExport,
  TOO_MANY_EXPORTS,
} from '../forms/export.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { insertItems, startJob } from '../jobs/service.ts';
import { readView } from '../views/views.ts';
import { appendChunk, checkRecordsSource, UNKNOWN_RECORDS_EXPORT, writeHeader } from './chunks.ts';

const { attributeOptions, exportChunks, exports, members, objects } = schema;

/** The kind a records export runs as. */
export const RECORDS_EXPORT = 'records.export';

/** Rows one batch reads: the engine's largest page. */
const PAGE = 200;

/** What a records export reads, as stored on its row: the view's query fixed at the start, and its columns. */
export const RecordsSelection = z.object({
  viewId: z.uuid().optional(),
  filter: FilterGroup.optional(),
  sorts: SortRules.optional(),
  attributeIds: z.array(z.uuid()),
  timeZone: z.string(),
  now: z.string(),
});
/** What a records export reads. */
export type RecordsSelection = z.infer<typeof RecordsSelection>;

/** A records export as members read it, but its download path (the router knows the workspace's address). */
export interface RecordsExportRecord {
  readonly id: string;
  readonly objectId: string;
  readonly fileName: string;
  readonly jobId: string;
  readonly rowCount?: number;
  readonly expiresAt: string;
}

/** What the refusal past the limit says, with the count (AC-1132). */
export const tooLarge = (count: string, pluralName: string): string =>
  `This view has ${count} ${pluralName.toLowerCase()}. Export at most ${TRANSFER_LIMITS.exportRows.toLocaleString('en')} at a time; narrow the filter.`;

/** A file name with nothing a file system or a header refuses: "<Object> - <View> - <YYYY-MM-DD>.csv". */
export function recordsFileName(pluralName: string, viewName: string, day: string): string {
  const safe = (text: string, fallback: string) =>
    text
      .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 60) || fallback;
  return `${safe(pluralName, 'Records')} - ${safe(viewName, 'View')} - ${day}.csv`;
}

/** The member who acts, or a refusal: exports belong to a member. */
function memberIdOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can export records.');
  return principal.memberId;
}

/** A row of `exports` as a records export view. */
function viewOf(row: {
  readonly id: string;
  readonly objectId: string | null;
  readonly fileName: string;
  readonly jobId: string;
  readonly rowCount: number | null;
  readonly expiresAt: string;
}): RecordsExportRecord {
  return {
    id: row.id,
    objectId: row.objectId ?? '',
    fileName: row.fileName,
    jobId: row.jobId,
    ...(row.rowCount === null ? {} : { rowCount: row.rowCount }),
    expiresAt: row.expiresAt,
  };
}

/**
 * The columns a file holds, in order: the object's primary attribute first,
 * then the asked ones the reader may see, each once (hidden is absent).
 */
export function exportColumns(
  scope: EngineScope,
  attributes: ReadonlyMap<string, AttributeDef>,
  primaryId: string | null,
  asked: readonly string[],
): readonly AttributeDef[] {
  const ids = [...new Set([...(primaryId === null ? [] : [primaryId]), ...asked])];
  return ids.flatMap((id) => {
    const attribute = attributes.get(id);
    if (attribute === undefined || isArchivedNow(attribute) || attribute.objectId === null) return [];
    return fieldLevel(scope.access, { id: attribute.id, objectId: attribute.objectId }) === 'hidden' ? [] : [attribute];
  });
}

/**
 * Starts an export of a view's records (AC-1130, AC-1132): the export's row
 * and its `records.export` job, in one write. The same id again answers the
 * same export. Refuses `EXPORT_TOO_LARGE` past 100,000 matching rows, and
 * `LIMIT_REACHED` past five kept exports (the submissions export's cap).
 */
export async function startRecordsExport(
  scope: EngineScope,
  registry: JobRegistry,
  input: {
    readonly id: string;
    readonly objectId: string;
    readonly viewId?: string;
    readonly filter?: FilterGroup;
    readonly sorts?: SortRules;
    readonly attributeIds: readonly string[];
    readonly timeZone: string;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<RecordsExportRecord> {
  const me = memberIdOf(scope);
  const exportId = checkId(input.id, UNKNOWN_RECORDS_EXPORT);
  const objectId = checkId(input.objectId, 'That object does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [held] = await tx.select({ id: exports.id }).from(exports).where(eq(exports.id, exportId));
      if (held !== undefined) return viewOf(await ownExport(tx, scope, exportId));
      await checkRecordsSource(tx, scope, objectId);
      const view =
        input.viewId === undefined
          ? undefined
          : await readView(tx, scope, checkId(input.viewId, 'That view does not exist.'), false);
      if (view !== undefined && view.objectId !== objectId) throw refuse('NOT_FOUND', 'That view does not exist.');
      const [object] = await tx
        .select({ pluralName: objects.pluralName })
        .from(objects)
        .where(eq(objects.id, objectId));
      // One start at a time per member, so two at once can't both pass the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exports:${me}`}, 0))`);
      const kept = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from exports e
        where e.created_by_member_id = ${me} and e.expires_at > now()
          and not exists (
            select 1 from jobs j
            where j.workspace_id = e.workspace_id and j.id = e.job_id and j.status in ('failed', 'cancelled')
          )
      `);
      if ((kept.rows[0]?.n ?? 0) >= EXPORTS_KEPT_MAX) throw refuse('LIMIT_REACHED', TOO_MANY_EXPORTS);
      const clock = await tx.execute<{ now: string; day: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now,
                   to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`,
      );
      const now = clock.rows[0]?.now ?? new Date().toISOString();
      const asked = RecordsSelection.safeParse({
        ...(input.viewId === undefined ? {} : { viewId: input.viewId }),
        ...(input.filter === undefined ? {} : { filter: input.filter }),
        ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
        attributeIds: [...input.attributeIds],
        timeZone: input.timeZone,
        now,
      });
      if (!asked.success)
        throw refuse('FILTER_INVALID', 'That view’s filter or sorts can’t be read. Check them and export again.');
      const selection = asked.data;
      // Counted as the member, as the view counts (record rules apply), stopping one past the limit.
      const counted = await countIn(
        tx,
        scope,
        { objectId, now, timeZone: input.timeZone, ...(input.filter === undefined ? {} : { filter: input.filter }) },
        () => undefined,
        { cap: TRANSFER_LIMITS.exportRows + 1 },
      );
      if (counted.count > TRANSFER_LIMITS.exportRows) {
        const shown = counted.atLeast
          ? `more than ${TRANSFER_LIMITS.exportRows.toLocaleString('en')}`
          : counted.count.toLocaleString('en');
        throw refuse('EXPORT_TOO_LARGE', tooLarge(shown, object?.pluralName ?? 'records'));
      }
      const { jobId } = await startJob(context, registry, {
        kind: RECORDS_EXPORT,
        params: { exportId },
        subject: { type: 'object', id: objectId },
      });
      const [row] = await tx
        .insert(exports)
        .values({
          workspaceId: scope.workspaceId,
          id: exportId,
          source: 'records',
          objectId,
          viewId: input.viewId ?? null,
          selection,
          fileName: recordsFileName(
            object?.pluralName ?? 'Records',
            view?.name ?? 'Unsaved view',
            clock.rows[0]?.day ?? 'today',
          ),
          jobId,
          createdByMemberId: me,
          policyKey: exportAccessKey(scope.access),
          expiresAt: sql`now() + make_interval(days => ${EXPORT_KEPT_DAYS})`,
        })
        .returning({
          id: exports.id,
          objectId: exports.objectId,
          fileName: exports.fileName,
          jobId: exports.jobId,
          rowCount: exports.rowCount,
          expiresAt: sql<string>`to_char(${exports.expiresAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        });
      if (row === undefined) throw new Error('The export row was not stored.');
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** One records export the caller started (only its starter sees it). */
export async function getRecordsExport(
  scope: EngineScope,
  input: { readonly exportId: string },
): Promise<RecordsExportRecord> {
  return inWorkspace(scope, async (tx) => {
    const row = await ownExport(tx, scope, input.exportId);
    if (row.source !== 'records') throw refuse('NOT_FOUND', UNKNOWN_RECORDS_EXPORT);
    return viewOf(row);
  });
}

/** The export job's params: the export it writes. */
export const RecordsExportParams = z.strictObject({ exportId: z.uuid() });
/** The export job's params. */
export type RecordsExportParams = z.infer<typeof RecordsExportParams>;

/**
 * Where an export got to: its columns, how many ids its snapshot holds, the
 * last snapshot position written, the next chunk, the totals.
 */
const Checkpoint = z.object({
  columns: z.array(z.uuid()),
  total: z.number().int().min(0),
  position: z.number().int().min(0),
  part: z.number().int().min(0),
  tail: z.number().int().min(0),
  rows: z.number().int().min(0),
  bytes: z.number().int().min(0),
});
type Checkpoint = z.infer<typeof Checkpoint>;

/** What a step answers when the view grew past the limits as it was written. */
const GREW = {
  finished: true,
  failed: {
    code: 'EXPORT_TOO_LARGE',
    message: 'This view grew past 100,000 rows or 100 MB while it was written; narrow the filter and export again.',
  },
} as const;

/** What a step answers when the view's sort ran out of time: it would again, so no retry. */
const SLOW = {
  finished: true,
  failed: {
    code: 'QUERY_CANCELLED',
    message: 'This view took too long to sort for an export; narrow the filter or remove a sort and export again.',
  },
} as const;

/**
 * Takes the export's snapshot (late trap #40): every id the view matches, in
 * its order, read in one statement as the member, stored as the job's items
 * at positions 1 to n. Answers how many, or the step's failure past the row
 * limit or when the sort ran out of time.
 */
async function takeSnapshot(
  context: WriteContext,
  jobId: string,
  objectId: string,
  selection: RecordsSelection,
): Promise<number | typeof GREW | typeof SLOW> {
  const { tx, scope } = context;
  const ids = await orderedIdsIn(
    tx,
    scope,
    {
      objectId,
      now: selection.now,
      timeZone: selection.timeZone,
      ...(selection.filter === undefined ? {} : { filter: selection.filter }),
      ...(selection.sorts === undefined ? {} : { sorts: selection.sorts }),
    },
    TRANSFER_LIMITS.exportRows + 1,
  );
  if (ids === undefined) return SLOW;
  if (ids.length > TRANSFER_LIMITS.exportRows) return GREW;
  // A retried first batch rolled its items back with it, so they go in afresh.
  await insertItems(tx, scope.workspaceId, jobId, ids, 0);
  return ids.length;
}

/**
 * The snapshot's next `PAGE` ids after `position`, taken off the job's items
 * as they are read (one statement), so the snapshot clears itself as the file
 * is written. A retried batch rolls the delete back with it.
 */
async function nextIds(
  tx: WorkspaceTx,
  workspaceId: string,
  jobId: string,
  position: number,
): Promise<readonly { readonly position: number; readonly id: string }[]> {
  const taken = await tx.execute<{ position: number; item_id: string }>(sql`
    with next as (
      select position from job_items
      where workspace_id = ${workspaceId}::uuid and job_id = ${jobId}::uuid and position > ${position}
      order by position limit ${PAGE}
    )
    delete from job_items i using next
    where i.workspace_id = ${workspaceId}::uuid and i.job_id = ${jobId}::uuid and i.position = next.position
    returning i.position, i.item_id::text
  `);
  return taken.rows.map((row) => ({ position: row.position, id: row.item_id })).sort((a, b) => a.position - b.position);
}

/** Option labels, member names and linked records' names for one page's cells. */
async function namesFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  columns: readonly AttributeDef[],
  values: readonly Readonly<Record<string, unknown>>[],
): Promise<ExportNames> {
  const optioned = columns.filter((column) => column.type === 'select' || column.type === 'status').map((c) => c.id);
  const options =
    optioned.length === 0
      ? []
      : await tx
          .select({ id: attributeOptions.id, attributeId: attributeOptions.attributeId, label: attributeOptions.label })
          .from(attributeOptions)
          .where(inArray(attributeOptions.attributeId, optioned));
  const labels = new Map(options.map((option) => [`${option.attributeId}:${option.id}`, option.label]));
  const actorIds = new Set<string>();
  const recordIds = new Set<string>();
  for (const column of columns) {
    for (const row of values) {
      const value = row[column.id];
      for (const each of Array.isArray(value) ? (value as unknown[]) : [value]) {
        if (typeof each !== 'object' || each === null) continue;
        const item = each as Record<string, unknown>;
        if (column.type === 'actor_reference' && item.type === 'member' && typeof item.id === 'string') {
          actorIds.add(item.id);
        }
        if (column.type === 'record_reference' && typeof item.recordId === 'string') recordIds.add(item.recordId);
      }
    }
  }
  const people =
    actorIds.size === 0
      ? []
      : await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, [...actorIds]));
  const memberNames = new Map(people.map((person) => [person.id, person.name]));
  // Linked records the reader can't see are absent, so their names are too.
  const linked = recordIds.size === 0 ? [] : await readRecords(tx, scope.access, [...recordIds], { attributeIds: [] });
  const recordNames = new Map(linked.map((record) => [record.id, record.display.name]));
  return {
    optionLabel: (attributeId, optionId) => labels.get(`${attributeId}:${optionId}`),
    actorName: (actor) =>
      actor.type === 'member'
        ? (memberNames.get(actor.id ?? '') ?? 'A removed member')
        : actor.type === 'system'
          ? 'System'
          : 'An API key',
    recordName: (reference) => recordNames.get(reference.recordId),
  };
}

/**
 * One batch of an export. The first takes the snapshot and writes the header;
 * every later one writes the snapshot's next 200 records, read as they are
 * now through the door, as one chunk. A record changed since the snapshot is
 * written with its values now, in its snapshot place; one added since is not
 * in the file; one deleted since (or now out of the member's sight) is left out.
 */
async function exportStep(
  context: WriteContext,
  jobId: string,
  exportId: string,
  checkpoint: unknown,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  const gone = { finished: true, failed: { code: 'NOT_FOUND', message: 'The export was deleted before it finished.' } };
  const [held] = await tx
    .select({
      objectId: exports.objectId,
      selection: exports.selection,
      createdByMemberId: exports.createdByMemberId,
      policyKey: exports.policyKey,
    })
    .from(exports)
    .where(eq(exports.id, exportId));
  if (held?.objectId === null || held === undefined) return gone;
  const objectId = held.objectId;
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.memberId !== held.createdByMemberId) return gone;
  if (held.policyKey !== exportAccessKey(scope.access)) {
    return {
      finished: true,
      failed: { code: 'FORBIDDEN', message: 'Your access changed while this export was being written. Export again.' },
    };
  }
  await checkRecordsSource(tx, scope, objectId);
  const selection = RecordsSelection.parse(held.selection);
  const attributes = await loadAttributes(tx, objectId);
  const stored = Checkpoint.safeParse(checkpoint);
  let at: Checkpoint;
  if (stored.success) at = stored.data;
  else {
    const total = await takeSnapshot(context, jobId, objectId, selection);
    if (typeof total !== 'number') return total;
    const [object] = await tx
      .select({ primaryAttributeId: objects.primaryAttributeId })
      .from(objects)
      .where(eq(objects.id, objectId));
    const columns = exportColumns(scope, attributes, object?.primaryAttributeId ?? null, selection.attributeIds);
    const header = CSV_BOM + csvJoin(columns.map((column) => csvCell(column.title)));
    // A file begun under the old cursor checkpoint (a deploy mid export) starts again whole: none of its chunks stay.
    await tx.delete(exportChunks).where(and(eq(exportChunks.exportId, exportId), gt(exportChunks.part, 0)));
    const cursor = await writeHeader(tx, scope.workspaceId, exportId, header);
    at = {
      columns: columns.map((column) => column.id),
      total,
      position: 0,
      ...cursor,
      rows: 0,
      bytes: Buffer.byteLength(header),
    };
    // The snapshot's batch does nothing more, so it stays inside one batch's time; the rows follow from the next.
    if (total > 0) return { finished: false, checkpoint: at, counts: { done: 0 } };
  }
  const columns = at.columns.flatMap((id) => {
    const attribute = attributes.get(id);
    return attribute === undefined ? [] : [attribute];
  });
  const taken = await nextIds(tx, scope.workspaceId, jobId, at.position);
  const read = await readRecords(
    tx,
    scope.access,
    taken.map((item) => item.id),
    { attributes: new Map([[objectId, attributes]]), attributeIds: at.columns },
  );
  const byId = new Map(read.map((record) => [record.id, record]));
  // In the snapshot's order; a record deleted or out of sight since is absent.
  const records = taken.flatMap((item) => {
    const record = byId.get(item.id);
    return record === undefined || record.objectId !== objectId ? [] : [record];
  });
  const names = await namesFor(
    tx,
    scope,
    columns,
    records.map((record) => record.values),
  );
  const text = records
    .map((record) =>
      csvJoin(
        at.columns.map((id) => {
          const attribute = attributes.get(id);
          if (attribute === undefined) return '';
          return csvCell(exportCell(attribute, record.values[id], names), guardsType(attribute.type));
        }),
      ),
    )
    .join('');
  const rows = at.rows + records.length;
  if (rows > TRANSFER_LIMITS.exportRows || at.bytes + Buffer.byteLength(text) > EXPORT_BYTES_MAX) return GREW;
  const { part, tail } = await appendChunk(tx, scope.workspaceId, exportId, at, text);
  const position = taken.at(-1)?.position ?? at.total;
  const next: Checkpoint = { ...at, position, part, tail, rows, bytes: at.bytes + Buffer.byteLength(text) };
  const finished = taken.length < PAGE || position >= at.total;
  if (finished) {
    await tx
      .update(exports)
      .set({ rowCount: next.rows, byteCount: next.bytes, updatedAt: sql`now()` })
      .where(eq(exports.id, exportId));
  }
  return { finished, checkpoint: next, counts: { done: records.length }, result: { rows: next.rows, exportId } };
}

/** `records.export`: the member's, heavy lane, cancellable, 200 records a batch, read as the member. */
export function recordsExport(): KindDefinition<RecordsExportParams> {
  return defineKind<RecordsExportParams>({
    kind: RECORDS_EXPORT,
    lane: 'heavy',
    actor: 'member',
    mode: 'cursor',
    params: RecordsExportParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: PAGE,
    sample: { exportId: '0199f0a0-0000-7000-8000-000000000002' },
    step: (context, { job }) => exportStep(context, job.id, job.params.exportId, job.checkpoint),
  });
}
