// Notes in a record's timeline (spec 0019, AC-444): the `note` source of spec
// 0017's merge (rank 4). Each live note on the record shows once, at the
// moment it was made, by whoever made it ("added a note"), with its title and
// the start of its text; clicking it opens the note. The record is visible
// (the timeline's record check), so its notes are too; a deleted note is gone
// from the timeline, and a record in the trash shows none (AC-446).
import { sql } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, noteExcerpt, type ActivityItem } from '@crm/contracts';
import type { Actor } from '../engine/scope.ts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivitySource } from '../engine/activity.ts';

/** A moment as fixed width UTC text with microseconds: it keys the timeline. */
const micro = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

interface NoteMomentRow extends Record<string, unknown> {
  readonly note_id: string;
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
  readonly title: string;
  readonly head: string;
}

/** The record's newest notes past the bound, at most `limit + 1`, through `notes_by_record_created`. */
export const noteSource: ActivitySource = async ({ tx, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.note;
  const entryId = sql`'note:' || n.id::text`;
  const rows = await tx.execute<NoteMomentRow>(sql`
    select n.id::text as note_id, ${micro('n.created_at')} as at, n.created_by_type as actor_type,
      n.created_by_id::text as actor_id, n.title, left(n.content_text, 600) as head
    from notes n
    where n.record_id = ${record.id}::uuid and n.deleted_at is null
      and exists (select 1 from records r where r.workspace_id = n.workspace_id and r.id = n.record_id and r.deleted_at is null)
      and ${after === undefined ? sql`true` : sql`n.created_at <= ${after.at}::timestamptz`}
      and ${boundSql(sql`n.created_at`, entryId, rank, after)}
    order by n.created_at desc, (${entryId}) collate "C"
    limit ${limit + 1}
  `);
  const entries = rows.rows.map((row): ActivityItem => {
    const id = `note:${row.note_id}`;
    return {
      id,
      key: activityKey({ at: row.at, rank, id }),
      at: toMillis(row.at),
      actor: { type: row.actor_type, id: row.actor_id },
      kind: 'note',
      itemId: row.note_id,
      // The screen shows "Untitled note" for an empty title.
      title: row.title,
      excerpt: noteExcerpt(row.head),
    };
  });
  return { entries };
};
