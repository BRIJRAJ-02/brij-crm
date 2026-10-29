// Files visitors upload to public forms (#32). The bytes live in the blob store, which only the api's one wrapper
// touches; this file holds the rows that bind a stored file to its workspace, its form and, once one takes it, its
// submission. Three doors:
// - the public form's own scope prepares, registers and discards an upload (it can read only its own form's rows);
// - `submitForm` claims the uploads its answers name (`claimUploads`): a file answer is only ever the id of an
//   unattached upload on this same form, made within the day, and it becomes the stored file's facts;
// - a member reads one through `readUpload`, which holds only when they could open the submission that took it
//   and the file is among the answers they may see (field level access included), so a link never works across
//   workspaces, nor for a member the submission is hidden from.
import { SPAM_FILES_KEPT_DAYS, UPLOAD_KEPT_HOURS, type FormDocument, type SubmissionView } from '@crm/contracts';
import type { FileValue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import { checkId } from '../engine/ids.ts';
import { refuse, refuseAll } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { loadForm, loadVersions } from './shared.ts';
import { getSubmission, UNKNOWN_SUBMISSION } from './submissions.ts';

const { formUploads } = schema;

/** How many unattached uploads one form may hold at once: past it, uploads wait for the daily cleanup or a submit. */
export const UPLOADS_OPEN_PER_FORM = 200;

/** What a file that doesn't exist, or isn't the reader's to open, answers. */
export const UNKNOWN_FILE = 'That file does not exist.';

/** What an upload the form can't take answers. */
const NOT_TAKING_FILES = 'This form does not take files.';

/** Whether a document asks for a file. */
function asksForFile(document: FormDocument): boolean {
  return document.questions.some((question) => question.answerType === 'file');
}

/** The form's live document when it is live and asks for a file; otherwise the refusal that says why. */
async function liveFileForm(tx: WorkspaceTx, formId: string): Promise<void> {
  const form = await loadForm(tx, formId);
  if (form === undefined || form.liveVersionId === null || form.status === 'draft' || form.status === 'archived') {
    throw refuse('NOT_FOUND', 'That form does not exist.');
  }
  if (form.status !== 'live') throw refuse('FORM_CLOSED', 'This form isn’t taking enquiries right now.');
  const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
  if (live === undefined || !asksForFile(live.document)) throw refuse('NOT_FOUND', NOT_TAKING_FILES);
}

/** Whether the public scope's form is the one `scope` was made for (the public door names exactly one form). */
function ownForm(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope uploads to it.');
  }
}

/**
 * Whether a visitor may upload to this form now: it is live and asks for a file, and holds fewer than
 * `UPLOADS_OPEN_PER_FORM` unattached uploads. `busy` is a rate limit's answer; anything else is a refusal.
 */
export async function prepareUpload(scope: EngineScope, input: { readonly formId: string }): Promise<'ok' | 'busy'> {
  ownForm(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    await liveFileForm(tx, input.formId);
    const [open] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(formUploads)
      .where(and(eq(formUploads.formId, input.formId), isNull(formUploads.submissionId)));
    return (open?.count ?? 0) >= UPLOADS_OPEN_PER_FORM ? 'busy' : 'ok';
  });
}

/** What registering an upload takes: the id and pathname the api chose, and what it checked about the file. */
export interface RegisterUpload {
  readonly formId: string;
  readonly fileId: string;
  readonly pathname: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly ipHash?: string;
}

/**
 * Records a stored file against the form's workspace, unattached until a submission takes it. The form row is
 * locked and the open uploads counted again, so concurrent uploads can't pass `UPLOADS_OPEN_PER_FORM`; `busy` means
 * nothing was recorded and the caller deletes the file it stored.
 */
export async function registerUpload(scope: EngineScope, input: RegisterUpload): Promise<'ok' | 'busy'> {
  ownForm(scope, input.formId);
  return inWorkspace(scope, async (tx) => {
    await liveFileForm(tx, input.formId);
    await loadForm(tx, input.formId, true);
    const [open] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(formUploads)
      .where(and(eq(formUploads.formId, input.formId), isNull(formUploads.submissionId)));
    if ((open?.count ?? 0) >= UPLOADS_OPEN_PER_FORM) return 'busy';
    await tx.insert(formUploads).values({
      workspaceId: scope.workspaceId,
      id: input.fileId,
      formId: input.formId,
      pathname: input.pathname,
      name: input.name,
      size: input.size,
      contentType: input.contentType,
      ipHash: input.ipHash ?? null,
    });
    return 'ok';
  });
}

/**
 * Removes a visitor's own unattached upload (their Remove button): the row goes and its pathname comes back for the
 * api to delete from the store. An id that is attached, another form's or unknown answers undefined, so nothing
 * says which it was.
 */
export async function discardUpload(
  scope: EngineScope,
  input: { readonly formId: string; readonly fileId: string },
): Promise<string | undefined> {
  ownForm(scope, input.formId);
  const id = checkId(input.fileId, UNKNOWN_FILE);
  return inWorkspace(scope, async (tx) => {
    const [gone] = await tx
      .delete(formUploads)
      .where(and(eq(formUploads.id, id), eq(formUploads.formId, input.formId), isNull(formUploads.submissionId)))
      .returning({ pathname: formUploads.pathname });
    return gone?.pathname;
  });
}

/** The uploads a submission's file answers take, so the insert that follows can attach them. */
export interface ClaimedUploads {
  /** The answers with each file answer made the stored file's facts (`FileValue`). */
  readonly answers: Readonly<Record<string, unknown>>;
  /** The ids to attach to the submission once it is stored. */
  readonly ids: readonly string[];
}

/**
 * Turns the file answers of a checked submission into stored files. A file answer is `{ fileId }`; the id must be an
 * unattached upload of this same form made within the day, found under the workspace's row level security and
 * locked, so two submissions can't take one file. One that isn't is a field error on its question (never says why).
 */
export async function claimUploads(
  tx: WorkspaceTx,
  input: {
    readonly formId: string;
    readonly questions: readonly { readonly key: string; readonly answerType: string }[];
    readonly answers: Readonly<Record<string, unknown>>;
    readonly invalid: string;
  },
): Promise<ClaimedUploads> {
  const wanted = input.questions.flatMap((question) => {
    const value = input.answers[question.key];
    if (question.answerType !== 'file' || typeof value !== 'object' || value === null) return [];
    const fileId = (value as { readonly fileId?: unknown }).fileId;
    return typeof fileId === 'string' ? [{ key: question.key, fileId }] : [];
  });
  if (wanted.length === 0) return { answers: input.answers, ids: [] };
  const rows = await tx
    .select({
      id: formUploads.id,
      name: formUploads.name,
      size: formUploads.size,
      contentType: formUploads.contentType,
    })
    .from(formUploads)
    .where(
      and(
        inArray(
          formUploads.id,
          wanted.map((each) => each.fileId),
        ),
        eq(formUploads.formId, input.formId),
        isNull(formUploads.submissionId),
        sql`${formUploads.createdAt} > now() - make_interval(hours => ${UPLOAD_KEPT_HOURS})`,
      ),
    )
    .for('update');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const answers: Record<string, unknown> = { ...input.answers };
  const missing: Record<string, string> = {};
  const seen = new Set<string>();
  for (const each of wanted) {
    const row = byId.get(each.fileId);
    if (row === undefined || seen.has(row.id)) {
      missing[each.key] = input.invalid;
      continue;
    }
    seen.add(row.id);
    const value: FileValue = { fileId: row.id, name: row.name, size: row.size, contentType: row.contentType };
    answers[each.key] = value;
  }
  const [first, ...rest] = Object.entries(missing).map(([field, message]) => ({
    code: 'ATTRIBUTE_VALUE_INVALID' as const,
    message,
    field,
  }));
  if (first !== undefined) throw refuseAll([first, ...rest]);
  return { answers, ids: [...seen] };
}

/** How many files one form keeps on submissions judged spam, over the days they are kept (`SPAM_FILES_KEPT_DAYS`). */
export const SPAM_FILES_PER_FORM = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The file answers of a submission a bot signal judged spam, quarantined with it (late trap #52): a real visitor
 * that signal caught (autofill in the honeypot) is released later, and their file has to be there to file. Each
 * file is claimed on its own, so one stale or taken id drops only itself; an id that isn't one is dropped, never
 * an error (a bot is told nothing). Past `SPAM_FILES_PER_FORM` files already kept on this form's spam, none is
 * claimed, so failing the bot checks never buys storage. Answers without their file keep no file key.
 */
export async function claimSpamUploads(
  tx: WorkspaceTx,
  input: {
    readonly formId: string;
    readonly questions: readonly { readonly key: string; readonly answerType: string }[];
    readonly answers: Readonly<Record<string, unknown>>;
  },
): Promise<ClaimedUploads> {
  const fileKeys = new Set(input.questions.filter((each) => each.answerType === 'file').map((each) => each.key));
  const answers: Record<string, unknown> = Object.fromEntries(
    Object.entries(input.answers).filter(([key]) => !fileKeys.has(key)),
  );
  const wanted = [...fileKeys].flatMap((key) => {
    const value = input.answers[key];
    const fileId =
      typeof value === 'object' && value !== null ? (value as { readonly fileId?: unknown }).fileId : undefined;
    return typeof fileId === 'string' && UUID.test(fileId) ? [{ key, fileId: fileId.toLowerCase() }] : [];
  });
  if (wanted.length === 0) return { answers, ids: [] };
  // One form's spam claims in turn, so a burst can't each read 199 and pass the cap together.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`spam-files:${input.formId}`}, 0))`);
  const kept = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from form_uploads u
    join form_submissions s on s.workspace_id = u.workspace_id and s.id = u.submission_id
    where u.form_id = ${input.formId}::uuid and s.state = 'spam'
      and u.created_at > now() - make_interval(days => ${SPAM_FILES_KEPT_DAYS + 1})
      and s.received_at > now() - make_interval(days => ${SPAM_FILES_KEPT_DAYS})
  `);
  if ((kept.rows[0]?.n ?? 0) >= SPAM_FILES_PER_FORM) return { answers, ids: [] };
  const ids: string[] = [];
  for (const each of wanted) {
    if (ids.includes(each.fileId)) continue;
    const [row] = await tx
      .select({
        id: formUploads.id,
        name: formUploads.name,
        size: formUploads.size,
        contentType: formUploads.contentType,
      })
      .from(formUploads)
      .where(
        and(
          eq(formUploads.id, each.fileId),
          eq(formUploads.formId, input.formId),
          isNull(formUploads.submissionId),
          sql`${formUploads.createdAt} > now() - make_interval(hours => ${UPLOAD_KEPT_HOURS})`,
        ),
      )
      .for('update');
    if (row === undefined) continue;
    const value: FileValue = { fileId: row.id, name: row.name, size: row.size, contentType: row.contentType };
    answers[each.key] = value;
    ids.push(row.id);
  }
  return { answers, ids };
}

/** Binds claimed uploads to the submission that took them. */
export async function attachUploads(
  tx: WorkspaceTx,
  input: { readonly submissionId: string; readonly ids: readonly string[] },
): Promise<void> {
  if (input.ids.length === 0) return;
  await tx
    .update(formUploads)
    .set({ submissionId: input.submissionId })
    .where(and(inArray(formUploads.id, [...input.ids]), isNull(formUploads.submissionId)));
}

/** A stored file a member may download: where it is kept and how to name it. */
export interface ReadableUpload {
  readonly pathname: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** Whether a submission's visible answers hold this file (field level access has already left out hidden ones). */
function holdsFile(view: SubmissionView, fileId: string): boolean {
  return view.answers.some((answer) => {
    const value = answer.value;
    return (
      answer.answerType === 'file' &&
      typeof value === 'object' &&
      value !== null &&
      (value as { readonly fileId?: unknown }).fileId === fileId
    );
  });
}

/**
 * The file for a member to download, or NOT_FOUND. The file must be attached to a submission, the member must be
 * able to open that submission (its form's objects, its main record, `forms.manage` for one with no record), and the
 * file must be among the answers they may see. The row is read under the member's workspace, so another workspace's
 * id finds nothing.
 */
export async function readUpload(scope: EngineScope, input: { readonly fileId: string }): Promise<ReadableUpload> {
  const id = checkId(input.fileId, UNKNOWN_FILE);
  const found = await inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(formUploads).where(eq(formUploads.id, id));
    return row;
  });
  if (found === undefined || found.submissionId === null) throw refuse('NOT_FOUND', UNKNOWN_FILE);
  try {
    const view = await getSubmission(scope, { submissionId: found.submissionId });
    if (!holdsFile(view, id)) throw refuse('NOT_FOUND', UNKNOWN_FILE);
  } catch (error) {
    // The submission being hidden from this member reads exactly as the file not existing.
    if (error instanceof Error && error.message === UNKNOWN_SUBMISSION) throw refuse('NOT_FOUND', UNKNOWN_FILE);
    throw error;
  }
  return { pathname: found.pathname, name: found.name, size: found.size, contentType: found.contentType };
}

/** The store the daily cleanup removes files from: the api's wrapper, passed in so core stays free of I/O. */
export interface UploadStore {
  /** Deletes stored files by pathname; a pathname already gone is not an error. */
  remove(pathnames: readonly string[]): Promise<void>;
}
