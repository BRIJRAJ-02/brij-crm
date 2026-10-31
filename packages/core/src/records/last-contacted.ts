// "Last contacted" on a record's page (the CRM flow pass, 31 October 2026): the latest moment someone spoke with the
// record, already past. What counts: a call logged on it (any outcome but no answer), a meeting logged on it (any
// outcome but cancelled or no show), and a calendar meeting it shows on that has started and wasn't cancelled. A note,
// an email or an edit is not contact. A call or meeting linked to the record from another record counts only while the
// reader may see that note's own record, as the timeline shows it (notes/activity.ts). One statement, each arm the
// newest row of its own index (`note_records_by_record`, `meeting_records_by_record`); the record is checked first,
// as the timeline checks it, so a hidden record answers as an unknown one.
import { sql } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import { checkObject, checkRecordVisible, recordVisibleSql } from '../access/visibility.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';

const UNKNOWN_RECORD = 'That record does not exist.';

/**
 * When the record was last contacted, ISO 8601 in UTC, or nothing when it never was. Read access on the record's
 * object and the record itself (`NOT_FOUND` otherwise); writes nothing.
 */
export async function getLastContacted(
  scope: EngineScope,
  input: { readonly recordId: string },
): Promise<{ readonly at?: string }> {
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<{ object_id: string }>(sql`
      select r.object_id::text as object_id from records r
      join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id and o.archived_at is null
      where r.id = ${recordId}::uuid and r.deleted_at is null
    `);
    const [row] = found.rows;
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    await checkObject(tx, scope.access, row.object_id, 'read', UNKNOWN_RECORD);
    await checkRecordVisible(tx, scope.access, { objectId: row.object_id, recordId });
    const seen = recordVisibleSql(scope.access, 'h');
    const answer = await tx.execute<{ at: string | null }>(sql`
      select to_char(greatest(
        (
          select max(n.occurred_at) from note_records l
          join notes n on n.workspace_id = l.workspace_id and n.id = l.note_id and n.deleted_at is null
          join records h on h.workspace_id = n.workspace_id and h.id = n.record_id and h.deleted_at is null
          where l.record_id = ${recordId}::uuid and n.occurred_at <= now()
            and ((n.kind = 'call' and n.outcome is distinct from 'no_answer')
              or (n.kind = 'meeting' and (n.outcome is null or n.outcome = 'held')))
            and (n.record_id = l.record_id or ${seen ?? sql`true`})
        ),
        (
          select m.starts_at from meeting_records m
          where m.record_id = ${recordId}::uuid and m.starts_at <= now()
            and exists (
              select 1 from meetings g
              where g.workspace_id = m.workspace_id and g.id = m.meeting_id and g.status <> 'cancelled'
            )
          order by m.starts_at desc
          limit 1
        )
      ) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    `);
    const at = answer.rows[0]?.at ?? null;
    return at === null ? {} : { at };
  });
}
