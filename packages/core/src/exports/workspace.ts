// The full workspace export (scope #37's export half, lane wip/crm-dataio): an
// owner's "Export everything". A holder of `workspace.export` (Owner only)
// with the open data policy (owners always hold it; anything else is refused,
// fail closed) starts one `workspace.export` job (theirs, heavy, cancellable),
// one per workspace at a time. Its batches write one file at a time into the
// export's chunks: a CSV per live object (every column, read through the door
// with `readRecords`, cells as the view export writes them), the current
// relationship links, the lists and a CSV of each list's entries, then the
// notes, tasks and comments as JSON lines. Only live rows on live records go
// in; a task whose links were purged only if its owner made it or holds it.
// The last batch zips the chunks with a manifest into the private file store
// (`storage_path`), drops the chunks, and the file is the starter's to
// download for 24 hours, through the same download route as every export.
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { csvCell, csvJoin, exportCell, guardsType } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { can, OPEN_KEY } from '../access/policy.ts';
import { checkId } from '../engine/ids.ts';
import { readEntriesById } from '../engine/lists.ts';
import { readRecords } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadAttributes, loadListAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { exportAccessKey, UNKNOWN_EXPORT } from '../forms/export.ts';
import { defineKind, MAX_ATTEMPTS, type JobRegistry, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { writeAudit } from '../members/audit.ts';
import { appendChunk } from './chunks.ts';
import { exportColumns, namesFor } from './records.ts';

const { exportChunks, exports, listEntries, lists, objects, records, workspaces } = schema;

/** The kind a workspace export runs as. */
export const WORKSPACE_EXPORT = 'workspace.export';

/** How long a finished workspace export's file is kept: a day, as it holds everything. */
export const WORKSPACE_EXPORT_KEPT_HOURS = 24;

/** The most text one export writes before zipping (250 MB): the zip is built in memory. */
export const WORKSPACE_EXPORT_BYTES_MAX = 250 * 1024 * 1024;

/** Rows a batch reads: records the engine's largest page, other rows more. */
const RECORD_PAGE = 200;
const ROW_PAGE = 500;

/** What the manifest says this file's layout is, for whoever reads it back. */
const FORMAT_VERSION = 1;

/** What the refusals say. */
export const WORKSPACE_EXPORT_RUNNING = 'An export of this workspace is already running. Try again when it’s done.';
const NOT_OWNER = 'Only workspace owners can export the whole workspace.';
const TOO_LARGE =
  'This workspace is too big to export in one file yet (more than 250 MB of data). Export its objects one view at a time.';

/** What the file store needs to do for the export: put the zip, and take it away again. */
export interface WorkspaceExportStore {
  /** Stores `body` under `pathname`, private; throws if something is already there. */
  put(pathname: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Deletes stored files by pathname; one already gone is not an error. */
  remove(pathnames: readonly string[]): Promise<void>;
}

/** A workspace export as its starter reads it, but its download path. */
export interface WorkspaceExportRecord {
  readonly id: string;
  readonly fileName: string;
  readonly jobId: string;
  /** Rows written in all, once the file is ready. */
  readonly rowCount?: number;
  /** The zip's size in bytes, once ready. */
  readonly byteCount?: number;
  readonly expiresAt: string;
}

/** The member who acts, refused unless they hold `workspace.export` with the open data policy (fail closed). */
function ownerOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member' || !can(scope.access, 'workspace.export') || scope.access.data.key !== OPEN_KEY) {
    throw refuse('FORBIDDEN', NOT_OWNER);
  }
  return principal.memberId;
}

/** Where a workspace export's zip is stored: fixed by its ids, so a retried last batch writes the same place. */
export function workspaceExportPath(workspaceId: string, exportId: string): string {
  return `workspace-exports/${workspaceId}/${exportId}.zip`;
}

/** A file name with nothing a file system or a header refuses: "<Workspace> - Export - <YYYY-MM-DD>.zip". */
export function workspaceExportFileName(workspaceName: string, day: string): string {
  const safe =
    workspaceName
      .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 60) || 'Workspace';
  return `${safe} - Export - ${day}.zip`;
}

const COLUMNS = {
  id: exports.id,
  fileName: exports.fileName,
  jobId: exports.jobId,
  rowCount: exports.rowCount,
  byteCount: exports.byteCount,
  expiresAt: sql<string>`to_char(${exports.expiresAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

function viewOf(row: {
  readonly id: string;
  readonly fileName: string;
  readonly jobId: string;
  readonly rowCount: number | null;
  readonly byteCount: number | null;
  readonly expiresAt: string;
}): WorkspaceExportRecord {
  return {
    id: row.id,
    fileName: row.fileName,
    jobId: row.jobId,
    ...(row.rowCount === null ? {} : { rowCount: row.rowCount }),
    ...(row.byteCount === null ? {} : { byteCount: row.byteCount }),
    expiresAt: row.expiresAt,
  };
}

/**
 * Starts an export of everything (DIO-9, DIO-11): the export's row and its
 * job, in one write. The same id again answers the same export. Refuses
 * `FORBIDDEN` to anyone but an owner, and `LIMIT_REACHED` while another
 * export of the workspace is unfinished (one at a time, under a lock).
 */
export async function startWorkspaceExport(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly id: string },
  hooks: readonly AfterWrite[] = [],
): Promise<WorkspaceExportRecord> {
  const me = ownerOf(scope);
  const exportId = checkId(input.id, UNKNOWN_EXPORT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [held] = await tx
        .select({ ...COLUMNS, source: exports.source, createdByMemberId: exports.createdByMemberId })
        .from(exports)
        .where(eq(exports.id, exportId));
      // The same id again is the same export; one another export already took is refused, never a stored clash.
      if (held !== undefined) {
        if (held.source !== 'workspace' || held.createdByMemberId !== me) {
          throw refuse('ID_TAKEN', 'That export id is already taken. Start the export again.');
        }
        return viewOf(held);
      }
      // One start at a time per workspace, so two owners at once can't both pass the check.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-export:${scope.workspaceId}`}, 0))`,
      );
      const running = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from exports e
        join jobs j on j.workspace_id = e.workspace_id and j.id = e.job_id
        where e.source = 'workspace' and j.status not in ('succeeded', 'failed', 'cancelled')
      `);
      if ((running.rows[0]?.n ?? 0) > 0) throw refuse('LIMIT_REACHED', WORKSPACE_EXPORT_RUNNING);
      const [workspace] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, scope.workspaceId));
      const clock = await tx.execute<{ day: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`,
      );
      const { jobId } = await startJob(context, registry, { kind: WORKSPACE_EXPORT, params: { exportId } });
      const [row] = await tx
        .insert(exports)
        .values({
          workspaceId: scope.workspaceId,
          id: exportId,
          source: 'workspace',
          selection: {},
          fileName: workspaceExportFileName(workspace?.name ?? 'Workspace', clock.rows[0]?.day ?? 'today'),
          jobId,
          createdByMemberId: me,
          policyKey: exportAccessKey(scope.access),
          storagePath: workspaceExportPath(scope.workspaceId, exportId),
          // Kept while it is written; a finished file is kept a day from when it is ready.
          expiresAt: sql`now() + interval '7 days'`,
        })
        .returning(COLUMNS);
      if (row === undefined) throw new Error('The export row was not stored.');
      // Everything leaving at once is a security event: History › Security says who took it, and when.
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'workspace.exported',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { exportId },
      });
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** The export job's params: the export it writes. */
export const WorkspaceExportParams = z.strictObject({ exportId: z.uuid() });
/** The export job's params. */
export type WorkspaceExportParams = z.infer<typeof WorkspaceExportParams>;

/** What one file of the zip is made from. */
const FileKind = z.enum(['records', 'relationships', 'lists', 'entries', 'notes', 'tasks', 'comments']);

/** One file of the zip: its path, what it holds, its rows, and its chunks (parts `first` to `last`). */
const PlannedFile = z.object({
  path: z.string(),
  kind: FileKind,
  /** The object (records) or list (entries) it holds. */
  sourceId: z.uuid().optional(),
  rows: z.number().int().min(0),
  first: z.number().int().min(-1),
  last: z.number().int().min(-1),
});
type PlannedFile = z.infer<typeof PlannedFile>;

/** Where the export got to: its files, the one being written and its keyset cursor, the next chunk, the totals. */
const Checkpoint = z.object({
  files: z.array(PlannedFile),
  index: z.number().int().min(0),
  after: z.uuid().optional(),
  part: z.number().int().min(0),
  bytes: z.number().int().min(0),
  rows: z.number().int().min(0),
});
type Checkpoint = z.infer<typeof Checkpoint>;

/** A path segment from a slug: lower case letters, digits, dashes and underscores only. */
const segment = (slug: string, fallback: string): string =>
  slug
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;

/** The files to write, in order: every live object's records, the links, the lists and their entries, then the rest. */
async function planFiles(tx: WorkspaceTx): Promise<readonly PlannedFile[]> {
  const live = await tx
    .select({ id: objects.id, apiSlug: objects.apiSlug })
    .from(objects)
    .where(isNull(objects.archivedAt))
    .orderBy(asc(objects.createdAt), asc(objects.id));
  const kept = await tx
    .select({ id: lists.id, apiSlug: lists.apiSlug })
    .from(lists)
    .where(isNull(lists.archivedAt))
    .orderBy(asc(lists.createdAt), asc(lists.id));
  const blank = { rows: 0, first: -1, last: -1 };
  return [
    ...live.map((object) => ({
      path: `records/${segment(object.apiSlug, object.id)}.csv`,
      kind: 'records' as const,
      sourceId: object.id,
      ...blank,
    })),
    { path: 'relationships.csv', kind: 'relationships' as const, ...blank },
    { path: 'lists.csv', kind: 'lists' as const, ...blank },
    ...kept.map((list) => ({
      path: `list-entries/${segment(list.apiSlug, list.id)}.csv`,
      kind: 'entries' as const,
      sourceId: list.id,
      ...blank,
    })),
    { path: 'notes.jsonl', kind: 'notes' as const, ...blank },
    { path: 'tasks.jsonl', kind: 'tasks' as const, ...blank },
    { path: 'comments.jsonl', kind: 'comments' as const, ...blank },
  ];
}

/** One page of a file: its header (first page only), its text, how many rows, and the last id (the next cursor). */
interface Page {
  readonly header: string;
  readonly text: string;
  readonly rows: number;
  readonly last: string | undefined;
  readonly isLast: boolean;
}

/** A CSV line of plain text cells, formula guarded. */
const line = (cells: readonly string[]): string => csvJoin(cells.map((cell) => csvCell(cell)));

/** A JSON line. */
const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** An object's columns for the file: its record id, then every column the reader may see, the name first. */
function recordColumns(scope: EngineScope, attributes: ReadonlyMap<string, AttributeDef>, primaryId: string | null) {
  return exportColumns(scope, attributes, primaryId, [...attributes.keys()]);
}

/** A page of one object's live records, read through the door. */
async function recordsPage(context: WriteContext, objectId: string, after: string | undefined): Promise<Page> {
  const { tx, scope } = context;
  const attributes = await loadAttributes(tx, objectId);
  const [object] = await tx
    .select({ primaryAttributeId: objects.primaryAttributeId })
    .from(objects)
    .where(eq(objects.id, objectId));
  const columns = recordColumns(scope, attributes, object?.primaryAttributeId ?? null);
  const ids = await tx
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.objectId, objectId),
        isNull(records.deletedAt),
        ...(after === undefined ? [] : [gt(records.id, after)]),
      ),
    )
    .orderBy(asc(records.id))
    .limit(RECORD_PAGE);
  const read = await readRecords(
    tx,
    scope.access,
    ids.map((row) => row.id),
    { attributes: new Map([[objectId, attributes]]), attributeIds: columns.map((column) => column.id) },
  );
  const names = await namesFor(
    tx,
    scope,
    columns,
    read.map((record) => record.values),
  );
  const text = read
    .map((record) =>
      csvJoin([
        csvCell(record.id),
        ...columns.map((column) =>
          csvCell(exportCell(column, record.values[column.id], names), guardsType(column.type)),
        ),
      ]),
    )
    .join('');
  return {
    header: line(['Record ID', ...columns.map((column) => column.title)]),
    text,
    rows: read.length,
    last: ids.at(-1)?.id,
    isLast: ids.length < RECORD_PAGE,
  };
}

/** A page of a list's live entries, read through the door: the entry, its record, and the list's own fields. */
async function entriesPage(context: WriteContext, listId: string, after: string | undefined): Promise<Page> {
  const { tx, scope } = context;
  const attributes = [...(await loadListAttributes(tx, listId)).values()].filter((each) => !isArchivedNow(each));
  const ids = await tx
    .select({ id: listEntries.id })
    .from(listEntries)
    .innerJoin(records, eq(records.id, listEntries.recordId))
    .where(
      and(
        eq(listEntries.listId, listId),
        isNull(listEntries.deletedAt),
        isNull(records.deletedAt),
        ...(after === undefined ? [] : [gt(listEntries.id, after)]),
      ),
    )
    .orderBy(asc(listEntries.id))
    .limit(ROW_PAGE);
  const entries = await readEntriesById(
    tx,
    scope.access,
    ids.map((row) => row.id),
  );
  const names = await namesFor(
    tx,
    scope,
    attributes,
    entries.map((entry) => entry.values),
  );
  const text = entries
    .map((entry) =>
      csvJoin([
        csvCell(entry.id),
        csvCell(entry.recordId),
        csvCell(entry.createdAt),
        ...attributes.map((attribute) =>
          csvCell(exportCell(attribute, entry.values[attribute.id], names), guardsType(attribute.type)),
        ),
      ]),
    )
    .join('');
  return {
    header: line(['Entry ID', 'Record ID', 'Added', ...attributes.map((attribute) => attribute.title)]),
    text,
    rows: entries.length,
    last: ids.at(-1)?.id,
    isLast: ids.length < ROW_PAGE,
  };
}

/** A row a raw statement answers: its id (the keyset cursor), and its other columns as Postgres gave them. */
type Row = Readonly<Record<string, unknown>> & { readonly id: string };

/** A column's text for a CSV cell: text as it is, a number written plain, anything else empty. */
const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** A keyset page of rows by a raw statement, answered as CSV or JSON lines. */
async function rowsPage(
  tx: WorkspaceTx,
  query: (after: string | undefined, limit: number) => ReturnType<typeof sql>,
  after: string | undefined,
  write: (row: Row) => string,
  header: string,
): Promise<Page> {
  const found = await tx.execute<Row>(query(after, ROW_PAGE));
  return {
    header,
    text: found.rows.map((row) => write(row)).join(''),
    rows: found.rows.length,
    last: found.rows.at(-1)?.id,
    isLast: found.rows.length < ROW_PAGE,
  };
}

/** `and id > after`, or nothing for the first page. */
const afterId = (column: string, after: string | undefined) =>
  after === undefined ? sql`` : sql`and ${sql.raw(column)} > ${after}::uuid`;

/** One page of the file being written. */
async function pageOf(context: WriteContext, file: PlannedFile, after: string | undefined): Promise<Page> {
  const { tx, scope } = context;
  const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : '';
  switch (file.kind) {
    case 'records':
      return recordsPage(context, file.sourceId ?? '', after);
    case 'entries':
      return entriesPage(context, file.sourceId ?? '', after);
    case 'relationships':
      return rowsPage(
        tx,
        (from, limit) => sql`
          select l.id::text, a.title as name, fo.api_slug as from_object, l.from_record_id::text as from_id,
                 tobj.api_slug as to_object, l.to_record_id::text as to_id
          from record_links l
          join relationships rel on rel.id = l.relationship_id
          join attributes a on a.id = rel.from_attribute_id
          join records fr on fr.id = l.from_record_id and fr.deleted_at is null
          join records tr on tr.id = l.to_record_id and tr.deleted_at is null
          join objects fo on fo.id = fr.object_id and fo.archived_at is null
          join objects tobj on tobj.id = tr.object_id and tobj.archived_at is null
          where l.active_until is null ${afterId('l.id', from)}
          order by l.id limit ${limit}`,
        after,
        (row) =>
          line([row.id, ...['name', 'from_object', 'from_id', 'to_object', 'to_id'].map((key) => textOf(row[key]))]),
        line(['Link ID', 'Relationship', 'From object', 'From record ID', 'To object', 'To record ID']),
      );
    case 'lists':
      return rowsPage(
        tx,
        (from, limit) => sql`
          select l.id::text, l.name, l.api_slug, o.api_slug as object, l.entry_count
          from lists l join objects o on o.id = l.object_id
          where l.archived_at is null ${afterId('l.id', from)}
          order by l.id limit ${limit}`,
        after,
        (row) => line([row.id, ...['name', 'api_slug', 'object', 'entry_count'].map((key) => textOf(row[key]))]),
        line(['List ID', 'Name', 'Slug', 'Object', 'Entries']),
      );
    case 'notes':
      return rowsPage(
        tx,
        (from, limit) => sql`
          select n.id::text, n.record_id::text as "recordId",
                 coalesce((select array_agg(nr.record_id::text order by nr.position) from note_records nr
                           join records lr on lr.id = nr.record_id and lr.deleted_at is null
                           join objects lo on lo.id = lr.object_id and lo.archived_at is null
                           where nr.note_id = n.id and nr.record_id <> n.record_id), '{}') as "linkedRecordIds",
                 n.kind, n.title, n.content_text as text, n.content,
                 to_char(n.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt",
                 n.duration_minutes as "durationMinutes", n.outcome,
                 n.created_by_member_id::text as "createdByMemberId",
                 to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
                 to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "updatedAt"
          from notes n
          join records r on r.id = n.record_id and r.deleted_at is null
          join objects o on o.id = r.object_id and o.archived_at is null
          where n.deleted_at is null ${afterId('n.id', from)}
          order by n.id limit ${limit}`,
        after,
        jsonLine,
        '',
      );
    case 'tasks':
      // As `taskVisible` reads a task: one linking no records at all (none lost to a purge), one with a live linked
      // record, or one the owner made or holds. A task whose links all went is its creator's and assignee's only.
      return rowsPage(
        tx,
        (from, limit) => sql`
          select t.id::text, t.title, t.description, t.is_done as "isDone",
                 to_char(t.done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "doneAt",
                 to_char(t.due_on, 'YYYY-MM-DD') as "dueOn",
                 t.assignee_member_id::text as "assigneeMemberId",
                 coalesce((select array_agg(tr.record_id::text order by tr.position) from task_records tr
                           join records lr on lr.id = tr.record_id and lr.deleted_at is null
                           join objects lo on lo.id = lr.object_id and lo.archived_at is null
                           where tr.task_id = t.id), '{}') as "recordIds",
                 t.created_by_member_id::text as "createdByMemberId",
                 to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "updatedAt"
          from tasks t
          where t.deleted_at is null
            and (
              t.created_by_member_id = ${me}::uuid or t.assignee_member_id = ${me}::uuid
              or (not t.links_purged and not exists (select 1 from task_records tr where tr.task_id = t.id))
              or exists (
                select 1 from task_records tr
                join records lr on lr.id = tr.record_id and lr.deleted_at is null
                join objects lo on lo.id = lr.object_id and lo.archived_at is null
                where tr.task_id = t.id
              )
            )
            ${afterId('t.id', from)}
          order by t.id limit ${limit}`,
        after,
        jsonLine,
        '',
      );
    case 'comments':
      return rowsPage(
        tx,
        (from, limit) => sql`
          select c.id::text, c.record_id::text as "recordId", c.thread_id::text as "threadId", c.body,
                 to_char(c.resolved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "resolvedAt",
                 c.created_by_member_id::text as "createdByMemberId",
                 to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
                 to_char(c.edited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "editedAt"
          from comments c
          join records r on r.id = c.record_id and r.deleted_at is null
          join objects o on o.id = r.object_id and o.archived_at is null
          where c.deleted_at is null ${afterId('c.id', from)}
          order by c.id limit ${limit}`,
        after,
        jsonLine,
        '',
      );
  }
}

/** The step's failure past the size limit. */
const GREW = { finished: true, failed: { code: 'EXPORT_TOO_LARGE', message: TOO_LARGE } } as const;

/** How many chunks the zip reads at once: about 20 MB of text at most, so one page is held, never a whole file. */
const PARTS_PAGE = 20;

/** Parts `from` to `to` of the zip's text, in order. */
async function readParts(tx: WorkspaceTx, exportId: string, from: number, to: number): Promise<readonly string[]> {
  const rows = await tx
    .select({ part: exportChunks.part, body: exportChunks.body })
    .from(exportChunks)
    .where(and(eq(exportChunks.exportId, exportId), sql`${exportChunks.part} between ${from} and ${to}`))
    .orderBy(asc(exportChunks.part));
  return rows.map((row) => row.body);
}

/** The manifest: what the zip holds, for a person or a program reading it back. */
function manifestOf(
  workspace: { readonly id: string; readonly name: string },
  memberId: string,
  files: readonly PlannedFile[],
  at: string,
): string {
  return `${JSON.stringify(
    {
      format: 'crm-workspace-export',
      version: FORMAT_VERSION,
      workspace,
      exportedAt: at,
      exportedByMemberId: memberId,
      files: files.map((file) => ({ path: file.path, kind: file.kind, rows: file.rows })),
      notes: 'CSV files are UTF-8 with a header row. Cells that start like a formula carry a leading apostrophe.',
    },
    undefined,
    2,
  )}\n`;
}

/**
 * Zips the files' chunks and the manifest, deflated as they are read (`PARTS_PAGE` chunks at a time, the fast
 * level), so only one page of text is held beside the compressed zip.
 */
async function zipFiles(
  tx: WorkspaceTx,
  exportId: string,
  files: readonly PlannedFile[],
  manifest: string,
): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let failed: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error !== null) failed = error;
    else out.push(chunk);
  });
  const entryOf = (path: string) => {
    const entry = new ZipDeflate(path, { level: 1 });
    zip.add(entry);
    return entry;
  };
  entryOf('manifest.json').push(strToU8(manifest), true);
  for (const file of files) {
    const entry = entryOf(file.path);
    // A CSV starts with a byte order mark, so a spreadsheet reads it as UTF-8.
    if (file.path.endsWith('.csv')) entry.push(strToU8('\ufeff'));
    if (file.first >= 0) {
      for (let from = file.first; from <= file.last; from += PARTS_PAGE) {
        const page = await readParts(tx, exportId, from, Math.min(from + PARTS_PAGE - 1, file.last));
        for (const text of page) entry.push(strToU8(text));
      }
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failed !== undefined) throw failed;
  const length = out.reduce((sum, chunk) => sum + chunk.length, 0);
  const whole = new Uint8Array(length);
  let offset = 0;
  for (const chunk of out) {
    whole.set(chunk, offset);
    offset += chunk.length;
  }
  return whole;
}

/**
 * One batch: the first plans the files; each later one writes one page of
 * the file it is on (its header first); once every file is written, the last
 * zips them into the store, keeps the file a day and drops the chunks.
 */
async function exportStep(
  context: WriteContext,
  store: WorkspaceExportStore | undefined,
  exportId: string,
  checkpoint: unknown,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  const gone = { finished: true, failed: { code: 'NOT_FOUND', message: 'The export was deleted before it finished.' } };
  const [held] = await tx
    .select({
      source: exports.source,
      createdByMemberId: exports.createdByMemberId,
      policyKey: exports.policyKey,
      storagePath: exports.storagePath,
    })
    .from(exports)
    .where(eq(exports.id, exportId));
  if (held === undefined || held.source !== 'workspace' || held.storagePath === null) return gone;
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.memberId !== held.createdByMemberId) return gone;
  // Run as the starter as they are now: no longer an owner, or under other access, and it stops.
  if (
    !can(scope.access, 'workspace.export') ||
    scope.access.data.key !== OPEN_KEY ||
    held.policyKey !== exportAccessKey(scope.access)
  ) {
    return {
      finished: true,
      failed: { code: 'FORBIDDEN', message: 'Your access changed while this export was being written. Export again.' },
    };
  }
  const stored = Checkpoint.safeParse(checkpoint);
  if (!stored.success) {
    // A first batch (or one from before a deploy changed the plan) starts the files again, whole.
    await tx.delete(exportChunks).where(eq(exportChunks.exportId, exportId));
    const files = await planFiles(tx);
    const next: Checkpoint = { files: [...files], index: 0, part: 0, bytes: 0, rows: 0 };
    return { finished: false, checkpoint: next, counts: { done: 0 } };
  }
  const at = stored.data;
  const file = at.files[at.index];
  if (file === undefined) {
    // Every file written: the zip, into the store, then the chunks go.
    if (store === undefined) {
      return {
        finished: true,
        failed: { code: 'API_UNAVAILABLE', message: 'File storage isn’t set up here, so the export can’t be kept.' },
      };
    }
    const [workspace] = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId));
    const clock = await tx.execute<{ now: string }>(
      sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
    );
    const manifest = manifestOf(
      workspace ?? { id: scope.workspaceId, name: '' },
      held.createdByMemberId,
      at.files,
      clock.rows[0]?.now ?? '',
    );
    const zipped = await zipFiles(tx, exportId, at.files, manifest);
    // A retried last batch finds its own earlier zip there: take it away first, so the put never meets it.
    await store.remove([held.storagePath]);
    await store.put(held.storagePath, zipped, 'application/zip');
    await tx.delete(exportChunks).where(eq(exportChunks.exportId, exportId));
    await tx
      .update(exports)
      .set({
        rowCount: at.rows,
        byteCount: zipped.length,
        expiresAt: sql`now() + make_interval(hours => ${WORKSPACE_EXPORT_KEPT_HOURS})`,
        updatedAt: sql`now()`,
      })
      .where(eq(exports.id, exportId));
    return {
      finished: true,
      checkpoint: at,
      counts: { done: 0 },
      result: { rows: at.rows, bytes: zipped.length, exportId },
    };
  }
  const page = await pageOf(context, file, at.after);
  const isFirst = file.first < 0;
  const text = (isFirst ? page.header : '') + page.text;
  const bytes = at.bytes + Buffer.byteLength(text);
  if (bytes > WORKSPACE_EXPORT_BYTES_MAX) return GREW;
  const cursor = await appendChunk(tx, scope.workspaceId, exportId, { part: at.part, tail: 0 }, text);
  const wrote = cursor.part > at.part;
  const written: PlannedFile = {
    ...file,
    rows: file.rows + page.rows,
    first: wrote && isFirst ? at.part : file.first,
    last: wrote ? at.part : file.last,
  };
  const files = at.files.map((each, index) => (index === at.index ? written : each));
  const next: Checkpoint = page.isLast
    ? { files, index: at.index + 1, part: cursor.part, bytes, rows: at.rows + page.rows }
    : {
        files,
        index: at.index,
        ...(page.last === undefined ? {} : { after: page.last }),
        part: cursor.part,
        bytes,
        rows: at.rows + page.rows,
      };
  return { finished: false, checkpoint: next, counts: { done: page.rows } };
}

/** `workspace.export`: the owner's, heavy lane, cancellable, one page of one file a batch; the zip into `store`. */
export function workspaceExport(store?: WorkspaceExportStore): KindDefinition<WorkspaceExportParams> {
  return defineKind<WorkspaceExportParams>({
    kind: WORKSPACE_EXPORT,
    lane: 'heavy',
    actor: 'member',
    mode: 'cursor',
    params: WorkspaceExportParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: ROW_PAGE,
    sample: { exportId: '0199f0a0-0000-7000-8000-000000000003' },
    step: (context, { job }) => exportStep(context, store, job.params.exportId, job.checkpoint),
    // A failed export's text goes at once; its row stays (and says how it ended) until its expiry.
    onFailed: async (context, job) => {
      if (job.params === undefined) return;
      await context.tx.delete(exportChunks).where(eq(exportChunks.exportId, job.params.exportId));
    },
  });
}
