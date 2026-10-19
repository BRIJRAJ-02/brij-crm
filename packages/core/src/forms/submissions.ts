// A form's submissions, for members (spec 0023, milestone 1, AC-572,
// AC-573): a page newest first (optionally one state), one in full, retrying
// a failed one and deleting one. A member sees a submission when they can
// read its main record; one with no main record yet (received, spam,
// failed) only with `forms.manage`. Answers to attributes the reader can't
// see are left out, the same rule as everywhere else (hidden means absent).
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import {
  SUBMISSIONS_PAGE,
  type FormDocument,
  type SubmissionAnswer,
  type SubmissionPage,
  type SubmissionRecord,
  type SubmissionState,
  type SubmissionSummary,
  type SubmissionView,
} from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import * as z from 'zod';
import { checkId } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { can, fieldLevel, objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { visibleRecords } from '../access/visibility.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { UNKNOWN_FORM } from './forms.ts';
import { FORMS_PROCESS } from './process.ts';
import { loadForm, loadVersions, millis } from './shared.ts';

const { formSubmissionRecords, formSubmissions } = schema;

/** What a submission the reader can't see, or one that doesn't exist, answers. */
export const UNKNOWN_SUBMISSION = 'That submission does not exist.';

/** What a cursor the server didn't make answers, on the `cursor` field. */
export const SUBMISSION_CURSOR_MESSAGE = 'That cursor is not valid here. Start again from the top.';

const Cursor = z.strictObject({ at: z.string().max(40), id: z.uuid() });

const encodeCursor = (at: string, id: string) => Buffer.from(JSON.stringify({ at, id })).toString('base64url');

function decodeCursor(cursor: string): z.infer<typeof Cursor> {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw inputInvalid('cursor', SUBMISSION_CURSOR_MESSAGE);
  }
}

interface Row {
  readonly id: string;
  readonly formId: string;
  readonly versionId: string;
  readonly state: SubmissionState;
  readonly answers: unknown;
  readonly hidden: unknown;
  readonly spam: unknown;
  readonly mainRecordId: string | null;
  readonly assignment: unknown;
  readonly outcome: unknown;
  readonly failure: string | null;
  readonly receivedAt: string;
  readonly receivedMicros: string;
  readonly processedAt: string | null;
}

const COLUMNS = {
  id: formSubmissions.id,
  formId: formSubmissions.formId,
  versionId: formSubmissions.versionId,
  state: sql<SubmissionState>`${formSubmissions.state}`,
  answers: formSubmissions.answers,
  hidden: formSubmissions.hidden,
  spam: formSubmissions.spam,
  mainRecordId: formSubmissions.mainRecordId,
  assignment: formSubmissions.assignment,
  outcome: formSubmissions.outcome,
  failure: formSubmissions.failure,
  receivedAt: sql<string>`${millis('form_submissions.received_at')}`,
  receivedMicros: sql<string>`to_char(${formSubmissions.receivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  processedAt: sql<string | null>`${millis('form_submissions.processed_at')}`,
};

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const verdictOf = (spam: unknown): SubmissionSummary['verdict'] => {
  const verdict = record(spam).verdict;
  return verdict === 'spam' || verdict === 'unchecked' ? verdict : 'passed';
};

/** The rows the reader may see: a visible main record, or none yet and `forms.manage`. */
async function visibleRows(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  rows: readonly Row[],
): Promise<readonly Row[]> {
  const manages = can(scope.access, 'forms.manage');
  const withRecord = rows.flatMap((row) => (row.mainRecordId === null ? [] : [row.mainRecordId]));
  const seen = await visibleRecords(
    tx,
    scope.access,
    withRecord.map((recordId) => ({ objectId, recordId })),
  );
  return rows.filter((row) => (row.mainRecordId === null ? manages : seen.has(row.mainRecordId)));
}

/** Records' displays, by id, as every read names them (only live ones the reader may see). */
async function displays(
  tx: WorkspaceTx,
  scope: EngineScope,
  ids: readonly string[],
): Promise<ReadonlyMap<string, RecordRefDisplay>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const views = await readRecords(tx, scope.access, unique, { attributeIds: [] });
  return new Map(views.map((view) => [view.id, view.display]));
}

/** The answers the reader may see, in the form's question order (AC-573: one filed on a field hidden from them is absent). */
function answersOf(scope: EngineScope, objectId: string, document: FormDocument, stored: unknown): SubmissionAnswer[] {
  const answers = record(stored);
  return document.questions.flatMap((question): SubmissionAnswer[] => {
    if (!Object.hasOwn(answers, question.key)) return [];
    const attributeId = question.filedOn?.attributeId;
    if (attributeId !== undefined && fieldLevel(scope.access, { id: attributeId, objectId }) === 'hidden') return [];
    return [
      {
        questionId: question.id,
        key: question.key,
        label: question.label,
        answerType: question.answerType,
        ...(attributeId === undefined ? {} : { attributeId }),
        value: answers[question.key],
      },
    ];
  });
}

/** The email answer, and the first two answers beside it, for a list row. */
function summaryOf(answers: readonly SubmissionAnswer[]): { email?: string; firstAnswers: SubmissionAnswer[] } {
  const email = answers.find((answer) => answer.answerType === 'email' && typeof answer.value === 'string');
  const firstAnswers = answers.filter((answer) => answer !== email).slice(0, 2);
  return { ...(typeof email?.value === 'string' ? { email: email.value } : {}), firstAnswers };
}

/** A form the reader may see, or NOT_FOUND. */
async function readableForm(tx: WorkspaceTx, scope: EngineScope, formId: string) {
  const form = await loadForm(tx, checkId(formId, UNKNOWN_FORM));
  if (form === undefined || objectLevel(scope.access, form.mainObjectId) === 'none') {
    throw refuse('NOT_FOUND', UNKNOWN_FORM);
  }
  return form;
}

/** A page of a form's submissions, newest first, optionally one state only (AC-572). */
export async function listSubmissions(
  scope: EngineScope,
  input: {
    readonly formId: string;
    readonly state?: SubmissionState;
    readonly cursor?: string;
    readonly limit?: number;
  },
): Promise<SubmissionPage> {
  const limit = Math.min(input.limit ?? SUBMISSIONS_PAGE, SUBMISSIONS_PAGE);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  return inWorkspace(scope, async (tx) => {
    const form = await readableForm(tx, scope, input.formId);
    const rows: Row[] = await tx
      .select(COLUMNS)
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.formId, form.id),
          input.state === undefined ? undefined : eq(formSubmissions.state, input.state),
          after === undefined
            ? undefined
            : or(
                lt(formSubmissions.receivedAt, sql`${after.at}::timestamptz`),
                and(eq(formSubmissions.receivedAt, sql`${after.at}::timestamptz`), lt(formSubmissions.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(formSubmissions.receivedAt), desc(formSubmissions.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const shown = await visibleRows(tx, scope, form.mainObjectId, page);
    const names = await displays(
      tx,
      scope,
      shown.flatMap((row) => (row.mainRecordId === null ? [] : [row.mainRecordId])),
    );
    const versions = await loadVersions(tx, [...new Set(shown.map((row) => row.versionId))]);
    const items = shown.map((row): SubmissionSummary => {
      const version = versions.get(row.versionId);
      const answers = version === undefined ? [] : answersOf(scope, form.mainObjectId, version.document, row.answers);
      const main = row.mainRecordId === null ? undefined : names.get(row.mainRecordId);
      return {
        id: row.id,
        formId: row.formId,
        state: row.state,
        receivedAt: row.receivedAt,
        ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
        verdict: verdictOf(row.spam),
        ...(main === undefined ? {} : { mainRecord: main }),
        ...summaryOf(answers),
      };
    });
    return {
      items,
      ...(rows.length > limit && last !== undefined ? { nextCursor: encodeCursor(last.receivedMicros, last.id) } : {}),
    };
  });
}

/** One submission in full, as the reader may see it, read inside an open transaction. */
async function viewIn(tx: WorkspaceTx, scope: EngineScope, submissionId: string): Promise<SubmissionView> {
  const [row] = await tx
    .select(COLUMNS)
    .from(formSubmissions)
    .where(eq(formSubmissions.id, checkId(submissionId, UNKNOWN_SUBMISSION)));
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_SUBMISSION);
  const form = await loadForm(tx, row.formId);
  if (form === undefined || objectLevel(scope.access, form.mainObjectId) === 'none') {
    throw refuse('NOT_FOUND', UNKNOWN_SUBMISSION);
  }
  const [visible] = await visibleRows(tx, scope, form.mainObjectId, [row]);
  if (visible === undefined) throw refuse('NOT_FOUND', UNKNOWN_SUBMISSION);
  const version = (await loadVersions(tx, [row.versionId])).get(row.versionId);
  const answers = version === undefined ? [] : answersOf(scope, form.mainObjectId, version.document, row.answers);
  const touched = await tx
    .select({
      recordId: formSubmissionRecords.recordId,
      action: sql<SubmissionRecord['action']>`${formSubmissionRecords.action}`,
      role: sql<SubmissionRecord['role']>`${formSubmissionRecords.role}`,
      objectId: formSubmissionRecords.objectId,
    })
    .from(formSubmissionRecords)
    .where(eq(formSubmissionRecords.submissionId, row.id));
  const seen = await visibleRecords(
    tx,
    scope.access,
    touched.map((each) => ({ objectId: each.objectId, recordId: each.recordId })),
  );
  const names = await displays(
    tx,
    scope,
    touched.flatMap((each) => (seen.has(each.recordId) ? [each.recordId] : [])),
  );
  const records = touched.flatMap((each): SubmissionRecord[] => {
    const display = names.get(each.recordId);
    return display === undefined ? [] : [{ role: each.role, action: each.action, record: display }];
  });
  const main = row.mainRecordId === null ? undefined : names.get(row.mainRecordId);
  const hidden = Object.fromEntries(
    Object.entries(record(row.hidden)).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
  );
  const signals = record(row.spam).signals;
  const shownQuestions = new Set(answers.map((answer) => answer.questionId));
  const refusedList = record(row.outcome).refused;
  const refused = (Array.isArray(refusedList) ? refusedList : []).flatMap((item) => {
    const { questionId, message } = record(item);
    return typeof questionId === 'string' && typeof message === 'string' && shownQuestions.has(questionId)
      ? [{ questionId, message }]
      : [];
  });
  const assignment = record(row.assignment);
  return {
    id: row.id,
    formId: row.formId,
    state: row.state,
    receivedAt: row.receivedAt,
    ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
    verdict: verdictOf(row.spam),
    ...(main === undefined ? {} : { mainRecord: main }),
    ...summaryOf(answers),
    versionNumber: version?.number ?? 1,
    answers,
    hidden,
    signals: Array.isArray(signals) ? signals.filter((signal): signal is string => typeof signal === 'string') : [],
    records,
    ...(row.failure === null ? {} : { failure: row.failure }),
    refused,
    ...(typeof assignment.reason === 'string'
      ? {
          assignment: {
            reason: assignment.reason,
            ...(typeof assignment.memberId === 'string' ? { memberId: assignment.memberId } : {}),
          },
        }
      : {}),
  };
}

/** One submission in full (AC-573). */
export async function getSubmission(
  scope: EngineScope,
  input: { readonly submissionId: string },
): Promise<SubmissionView> {
  return inWorkspace(scope, (tx) => viewIn(tx, scope, input.submissionId));
}

/** Locks a submission the reader may see, for a change. */
async function lockedSubmission(tx: WorkspaceTx, scope: EngineScope, submissionId: string) {
  const id = checkId(submissionId, UNKNOWN_SUBMISSION);
  await viewIn(tx, scope, id);
  const [row] = await tx
    .select({ id: formSubmissions.id, state: formSubmissions.state })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, id))
    .for('update');
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_SUBMISSION);
  return row;
}

/** Moves a submission back to `received` with a new job: a release from spam, or a retry of a failed one. */
async function requeue(
  scope: EngineScope,
  registry: JobRegistry,
  submissionId: string,
  from: SubmissionState,
  wrong: string,
  hooks: readonly AfterWrite[],
): Promise<SubmissionView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await lockedSubmission(tx, scope, submissionId);
      if (row.state !== from) throw refuse('FORM_STATE', wrong);
      await tx
        .update(formSubmissions)
        .set({ state: 'received', failure: null, updatedAt: sql`now()` })
        .where(eq(formSubmissions.id, row.id));
      await startJob(context, registry, { kind: FORMS_PROCESS, params: { submissionId: row.id } });
      return viewIn(tx, scope, row.id);
    },
    hooks,
  );
  return result;
}

/** Releases a spam submission (AC-574): it is processed as any other. */
export async function releaseSubmission(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly submissionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<SubmissionView> {
  requirePermission(scope, 'forms.manage');
  return requeue(
    scope,
    registry,
    input.submissionId,
    'spam',
    'Only a submission marked as spam can be released.',
    hooks,
  );
}

/**
 * Marks a submission as spam (AC-574). Records it already made stay (moving
 * them to the trash waits for milestone 2); a waiting one is never processed.
 */
export async function markSubmissionSpam(
  scope: EngineScope,
  input: { readonly submissionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<SubmissionView> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const row = await lockedSubmission(tx, scope, input.submissionId);
      if (row.state === 'spam') throw refuse('FORM_STATE', 'This submission is already marked as spam.');
      await tx
        .update(formSubmissions)
        .set({
          state: 'spam',
          processedAt: null,
          spam: sql`${formSubmissions.spam} || '{"verdict":"spam","marked":true}'::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(eq(formSubmissions.id, row.id));
      return viewIn(tx, scope, row.id);
    },
    hooks,
  );
  return result;
}

/** Processes a failed submission again (AC-566): back to `received`, with a new job. */
export async function retrySubmission(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly submissionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<SubmissionView> {
  requirePermission(scope, 'forms.manage');
  return requeue(scope, registry, input.submissionId, 'failed', 'Only a failed submission can be retried.', hooks);
}

/** Deletes a submission (AC-575): its answers go; the records it created stay. */
export async function deleteSubmission(
  scope: EngineScope,
  input: { readonly submissionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly deleted: true }> {
  requirePermission(scope, 'forms.manage');
  await runWrite(
    scope,
    async ({ tx }) => {
      const row = await lockedSubmission(tx, scope, input.submissionId);
      await tx.delete(formSubmissions).where(eq(formSubmissions.id, row.id));
    },
    hooks,
  );
  return { deleted: true };
}
