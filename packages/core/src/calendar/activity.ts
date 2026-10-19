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
  const entries = rows.rows.flatMap((row): ActivityItem[] => {
    const meeting = views.get(row.meeting_id);
    if (meeting === undefined) return [];
    const id = `meeting:${row.meeting_id}`;
    return [
      {
        id,
        key: activityKey({ at: row.at, rank, id }),
        at: toMillis(row.at),
        kind: 'meeting',
        itemId: row.meeting_id,
        title: meeting.title,
        meeting,
      },
    ];
  });
  return { entries };
};
