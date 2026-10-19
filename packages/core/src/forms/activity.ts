// Submissions in a record's timeline (spec 0023, AC-561): the `submission`
// source of spec 0017's merge (rank 6). Each submission that touched the
// record shows once, at the moment it was processed, named by its form
// ("Contact us"), with what it did (created, updated, matched) and the form
// as the actor. The record is visible (the timeline's record check); a form
// on an object the viewer can't see still names itself, since the entry is
// about this record.
import { sql, type SQL } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, type ActivityItem } from '@crm/contracts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivityBound, ActivitySource } from '../engine/activity.ts';

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

/**
 * The record's newest submission moments past the bound, at most `limit + 1`,
 * from `form_submission_records_by_record`.
 */
export const submissionSource: ActivitySource = async ({ tx, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.submission;
  const id = sql`'submission:' || l.submission_id::text || ':' || l.role`;
  const rows = await tx.execute<SubmissionMomentRow>(sql`
    select l.submission_id::text, l.role, f.id::text as form_id, f.name as form_name, l.action,
      to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from form_submission_records l
    join forms f on f.workspace_id = l.workspace_id
      and f.id = (select s.form_id from form_submissions s where s.workspace_id = l.workspace_id and s.id = l.submission_id)
    where l.record_id = ${record.id}::uuid
      and ${nearBound(sql`l.created_at`, after)} and ${boundSql(sql`l.created_at`, id, rank, after)}
    order by l.created_at desc, (${id}) collate "C"
    limit ${limit + 1}
  `);
  const entries = rows.rows.map((row): ActivityItem => {
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
    };
  });
  return { entries };
};
