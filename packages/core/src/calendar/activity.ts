// Meetings in a record's timeline (spec 0024, AC-608): the `meeting` source of
// spec 0017's merge (rank 6). Each meeting the record shows on is one entry at
// its start, so upcoming meetings sit ahead of today's entries (the feed
// heads them "Upcoming"), with the meeting as the reader may see it (a
// private one they don't hold reads "Private meeting"). The record is
// visible (the timeline's record check), so its meetings are too; a record in
// the trash shows none. Read from `meeting_records_by_record`, newest start
// first, at most `limit + 1`.
import { sql } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, type ActivityItem } from '@crm/contracts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivityBound, ActivitySource } from '../engine/activity.ts';
import { meetingViews, micros } from './meetings.ts';
import { answerWords, shownAnswers } from '../booking/questions.ts';

/** The loose half of the bound, which the index on the start can use. */
const nearBound = (after?: ActivityBound) =>
  after === undefined ? sql`true` : sql`l.starts_at <= ${after.at}::timestamptz`;

/** The record's meetings past the bound, newest start first, each with its view. */
export const meetingSource: ActivitySource = async ({ tx, scope, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.meeting;
  const entryId = sql`'meeting:' || l.meeting_id::text`;
  const rows = await tx.execute<{ meeting_id: string; at: string }>(sql`
    select l.meeting_id::text as meeting_id, ${micros('l.starts_at')} as at
    from meeting_records l
    where l.record_id = ${record.id}::uuid
      and exists (select 1 from records r where r.workspace_id = l.workspace_id and r.id = l.record_id and r.deleted_at is null)
      and ${nearBound(after)} and ${boundSql(sql`l.starts_at`, entryId, rank, after)}
    order by l.starts_at desc, (${entryId}) collate "C"
    limit ${limit + 1}
  `);
  const views = new Map(
    (
      await meetingViews(
        tx,
        scope.access,
        rows.rows.map((row) => row.meeting_id),
      )
    ).map((view) => [view.id, view]),
  );
  // A meeting a booking made carries the visitor's answers (spec 0057, AC-5714): one read for the page's meetings.
  const ids = rows.rows.map((row) => row.meeting_id);
  const booked =
    ids.length === 0
      ? []
      : (
          await tx.execute<{ meeting_id: string; answers: unknown }>(sql`
            select b.meeting_id::text as meeting_id, b.answers
            from bookings b
            where b.meeting_id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[])
              and b.answers ? 'questions'
          `)
        ).rows;
  const shown = await shownAnswers(
    tx,
    scope.access,
    booked.map((each) => each.answers),
  );
  const answersByMeeting = new Map(
    booked.map((each) => [
      each.meeting_id,
      shown(each.answers).flatMap((answer) => {
        const text = answerWords(answer.value);
        return text === '' ? [] : [{ label: answer.label, text }];
      }),
    ]),
  );
  const entries = rows.rows.flatMap((row): ActivityItem[] => {
    const meeting = views.get(row.meeting_id);
    if (meeting === undefined) return [];
    const id = `meeting:${row.meeting_id}`;
    const answers = meeting.detailsHidden ? [] : (answersByMeeting.get(row.meeting_id) ?? []);
    return [
      {
        id,
        key: activityKey({ at: row.at, rank, id }),
        at: toMillis(row.at),
        kind: 'meeting',
        itemId: row.meeting_id,
        title: meeting.title,
        meeting,
        ...(answers.length === 0 ? {} : { answers }),
      },
    ];
  });
  return { entries };
};
