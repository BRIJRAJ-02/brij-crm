// The facts spec 0009's `filterEvent` needs for a `meetings` row (spec 0024,
// AC-610, AC-611): each meeting's privacy, the members whose connections hold
// it, and the records it shows on, read once per relay batch (`meetingFacts`,
// the system's read) or per catch up page (`readMeetingFacts`, inside the
// caller's own transaction). A removed meeting has no fact.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import type { MeetingFact } from '../access/events.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid, uuidList } from '../engine/ids.ts';

/** The most meeting ids one read takes: a relay batch is at most 100 rows of at most 1,000 meetings each. */
const FACTS_MAX = 100_000;

interface FactRow extends Record<string, unknown> {
  readonly id: string;
  readonly is_private: boolean;
  readonly holders: string[] | null;
  readonly records: { readonly objectId: string; readonly recordId: string; readonly trashed: boolean }[] | null;
}

/** Each meeting's fact among `meetingIds`, by id, read in `tx`. Ids that aren't uuids name nothing. */
export async function readMeetingFacts(
  tx: WorkspaceTx,
  meetingIds: readonly string[],
): Promise<Readonly<Record<string, MeetingFact>>> {
  const ids = [...new Set(meetingIds.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, FACTS_MAX);
  const facts = Object.create(null) as Record<string, MeetingFact>;
  if (ids.length === 0) return facts;
  const rows = await tx.execute<FactRow>(sql`
    select m.id::text as id, m.is_private,
      (select array_agg(distinct c.member_id::text)
        from meeting_sources s join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
        where s.workspace_id = m.workspace_id and s.meeting_id = m.id) as holders,
      (select json_agg(json_build_object('objectId', r.object_id, 'recordId', r.id, 'trashed', r.deleted_at is not null))
        from meeting_records l join records r on r.workspace_id = l.workspace_id and r.id = l.record_id
        where l.workspace_id = m.workspace_id and l.meeting_id = m.id) as records
    from meetings m
    where m.id = any(${uuidList(ids)})
  `);
  for (const row of rows.rows) {
    facts[row.id] = {
      isPrivate: row.is_private,
      holderMemberIds: row.holders ?? [],
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
 * The relay's read of meeting facts for one workspace (spec 0009,
 * `eventFacts` asks for `meetings` on a `meetings` row). Only the system may
 * ask: it is the relay's read, never a member's.
 */
export async function meetingFacts(
  scope: EngineScope,
  meetingIds: readonly string[],
): Promise<Readonly<Record<string, MeetingFact>>> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system reads meeting facts (the relay, with its system scope).');
  }
  return inWorkspace(scope, (tx) => readMeetingFacts(tx, meetingIds));
}
