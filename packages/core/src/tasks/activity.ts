// Tasks in a record's timeline (spec 0019, AC-438): the `task` source of spec
// 0017's merge (rank 5). Each live task linked to the record shows once at the
// moment it was linked ("added a task", by whoever linked it) and, when done,
// once at the moment it was done ("completed a task", by whoever ticked it),
// with its title. Unlinking a task removes both from the record's timeline,
// since the link is what names the record. The record is visible (the
// timeline's record check), so every task linked to it is too; a record in
// the trash has lost its links from every read (AC-446), so it shows none.
import { sql, type SQL } from 'drizzle-orm';
import { ACTIVITY_RANKS, activityKey, type ActivityItem } from '@crm/contracts';
import type { Actor } from '../engine/scope.ts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivityBound, ActivitySource } from '../engine/activity.ts';

/** A moment as fixed width UTC text with microseconds: it keys the timeline. */
const micro = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The loose half of the bound, which an index on the moment can use. */
const nearBound = (at: SQL, after?: ActivityBound): SQL =>
  after === undefined ? sql`true` : sql`${at} <= ${after.at}::timestamptz`;

interface TaskMomentRow extends Record<string, unknown> {
  readonly part: 'added' | 'done';
  readonly task_id: string;
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
  readonly title: string;
  readonly is_done: boolean;
}

/**
 * The record's newest task moments past the bound, at most `limit + 1`: its
 * links' moments (`task_records_by_record`) and its linked tasks' done
 * moments, each read once, merged by key.
 */
export const taskSource: ActivitySource = async ({ tx, record, after, limit }) => {
  const rank = ACTIVITY_RANKS.task;
  const addedId = sql`'task:' || l.task_id::text || ':added'`;
  const doneId = sql`'task:' || l.task_id::text || ':done'`;
  const live = sql`exists (select 1 from records r where r.workspace_id = l.workspace_id and r.id = l.record_id and r.deleted_at is null)`;
  const rows = await tx.execute<TaskMomentRow>(sql`
    (
      select 'added' as part, l.task_id::text as task_id, ${micro('l.created_at')} as at,
        l.created_by_type as actor_type, l.created_by_id::text as actor_id, t.title, t.is_done
      from task_records l join tasks t on t.workspace_id = l.workspace_id and t.id = l.task_id
      where l.record_id = ${record.id}::uuid and t.deleted_at is null and ${live}
        and ${nearBound(sql`l.created_at`, after)} and ${boundSql(sql`l.created_at`, addedId, rank, after)}
      order by l.created_at desc, (${addedId}) collate "C"
      limit ${limit + 1}
    )
    union all
    (
      select 'done' as part, l.task_id::text as task_id, ${micro('t.done_at')} as at,
        t.done_by_type as actor_type, t.done_by_id::text as actor_id, t.title, t.is_done
      from task_records l join tasks t on t.workspace_id = l.workspace_id and t.id = l.task_id
      where l.record_id = ${record.id}::uuid and t.deleted_at is null and t.is_done and ${live}
        and ${nearBound(sql`t.done_at`, after)} and ${boundSql(sql`t.done_at`, doneId, rank, after)}
      order by t.done_at desc, (${doneId}) collate "C"
      limit ${limit + 1}
    )
  `);
  const entries = rows.rows.map((row): ActivityItem => {
    const id = `task:${row.task_id}:${row.part}`;
    return {
      id,
      key: activityKey({ at: row.at, rank, id }),
      at: toMillis(row.at),
      actor: { type: row.actor_type, id: row.actor_id },
      kind: 'task',
      itemId: row.task_id,
      title: row.title,
      // Which moment this is: `true` on the completion, `false` on the link.
      isDone: row.part === 'done',
    };
  });
  return { entries };
};
