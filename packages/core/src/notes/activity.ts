// Notes in a record's timeline (spec 0019, AC-444): the `note` source of spec
// 0017's merge (rank 4). Each live note on the record shows once, at the
// moment it happened (a plain note's is when it was made), by whoever made it
// ("added a note"), with its title and the start of its text; clicking it
// opens the note. A note linked to the record from another record (migration
// 0135) shows at the moment it was linked, by whoever linked it, and only
// while the reader may see the note's own record, which decides who sees the
// note. A call or a meeting logged on a record (migration 0137) is a note with
// a kind: it answers as `call` or `logged_meeting` with its duration and
// outcome, and shows at the moment it happened on every record it is on, so a
// call logged for yesterday sits yesterday. A deleted note is gone from the
// timeline, and a record in the trash shows none (AC-446).
import { sql, type SQL } from 'drizzle-orm';
import {
  ACTIVITY_RANKS,
  activityKey,
  noteExcerpt,
  type ActivityItem,
  type ActivityKind,
  type NoteKind,
  type NoteOutcome,
} from '@crm/contracts';
import type { Actor } from '../engine/scope.ts';
import { boundSql, toMillis } from '../engine/activity-sources.ts';
import type { ActivityBound, ActivitySource } from '../engine/activity.ts';
import { recordVisibleSql } from '../access/visibility.ts';

/** A moment as fixed width UTC text with microseconds: it keys the timeline. */
const micro = (column: string) => sql.raw(`to_char((${column}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The timeline kind each stored note kind answers as. */
const ENTRY_KIND: Readonly<Record<NoteKind, ActivityKind>> = { note: 'note', call: 'call', meeting: 'logged_meeting' };

/** The stored note kinds a filter asks for: all of them without one. */
function noteKindsFor(kinds: readonly ActivityKind[] | undefined): readonly NoteKind[] {
  const all = Object.keys(ENTRY_KIND) as NoteKind[];
  return kinds === undefined ? all : all.filter((kind) => kinds.includes(ENTRY_KIND[kind]));
}

/** The loose half of the bound, which an index on the moment can use. */
const nearBound = (at: SQL, after?: ActivityBound): SQL =>
  after === undefined ? sql`true` : sql`${at} <= ${after.at}::timestamptz`;

interface NoteMomentRow extends Record<string, unknown> {
  readonly note_id: string;
  readonly at: string;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
  readonly title: string;
  readonly head: string;
  readonly kind: NoteKind;
  readonly duration_minutes: number | null;
  readonly outcome: NoteOutcome | null;
}

/**
 * The record's newest note moments past the bound, at most `limit + 1` of
 * each part: its own notes (`notes_by_record_occurred`) and the notes linked
 * to it from other records (`note_records_by_record`), merged by key. A
 * filter reads only the kinds it names (`kinds`).
 */
export const noteSource: ActivitySource = async ({ tx, scope, record, after, limit, kinds }) => {
  const wanted = noteKindsFor(kinds);
  if (wanted.length === 0) return { entries: [] };
  const kindIn = (alias: string) =>
    wanted.length === 3
      ? sql`true`
      : sql`${sql.raw(alias)}.kind in (${sql.join(
          wanted.map((kind) => sql`${kind}`),
          sql`, `,
        )})`;
  const rank = ACTIVITY_RANKS.note;
  // Where a linked note shows on this record: a call or meeting where it happened, a plain note where it was linked.
  const linkedAt = sql`case when n.kind = 'note' then l.created_at else n.occurred_at end`;
  const ownId = sql`'note:' || n.id::text`;
  const linkedId = sql`'note:' || l.note_id::text`;
  // A linked note's own record: live, and one the reader may see.
  const seen = recordVisibleSql(scope.access, 'h');
  const rows = await tx.execute<NoteMomentRow>(sql`
    (
      select n.id::text as note_id, ${micro('n.occurred_at')} as at, n.created_by_type as actor_type,
        n.created_by_id::text as actor_id, n.title, left(n.content_text, 600) as head, n.kind, n.duration_minutes,
        n.outcome
      from notes n
      where n.record_id = ${record.id}::uuid and n.deleted_at is null and ${kindIn('n')}
        and exists (select 1 from records r where r.workspace_id = n.workspace_id and r.id = n.record_id and r.deleted_at is null)
        and ${nearBound(sql`n.occurred_at`, after)} and ${boundSql(sql`n.occurred_at`, ownId, rank, after)}
      order by n.occurred_at desc, (${ownId}) collate "C"
      limit ${limit + 1}
    )
    union all
    (
      select l.note_id::text as note_id, to_char((${linkedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
        l.created_by_type as actor_type, l.created_by_id::text as actor_id, n.title, left(n.content_text, 600) as head,
        n.kind, n.duration_minutes, n.outcome
      from note_records l
      join notes n on n.workspace_id = l.workspace_id and n.id = l.note_id and n.record_id <> l.record_id
        and n.deleted_at is null
      join records h on h.workspace_id = n.workspace_id and h.id = n.record_id and h.deleted_at is null
      join objects ho on ho.workspace_id = h.workspace_id and ho.id = h.object_id and ho.archived_at is null
      where l.record_id = ${record.id}::uuid and ${seen ?? sql`true`} and ${kindIn('n')}
        and exists (select 1 from records r where r.workspace_id = l.workspace_id and r.id = l.record_id and r.deleted_at is null)
        and ${nearBound(linkedAt, after)} and ${boundSql(linkedAt, linkedId, rank, after)}
      order by (${linkedAt}) desc, (${linkedId}) collate "C"
      limit ${limit + 1}
    )
  `);
  const entries = rows.rows.map((row): ActivityItem => {
    const id = `note:${row.note_id}`;
    return {
      id,
      key: activityKey({ at: row.at, rank, id }),
      at: toMillis(row.at),
      actor: { type: row.actor_type, id: row.actor_id },
      kind: ENTRY_KIND[row.kind],
      itemId: row.note_id,
      // The screen shows "Untitled note" for an empty title.
      title: row.title,
      excerpt: noteExcerpt(row.head),
      ...(row.duration_minutes === null ? {} : { durationMinutes: row.duration_minutes }),
      ...(row.outcome === null ? {} : { outcome: row.outcome }),
    };
  });
  return { entries };
};
