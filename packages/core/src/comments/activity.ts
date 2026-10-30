// Comments in a record's timeline (spec 0038 beside spec 0017's merge, the
// flow pass of 30 Oct 2026): the `comment` source (rank 3). Each live thread
// on the record shows once, at the moment it was started, by whoever started
// it ("commented"), with the start of its first comment; clicking it opens
// the thread (`?thread=`). Replies stay in the thread. The record is visible
// (the timeline's record check), so its threads are too; a thread whose
// first comment was deleted is left out, and a record in the trash shows none.
import { sql } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, type ActivityItem } from '@crm/contracts';
import { excerptOf } from '@crm/contracts/mentions';
import type { Actor } from '../engine/scope.ts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivitySource } from '../engine/activity.ts';

/** The most characters of a thread's first comment an entry shows (a mention counts as one). */
export const COMMENT_ENTRY_EXCERPT = 200;

/** A moment as fixed width UTC text with microseconds: it keys the timeline. */
const micro = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

interface ThreadRow extends Record<string, unknown> {
  readonly thread_id: string;
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
  readonly head: string;
}

/** The record's newest thread starts past the bound, at most `limit + 1`, through `comments_by_record`. */
export const commentSource: ActivitySource = async ({ tx, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.comment;
  const entryId = sql`'comment:' || c.id::text`;
  const rows = await tx.execute<ThreadRow>(sql`
    select c.id::text as thread_id, ${micro('c.created_at')} as at, c.created_by_type as actor_type,
      c.created_by_id::text as actor_id, left(c.body, 2000) as head
    from comments c
    where c.record_id = ${record.id}::uuid and c.id = c.thread_id and c.deleted_at is null
      and exists (select 1 from records r where r.workspace_id = c.workspace_id and r.id = c.record_id and r.deleted_at is null)
      and ${after === undefined ? sql`true` : sql`c.created_at <= ${after.at}::timestamptz`}
      and ${boundSql(sql`c.created_at`, entryId, rank, after)}
    order by c.created_at desc, (${entryId}) collate "C"
    limit ${limit + 1}
  `);
  const entries = rows.rows.map((row): ActivityItem => {
    const id = `comment:${row.thread_id}`;
    return {
      id,
      key: activityKey({ at: row.at, rank, id }),
      at: toMillis(row.at),
      actor: { type: row.actor_type, id: row.actor_id },
      kind: 'comment',
      itemId: row.thread_id,
      // Mentions stay as tokens: the browser names each member from its list, as the thread does.
      excerpt: excerptOf(row.head, COMMENT_ENTRY_EXCERPT),
    };
  });
  return { entries };
};
