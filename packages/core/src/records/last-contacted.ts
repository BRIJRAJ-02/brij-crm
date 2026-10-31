// "Last contacted" on a record's page (the CRM flow pass, 31 October 2026): the latest moment someone spoke with the
// record, already past. What counts: a call logged on it (any outcome but no answer), a meeting logged on it (any
// outcome but cancelled or no show), and a calendar meeting it shows on that has started and wasn't cancelled. A note,
// an email or an edit is not contact. A call or meeting linked to the record from another record counts only while the
// reader may see that note's own record, live and on a live object, as the timeline shows it (notes/activity.ts); the
// newest 200 such links are looked at. One statement over three indexes; the record is checked first, as the
// timeline checks it, so a hidden record answers as an unknown one.
import { sql } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import { checkObject, checkRecordVisible, recordVisibleSql } from '../access/visibility.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';

const UNKNOWN_RECORD = 'That record does not exist.';

/** How many of the record's newest links from other records' notes the read looks at. */
const LINKED_READ = 200;

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
    const ws = scope.workspaceId;
    // Each arm reads its own index from the newest end and stops early: the record's own calls and meetings on
    // `notes_by_record_occurred`, the newest links from other records on `note_records_by_record` (bounded, so a
    // record linked from thousands of notes never walks them all), and its calendar meetings on
    // `meeting_records_by_record`.
    const contact = (alias: string) =>
      sql.raw(
        `((${alias}.kind = 'call' and ${alias}.outcome is distinct from 'no_answer') or (${alias}.kind = 'meeting' and (${alias}.outcome is null or ${alias}.outcome = 'held')))`,
      );
    const answer = await tx.execute<{ at: string | null }>(sql`
      select to_char(greatest(
        (
          select n.occurred_at from notes n
          where n.workspace_id = ${ws} and n.record_id = ${recordId}::uuid and n.deleted_at is null
            and n.occurred_at <= now() and ${contact('n')}
          order by n.occurred_at desc
          limit 1
        ),
        (
          select max(n.occurred_at) from (
            select l.note_id from note_records l
            where l.workspace_id = ${ws} and l.record_id = ${recordId}::uuid
            order by l.created_at desc
            limit ${LINKED_READ}
          ) l
          join notes n on n.workspace_id = ${ws} and n.id = l.note_id and n.deleted_at is null
            and n.record_id <> ${recordId}::uuid
          join records h on h.workspace_id = n.workspace_id and h.id = n.record_id and h.deleted_at is null
          join objects ho on ho.workspace_id = h.workspace_id and ho.id = h.object_id and ho.archived_at is null
          where n.occurred_at <= now() and ${contact('n')} and ${seen ?? sql`true`}
        ),
        (
          select m.starts_at from meeting_records m
          where m.workspace_id = ${ws} and m.record_id = ${recordId}::uuid and m.starts_at <= now()
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
