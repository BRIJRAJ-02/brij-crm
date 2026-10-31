// Exporting a form's submissions as CSV (spec 0023 follow-up, in spec 0040's
// export shape): a member starts an export of the submissions a filter
// matches or the ones they named; a `forms.export` job (theirs, heavy lane,
// cancellable) reads them page by page as that member, so only submissions
// and answers they may read are written (hidden means absent), and appends
// the CSV text to `export_chunks`. Columns: when, the id, the state, one
// column per question (the newest published wording first, then questions
// only older versions asked), then the CRM link and where it came from.
// Every text cell is guarded against spreadsheet formulas (`csvCell`). Only
// the member who started an export reads it, for 7 days, and only while their
// access is the one it was written under (`exportAccessKey`); the daily
// cleanup deletes it after.
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import * as z from 'zod';
import {
  answerWords,
  CSV_BOM,
  csvLine,
  EXPORT_ROWS_MAX,
  type ExportView,
  SubmissionSelection,
  type FormDocument,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from '../engine/ids.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { can, fieldLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { appendChunk, checkRecordsSource, writeHeader } from '../exports/chunks.ts';
import { loadVersions } from './shared.ts';
import { answersOf, COLUMNS, crmOf, displays, formFiles, readableForm, visibleRows, type Row } from './submissions.ts';

const { exportChunks, exports, formSubmissions, formVersions } = schema;

/** The export job's name. */
export const FORMS_EXPORT = 'forms.export';

/** How long an export file is kept. */
export const EXPORT_KEPT_DAYS = 7;

/** What an export the caller didn't start, or one that is gone, answers. */
export const UNKNOWN_EXPORT = 'That export doesn’t exist, or it has expired. Export the submissions again.';

/** What an export too big to write answers. */
export const EXPORT_TOO_LARGE = `Export at most ${EXPORT_ROWS_MAX.toLocaleString('en')} submissions at a time; narrow the filter.`;

/** The most exports one member keeps at once (each up to 100,000 rows, in Postgres until R2 arrives). */
export const EXPORTS_KEPT_MAX = 5;

/** What one more export past the cap answers. */
export const TOO_MANY_EXPORTS = `Keep at most ${String(EXPORTS_KEPT_MAX)} exports at a time; each goes ${String(EXPORT_KEPT_DAYS)} days after it was made.`;

/** The most text one export writes (in Postgres until R2 arrives): past it the job stops and says why. */
export const EXPORT_BYTES_MAX = 100 * 1024 * 1024;

/** What an export that grew past a limit while it was written answers. */
export const EXPORT_GREW = `This export grew past ${EXPORT_ROWS_MAX.toLocaleString('en')} submissions or 100 MB while it was written; narrow the filter and export again.`;

/**
 * What an export is written and read under (security review, 21 October 2026): the starter's data policy
 * (object, field and record levels), whether they manage forms (a submission with no record is in the file only
 * then), and their teams (a team rule's reach). Kept on the export; a read or a batch under anything else finds
 * nothing, so a starter who lost access loses the file too.
 */
export function exportAccessKey(access: Access): string {
  const { principal } = access;
  const teams = principal.kind === 'member' ? [...principal.teamIds].sort().join(',') : '';
  // A `team` record rule reaches the records of everyone in the starter's teams (spec 0032, AC-847): when one of the
  // people changes, the file is no longer what the starter may read, so who they are is part of the key.
  const reachesTeammates =
    principal.kind === 'member' && Object.values(access.data.records).some((rule) => rule.kind === 'team');
  const mates =
    principal.kind === 'member' && reachesTeammates
      ? createHash('sha256')
          .update([...(principal.teamMemberIds ?? [])].sort().join(','))
          .digest('hex')
          .slice(0, 16)
      : '';
  return `${access.data.key}|${can(access, 'forms.manage') ? 'manage' : 'read'}|${teams}${mates === '' ? '' : `|${mates}`}`;
}

/** How many submissions one batch reads. */
const PAGE = 200;

/** The context columns after the answers, and the hidden fields they read. */
const HIDDEN_COLUMNS = [
  ['UTM source', 'utm_source'],
  ['UTM medium', 'utm_medium'],
  ['UTM campaign', 'utm_campaign'],
  ['UTM term', 'utm_term'],
  ['UTM content', 'utm_content'],
  ['Page', 'page'],
  ['Referrer', 'referrer'],
] as const;

/** What a state reads as in the file. */
const STATE_LABEL: Readonly<Record<string, string>> = {
  received: 'Received',
  processing: 'Processing',
  processed: 'Processed',
  spam: 'Spam',
  held: 'Held',
  needs_review: 'Needs review',
  failed: 'Failed',
};

/** The member who acts, or a refusal: exports belong to a member. */
function memberIdOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can export submissions.');
  return principal.memberId;
}

/** A file name with nothing a file system or a header refuses. */
function fileNameFor(formName: string, day: string): string {
  const safe =
    formName
      .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim() || 'Form';
  return `${safe.slice(0, 80)} - submissions - ${day}.csv`;
}

/** The SQL a selection reads, beside the form. */
function selectionTest(select: SubmissionSelection): SQL | undefined {
  if (select.kind === 'ids') return inArray(formSubmissions.id, select.submissionIds);
  return and(
    select.state === undefined ? undefined : eq(formSubmissions.state, select.state),
    select.from === undefined ? undefined : sql`${formSubmissions.receivedAt} >= ${select.from}::timestamptz`,
    select.to === undefined ? undefined : sql`${formSubmissions.receivedAt} < ${select.to}::timestamptz`,
  );
}

/** An export row as the services read it. */
const EXPORT_COLUMNS = {
  id: exports.id,
  source: exports.source,
  formId: exports.formId,
  objectId: exports.objectId,
  fileName: exports.fileName,
  jobId: exports.jobId,
  rowCount: exports.rowCount,
  selection: exports.selection,
  createdByMemberId: exports.createdByMemberId,
  policyKey: exports.policyKey,
  expiresAt: sql<string>`to_char(${exports.expiresAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

/** An export as members read it, but its download path (the router knows the workspace's address). */
export type ExportRecord = Omit<ExportView, 'downloadPath'>;

function viewOf(row: {
  readonly id: string;
  readonly formId: string | null;
  readonly fileName: string;
  readonly jobId: string;
  readonly rowCount: number | null;
  readonly expiresAt: string;
}): ExportRecord {
  return {
    id: row.id,
    formId: row.formId ?? '',
    fileName: row.fileName,
    jobId: row.jobId,
    ...(row.rowCount === null ? {} : { rowCount: row.rowCount }),
    expiresAt: row.expiresAt,
  };
}

/** The caller's own live export (of submissions or of records, spec 0040), or NOT_FOUND. */
export async function ownExport(tx: WorkspaceTx, scope: EngineScope, exportId: string) {
  const me = memberIdOf(scope);
  const [row] = await tx
    .select(EXPORT_COLUMNS)
    .from(exports)
    .where(
      and(
        eq(exports.id, checkId(exportId, UNKNOWN_EXPORT)),
        eq(exports.createdByMemberId, me),
        sql`${exports.expiresAt} > now()`,
      ),
    );
  // Hidden means absent: under a different access than it was written with (an object, a field or a record
  // rule changed, forms.manage lost, another team), or with its form out of sight, the file is gone for its
  // starter too.
  if (row === undefined || row.policyKey !== exportAccessKey(scope.access)) {
    throw refuse('NOT_FOUND', UNKNOWN_EXPORT);
  }
  // A records export (spec 0040): its object live and still readable.
  if (row.source === 'records' && row.objectId !== null) {
    await checkRecordsSource(tx, scope, row.objectId);
    return row;
  }
  if (row.formId === null) throw refuse('NOT_FOUND', UNKNOWN_EXPORT);
  try {
    await readableForm(tx, scope, row.formId);
  } catch (error) {
    if (isRefusal(error)) throw refuse('NOT_FOUND', UNKNOWN_EXPORT);
    throw error;
  }
  return row;
}

/**
 * Starts an export of a form's submissions (any member who can see the
 * form): the export's row and its `forms.export` job, in one write. The same
 * id again answers the same export. More than `EXPORT_ROWS_MAX` matching
 * submissions is refused before anything starts.
 */
export async function startSubmissionsExport(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly id: string; readonly formId: string; readonly select: SubmissionSelection },
  hooks: readonly AfterWrite[] = [],
): Promise<ExportRecord> {
  const me = memberIdOf(scope);
  const exportId = checkId(input.id, UNKNOWN_EXPORT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [held] = await tx.select({ id: exports.id }).from(exports).where(eq(exports.id, exportId));
      // The same id again: the same export, through every check a read makes (its starter, kept, the same access).
      if (held !== undefined) {
        const own = await ownExport(tx, scope, exportId);
        if (own.source !== 'form_submissions') throw refuse('NOT_FOUND', UNKNOWN_EXPORT);
        return viewOf(own);
      }
      const form = await readableForm(tx, scope, input.formId);
      // One start at a time per member, so two at once can't both pass the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exports:${me}`}, 0))`);
      // Exports still kept, leaving out any whose job failed or was cancelled: those never give a file.
      const kept = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from exports e
        where e.created_by_member_id = ${me} and e.expires_at > now()
          and not exists (
            select 1 from jobs j
            where j.workspace_id = e.workspace_id and j.id = e.job_id and j.status in ('failed', 'cancelled')
          )
      `);
      if ((kept.rows[0]?.n ?? 0) >= EXPORTS_KEPT_MAX) throw refuse('LIMIT_REACHED', TOO_MANY_EXPORTS);
      const counted = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from (
          select 1 from ${formSubmissions}
          where ${and(eq(formSubmissions.formId, form.id), selectionTest(input.select))}
          limit ${EXPORT_ROWS_MAX + 1}
        ) as matched`);
      if ((counted.rows[0]?.n ?? 0) > EXPORT_ROWS_MAX) throw refuse('JOB_TOO_LARGE', EXPORT_TOO_LARGE);
      const day = await tx.execute<{ day: string }>(sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`);
      const { jobId } = await startJob(context, registry, {
        kind: FORMS_EXPORT,
        params: { exportId },
      });
      const [row] = await tx
        .insert(exports)
        .values({
          workspaceId: scope.workspaceId,
          id: exportId,
          source: 'form_submissions',
          formId: form.id,
          selection: input.select,
          fileName: fileNameFor(form.name, day.rows[0]?.day ?? 'today'),
          jobId,
          createdByMemberId: me,
          policyKey: exportAccessKey(scope.access),
          expiresAt: sql`now() + make_interval(days => ${EXPORT_KEPT_DAYS})`,
        })
        .returning(EXPORT_COLUMNS);
      if (row === undefined) throw new Error('The export row was not stored.');
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** One export the caller started (AC: only its starter sees it). */
export async function getExport(scope: EngineScope, input: { readonly exportId: string }): Promise<ExportRecord> {
  return inWorkspace(scope, async (tx) => {
    const row = await ownExport(tx, scope, input.exportId);
    // A records export (spec 0040) answers through its own service.
    if (row.source !== 'form_submissions') throw refuse('NOT_FOUND', UNKNOWN_EXPORT);
    return viewOf(row);
  });
}

/**
 * A finished export the caller started, for its download: the file's name
 * and how many chunks it holds. NOT_FOUND for anyone else, an expired one, or
 * one still being written.
 */
export async function exportFile(
  scope: EngineScope,
  input: { readonly exportId: string },
): Promise<{ readonly fileName: string; readonly parts: number }> {
  return inWorkspace(scope, async (tx) => {
    const row = await ownExport(tx, scope, input.exportId);
    if (row.rowCount === null) throw refuse('NOT_FOUND', 'This export is still being written. Try again shortly.');
    const [count] = await tx
      .select({ parts: sql<number>`count(*)::int` })
      .from(exportChunks)
      .where(eq(exportChunks.exportId, row.id));
    return { fileName: row.fileName, parts: count?.parts ?? 0 };
  });
}

/** One chunk of a finished export the caller started, by its part (from 0). */
export async function exportPart(
  scope: EngineScope,
  input: { readonly exportId: string; readonly part: number },
): Promise<string> {
  return inWorkspace(scope, async (tx) => {
    const row = await ownExport(tx, scope, input.exportId);
    const [chunk] = await tx
      .select({ body: exportChunks.body })
      .from(exportChunks)
      .where(and(eq(exportChunks.exportId, row.id), eq(exportChunks.part, input.part)));
    return chunk?.body ?? '';
  });
}

/** The export job's params: the export it writes. */
export const FormsExportParams = z.strictObject({ exportId: z.uuid() });
/** The export job's params. */
export type FormsExportParams = z.infer<typeof FormsExportParams>;

/** One answer column: the question's key and its label. */
const Column = z.object({ key: z.string(), label: z.string() });

/** Where an export got to: its answer columns, the last row written (keyset), the next chunk, the totals. */
const Checkpoint = z.object({
  columns: z.array(Column),
  after: z.object({ at: z.string(), id: z.uuid() }).optional(),
  part: z.number().int().min(0),
  /** The bytes in the last data chunk (`part - 1`), which a page appends to while it stays small. */
  tail: z.number().int().min(0),
  rows: z.number().int().min(0),
  bytes: z.number().int().min(0),
});
type Checkpoint = z.infer<typeof Checkpoint>;

/**
 * The answer columns: every question of the form's published versions, by
 * key, the newest wording first, leaving out one filed on an attribute the
 * reader can't see (on that version's target object).
 */
async function columnsOf(tx: WorkspaceTx, scope: EngineScope, formId: string): Promise<z.infer<typeof Column>[]> {
  const ids = await tx
    .select({ id: formVersions.id })
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), sql`${formVersions.publishedAt} is not null`))
    .orderBy(desc(formVersions.number));
  const versions = await loadVersions(
    tx,
    ids.map((row) => row.id),
  );
  const seen = new Map<string, z.infer<typeof Column>>();
  const hidden = new Set<string>();
  for (const { id } of ids) {
    const document: FormDocument | undefined = versions.get(id)?.document;
    const objectId = document?.targets.main?.objectId;
    for (const question of document?.questions ?? []) {
      if (seen.has(question.key) || hidden.has(question.key)) continue;
      const attributeId = question.filedOn?.attributeId;
      if (
        attributeId !== undefined &&
        objectId !== undefined &&
        fieldLevel(scope.access, { id: attributeId, objectId }) === 'hidden'
      ) {
        hidden.add(question.key);
        continue;
      }
      seen.set(question.key, { key: question.key, label: question.label });
    }
  }
  return [...seen.values()];
}

/** An answer as a cell: text as itself, yes or no, a number, several values joined, the rest as their words. */
function cellOf(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((each) => String(cellOf(each) ?? '')).join(', ');
  if (typeof value === 'object' && 'number' in value && typeof value.number === 'string') return value.number;
  // A file is its name (its address needs a signed in member); a multi select, an address and a date and time read
  // as the panel reads them (spec 0063).
  const words = answerWords(value);
  return words === '' ? JSON.stringify(value) : words;
}

/** The header line. */
function headerOf(columns: readonly z.infer<typeof Column>[]): string {
  return csvLine([
    'Received at (UTC)',
    'Submission ID',
    'State',
    ...columns.map((column) => column.label),
    'In CRM',
    'CRM record',
    'CRM record ID',
    ...HIDDEN_COLUMNS.map(([label]) => label),
  ]);
}

/** One batch of an export: the header first, then a page of rows, appended as chunks. */
async function exportStep(context: WriteContext, exportId: string, checkpoint: unknown): Promise<StepOutcome> {
  const { tx, scope } = context;
  const [held] = await tx
    .select({ ...EXPORT_COLUMNS })
    .from(exports)
    .where(eq(exports.id, exportId));
  if (held === undefined || held.formId === null) {
    return { finished: true, failed: { code: 'NOT_FOUND', message: 'The export was deleted before it finished.' } };
  }
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.memberId !== held.createdByMemberId) {
    return { finished: true, failed: { code: 'NOT_FOUND', message: 'The export was deleted before it finished.' } };
  }
  if (held.policyKey !== exportAccessKey(scope.access)) {
    return {
      finished: true,
      failed: { code: 'FORBIDDEN', message: 'Your access changed while this export was being written. Export again.' },
    };
  }
  const form = await readableForm(tx, scope, held.formId);
  const select = SubmissionSelection.parse(held.selection);
  const stored = Checkpoint.safeParse(checkpoint);
  let at: Checkpoint;
  if (stored.success) at = stored.data;
  else {
    const columns = await columnsOf(tx, scope, form.id);
    const header = CSV_BOM + headerOf(columns);
    const cursor = await writeHeader(tx, scope.workspaceId, exportId, header);
    at = { columns, ...cursor, rows: 0, bytes: Buffer.byteLength(header) };
  }

  const rows: Row[] = await tx
    .select(COLUMNS)
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.formId, form.id),
        selectionTest(select),
        at.after === undefined
          ? undefined
          : and(
              // The redundant bound lets the index start at the cursor, so a late page costs what an early one does.
              lte(formSubmissions.receivedAt, sql`${at.after.at}::timestamptz`),
              or(
                lt(formSubmissions.receivedAt, sql`${at.after.at}::timestamptz`),
                and(
                  eq(formSubmissions.receivedAt, sql`${at.after.at}::timestamptz`),
                  lt(formSubmissions.id, at.after.id),
                ),
              ),
            ),
      ),
    )
    .orderBy(desc(formSubmissions.receivedAt), desc(formSubmissions.id))
    .limit(PAGE);
  const shown = await visibleRows(tx, scope, rows);
  const files = await formFiles(tx, form);
  const names = await displays(
    tx,
    scope,
    shown.flatMap((row) => (row.mainRecordId === null ? [] : [row.mainRecordId])),
  );
  const versions = await loadVersions(tx, [...new Set(shown.map((row) => row.versionId))]);
  const lines = shown.map((row) => {
    const version = versions.get(row.versionId);
    const answers = new Map(
      (version === undefined ? [] : answersOf(scope, version.document, row.answers)).map((answer) => [
        answer.key,
        answer.value,
      ]),
    );
    const main = row.mainRecordId === null ? undefined : names.get(row.mainRecordId);
    const crm = crmOf(row.state, main, files);
    const hidden = typeof row.hidden === 'object' && row.hidden !== null ? (row.hidden as Record<string, unknown>) : {};
    return csvLine([
      row.receivedMicros,
      row.id,
      STATE_LABEL[row.state] ?? row.state,
      ...at.columns.map((column) => cellOf(answers.get(column.key))),
      crm.state === 'linked' ? 'Yes' : crm.state === 'filing' ? 'Filing' : 'No',
      crm.state === 'linked' ? crm.record.name : undefined,
      crm.state === 'linked' ? crm.record.recordId : undefined,
      ...HIDDEN_COLUMNS.map(([, key]) => {
        const value = hidden[key];
        return typeof value === 'string' ? value : undefined;
      }),
    ]);
  });

  const text = lines.join('');
  // The start counted at most EXPORT_ROWS_MAX; a file that grew past it, or past EXPORT_BYTES_MAX, stops here and
  // says so, rather than ending as a cut file (it never downloads: its row count stays unset).
  if (at.rows + shown.length > EXPORT_ROWS_MAX || at.bytes + Buffer.byteLength(text) > EXPORT_BYTES_MAX) {
    return { finished: true, failed: { code: 'JOB_TOO_LARGE', message: EXPORT_GREW } };
  }
  // One chunk a page (exports/chunks.ts).
  const { part, tail } = await appendChunk(tx, scope.workspaceId, exportId, at, text);
  const bytes = at.bytes + Buffer.byteLength(text);

  const last = rows.at(-1);
  const next: Checkpoint = {
    ...at,
    part,
    tail,
    bytes,
    rows: at.rows + shown.length,
    ...(last === undefined ? {} : { after: { at: last.receivedMicros, id: last.id } }),
  };
  const finished = rows.length < PAGE;
  if (finished) {
    await tx
      .update(exports)
      .set({ rowCount: next.rows, byteCount: next.bytes, updatedAt: sql`now()` })
      .where(eq(exports.id, exportId));
  }
  return {
    finished,
    checkpoint: next,
    // Rows the member can't see are absent, not counted as skipped.
    counts: { done: shown.length },
    result: { rows: next.rows },
  };
}

/** `forms.export`: the member's, heavy lane, cancellable, 200 submissions a batch, read as the member. */
export function formsExport(): KindDefinition<FormsExportParams> {
  return defineKind<FormsExportParams>({
    kind: FORMS_EXPORT,
    lane: 'heavy',
    actor: 'member',
    mode: 'cursor',
    params: FormsExportParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: PAGE,
    sample: { exportId: '0199f0a0-0000-7000-8000-000000000001' },
    step: (context, { job }) => exportStep(context, job.params.exportId, job.checkpoint),
  });
}
