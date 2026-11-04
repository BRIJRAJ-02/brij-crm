// Submissions in a record's timeline (spec 0023, AC-561): the `submission`
// source of spec 0017's merge (rank 6). Each submission that touched the
// record shows once, at the moment it was processed, named by its form
// ("Contact us"), with what it did (created, updated, matched) and the form
// as the actor. The record is visible (the timeline's record check); a form
// on an object the viewer can't see still names itself, since the entry is
// about this record.
//
// The entry carries the answers as words (forms fix a1, 5 November 2026: the
// answers never reached the record page), but only for a reader who may open
// the submission itself: the form is one they can see (`canSeeForm`) and its
// main record is visible to them, the rule `getSubmission` keeps. An answer
// filed on a field hidden from them is absent, as everywhere else.
import { sql, type SQL } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, answerWords, type ActivityItem } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivityBound, ActivitySource } from '../engine/activity.ts';
import type { EngineScope } from '../engine/scope.ts';
import { visibleRecords } from '../access/visibility.ts';
import { canSeeForm, loadForms, loadVersions } from './shared.ts';
import { answersOf } from './submissions.ts';

/** The most answers one timeline entry carries; the submission itself holds the rest. */
export const TIMELINE_ANSWERS_MAX = 20;

/** The longest answer, in characters, an entry carries: the submission holds it whole. */
const ANSWER_TEXT_MAX = 500;

/** The loose half of the bound, which an index on the moment can use. */
const nearBound = (at: SQL, after?: ActivityBound): SQL =>
  after === undefined ? sql`true` : sql`${at} <= ${after.at}::timestamptz`;

interface SubmissionMomentRow extends Record<string, unknown> {
  readonly submission_id: string;
  readonly role: string;
  readonly form_id: string;
  readonly form_name: string;
  readonly action: 'created' | 'updated' | 'matched' | 'linked';
  readonly at: string;
}

/** A submission as its entry's answers read it. */
interface SubmissionAnswersRow extends Record<string, unknown> {
  readonly id: string;
  readonly form_id: string;
  readonly version_id: string;
  readonly answers: unknown;
  readonly main_record_id: string | null;
  readonly main_object_id: string | null;
}

/** Whether the record was made by a submission: its own creation entry then says nothing the submission's doesn't. */
export async function madeBySubmission(tx: WorkspaceTx, recordId: string): Promise<boolean> {
  const found = await tx.execute(sql`
    select 1 from form_submission_records
    where record_id = ${recordId}::uuid and action = 'created'
    limit 1
  `);
  return found.rows.length > 0;
}

/**
 * Each submission's answers as words, by submission id, for the ones the reader may open (see the file's header);
 * a submission they can't open is left out, so its entry names the form and nothing it was told.
 */
async function answersFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  submissionIds: readonly string[],
): Promise<ReadonlyMap<string, { label: string; text: string }[]>> {
  if (submissionIds.length === 0) return new Map();
  const rows = (
    await tx.execute<SubmissionAnswersRow>(sql`
      select s.id::text, s.form_id::text, s.version_id::text, s.answers, s.main_record_id::text,
        r.object_id::text as main_object_id
      from form_submissions s
      left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
      where s.id in (select jsonb_array_elements_text(${JSON.stringify([...new Set(submissionIds)])}::jsonb)::uuid)
        and s.deleted_at is null
    `)
  ).rows;
  const forms = await loadForms(
    tx,
    rows.map((row) => row.form_id),
  );
  const seen = await visibleRecords(
    tx,
    scope.access,
    rows.flatMap((row) =>
      row.main_record_id === null || row.main_object_id === null
        ? []
        : [{ objectId: row.main_object_id, recordId: row.main_record_id }],
    ),
  );
  const open = rows.filter((row) => {
    const form = forms.get(row.form_id);
    return (
      form !== undefined &&
      canSeeForm(scope.access, form) &&
      row.main_record_id !== null &&
      seen.has(row.main_record_id)
    );
  });
  const versions = await loadVersions(
    tx,
    open.map((row) => row.version_id),
  );
  return new Map(
    open.flatMap((row) => {
      const version = versions.get(row.version_id);
      if (version === undefined) return [];
      const words = answersOf(scope, version.document, row.answers)
        .map((answer) => ({
          label: answer.label.trim(),
          text: answerWords(answer.value, { answerType: answer.answerType }).slice(0, ANSWER_TEXT_MAX),
        }))
        .filter((answer) => answer.text.trim() !== '')
        .slice(0, TIMELINE_ANSWERS_MAX);
      return [[row.id, words]];
    }),
  );
}

/**
 * The record's newest submission moments past the bound, at most `limit + 1`,
 * from `form_submission_records_by_record`.
 */
export const submissionSource: ActivitySource = async ({ tx, scope, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.submission;
  const id = sql`'submission:' || l.submission_id::text || ':' || l.role`;
  const rows = await tx.execute<SubmissionMomentRow>(sql`
    select l.submission_id::text, l.role, f.id::text as form_id, f.name as form_name, l.action,
      to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from form_submission_records l
    join forms f on f.workspace_id = l.workspace_id
      and f.id = (
        select s.form_id from form_submissions s
        where s.workspace_id = l.workspace_id and s.id = l.submission_id and s.deleted_at is null
      )
    where l.record_id = ${record.id}::uuid
      and ${nearBound(sql`l.created_at`, after)} and ${boundSql(sql`l.created_at`, id, rank, after)}
    order by l.created_at desc, (${id}) collate "C"
    limit ${limit + 1}
  `);
  const answers = await answersFor(
    tx,
    scope,
    rows.rows.map((row) => row.submission_id),
  );
  const entries = rows.rows.map((row): ActivityItem => {
    const words = answers.get(row.submission_id);
    const entryId = `submission:${row.submission_id}:${row.role}`;
    return {
      id: entryId,
      key: activityKey({ at: row.at, rank, id: entryId }),
      at: toMillis(row.at),
      actor: { type: 'form', id: row.form_id },
      kind: 'submission',
      itemId: row.submission_id,
      formId: row.form_id,
      title: row.form_name,
      action: row.action,
      ...(words === undefined ? {} : { answers: words }),
    };
  });
  return { entries };
};
