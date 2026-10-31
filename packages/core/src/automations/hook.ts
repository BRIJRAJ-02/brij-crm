// The write hook that queues automation runs (parity #53): after a write that created records or changed their values,
// in the write's own transaction, one insert select adds a `queued` run for every enabled automation whose trigger the
// change matches, and queues the workspace's `crm_automation` task when it added any. The run's key (automation,
// record, event) is unique, so the same event never queues twice; the event is `created`, or `changed:<version id>`
// (the cell's new version). Conditions and "to a value" are checked later, when the run executes, against the record
// as it is then and as the person the automation runs as sees it.
//
// A failure never breaks the user's write: everything the hook does runs in a savepoint that is rolled back and
// forgotten (told to `onFault`) if it throws. A write an automation made itself (actor `automation`) queues nothing,
// so an automation can never trigger another, or itself. A workspace with no matching automation costs one statement.
import { sql } from 'drizzle-orm';
import { AUTOMATION_EVENTS_PER_WRITE, AUTOMATION_QUEUE_MAX } from '@crm/contracts';
import type { AfterWrite } from '../engine/write.ts';

/** One event the hook offers the matching: a record, its object, and for a change the attribute and new version. */
interface Event {
  readonly o: string;
  readonly r: string;
  readonly a: string | null;
  readonly v: string | null;
  readonly k: 'created' | 'changed';
}

/**
 * The hook. `onFault` hears a failure (the api logs it and reports it); the write itself goes on and commits.
 * Nothing but ids reaches the database: the events travel as one JSON parameter.
 */
export function automationHook(onFault?: (error: unknown) => void): AfterWrite {
  return async (change, tx) => {
    if (change.kind !== 'write' || change.actor.type === 'automation') return;
    const events: Event[] = [];
    for (const record of change.createdRecords) {
      if (events.length >= AUTOMATION_EVENTS_PER_WRITE) break;
      events.push({ o: record.objectId, r: record.recordId, a: null, v: null, k: 'created' });
    }
    // A cell changes once per write; its version is shared by the item rows it wrote.
    const seen = new Set<string>();
    for (const value of change.values) {
      if (events.length >= AUTOMATION_EVENTS_PER_WRITE) break;
      if (value.ownerKind !== 'record') continue;
      const key = `${value.ownerId}:${value.attributeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ o: value.objectId, r: value.ownerId, a: value.attributeId, v: value.versionId, k: 'changed' });
    }
    if (events.length === 0) return;
    const { workspaceId } = change;
    try {
      await tx.transaction(async (savepoint) => {
        const queued = await savepoint.execute(sql`
          with ev as (
            select * from jsonb_to_recordset(${JSON.stringify(events)}::jsonb)
              as x(o uuid, r uuid, a uuid, v uuid, k text)
          )
          insert into automation_runs (workspace_id, automation_id, subject_kind, subject_id, object_id, event_key,
            version_id)
          select ${workspaceId}::uuid, a.id, 'record', ev.r, ev.o,
            case ev.k when 'created' then 'created' else 'changed:' || ev.v::text end, ev.v
          from ev
          join automations a on a.workspace_id = ${workspaceId}::uuid and a.object_id = ev.o and a.enabled
            and a.deleted_at is null
            and ((a.trigger_kind = 'record_created' and ev.k = 'created')
              or (a.trigger_kind = 'field_changed' and ev.k = 'changed' and a.attribute_id = ev.a))
          where (select count(*) from (
            select 1 from automation_runs q where q.workspace_id = ${workspaceId}::uuid and q.status = 'queued'
            limit ${AUTOMATION_QUEUE_MAX}
          ) waiting) < ${AUTOMATION_QUEUE_MAX}
          on conflict (workspace_id, automation_id, subject_id, event_key) do nothing
          returning id
        `);
        if (queued.rowCount !== null && queued.rowCount > 0)
          await savepoint.execute(sql`select crm_enqueue_automation()`);
      });
    } catch (error) {
      onFault?.(error);
    }
  };
}
