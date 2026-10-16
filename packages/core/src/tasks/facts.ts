// The facts spec 0009's `filterEvent` needs for a `tasks` row (spec 0019,
// AC-447, AC-448): each task's creator, assignee and linked records, read
// once per relay batch (`taskFacts`, the system's read) or per catch up page
// (`readTaskFacts`, inside the caller's own transaction). A deleted task has
// no fact, so it counts as visible to nobody.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import type { TaskFact } from '../access/events.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid, uuidList } from '../engine/ids.ts';

/** The most task ids one read takes: a relay batch is at most 100 rows of at most a few tasks each. */
const FACTS_MAX = 5_000;

interface FactRow extends Record<string, unknown> {
  readonly id: string;
  readonly creator: string | null;
  readonly assignee: string | null;
  readonly records: { readonly objectId: string; readonly recordId: string; readonly trashed: boolean }[] | null;
}

/**
 * Each live task's fact among `taskIds`, by id, read in `tx`: its creator and
 * assignee member ids, and every linked record with its object, a record in
 * the trash marked `trashed` (its link still counts as a link, but it shows
 * nobody the task). Ids that aren't uuids name nothing.
 */
export async function readTaskFacts(
  tx: WorkspaceTx,
  taskIds: readonly string[],
): Promise<Readonly<Record<string, TaskFact>>> {
  const ids = [...new Set(taskIds.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, FACTS_MAX);
  const facts = Object.create(null) as Record<string, TaskFact>;
  if (ids.length === 0) return facts;
  const rows = await tx.execute<FactRow>(sql`
    select t.id::text as id, t.created_by_member_id::text as creator, t.assignee_member_id::text as assignee,
      (select json_agg(json_build_object('objectId', r.object_id, 'recordId', r.id, 'trashed', r.deleted_at is not null)
          order by l.position)
        from task_records l join records r on r.workspace_id = l.workspace_id and r.id = l.record_id
        where l.workspace_id = t.workspace_id and l.task_id = t.id) as records
    from tasks t
    where t.id = any(${uuidList(ids)}) and t.deleted_at is null
  `);
  for (const row of rows.rows) {
    facts[row.id] = {
      ...(row.creator === null ? {} : { creatorMemberId: row.creator }),
      assigneeMemberIds: row.assignee === null ? [] : [row.assignee],
      records: (row.records ?? []).map((record) => ({
        objectId: record.objectId,
        recordId: record.recordId,
        ...(record.trashed ? { trashed: true } : {}),
      })),
    };
  }
  return facts;
}

/**
 * The relay's read of task facts for one workspace (spec 0009, `eventFacts`
 * asks for `tasks` on a `tasks` row). Only the system may ask: it is the
 * relay's read, never a member's.
 */
export async function taskFacts(
  scope: EngineScope,
  taskIds: readonly string[],
): Promise<Readonly<Record<string, TaskFact>>> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system reads task facts (the relay, with its system scope).');
  }
  return inWorkspace(scope, (tx) => readTaskFacts(tx, taskIds));
}
