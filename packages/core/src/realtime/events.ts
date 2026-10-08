// Outbox rows as change events (spec 0007, The event): the one mapping from
// what the outbox stores to spec 0007's `ChangeEvent`, used by the relay and
// by catch up alike. `item_ids` names the row's own items by kind; the never
// published `actor_member_id` rides along only on a `jobs` row, for spec
// 0009's `filterEvent`, and `wireEvent` drops it before anything leaves.
import type { ChangeEvent } from '@crm/contracts';
import type { OutboxRow } from '@crm/db';
import { filterEvent, type Audience, type AudienceEvent, type EventRow } from '../access/events.ts';
import { SYSTEM_ACCESS } from '../access/policy.ts';

/** The ids a list names, copied, so an event never shares an array with the row it came from. */
const copy = (ids: readonly string[]): string[] => [...ids];

/**
 * The event an outbox row describes, as spec 0009's `filterEvent` reads it,
 * or undefined for a row missing what its kind needs (an object for
 * `records`, a list for `entries`), which the outbox hook never writes: the
 * relay sends the stub for it, so the stream stays gap free, and catch up
 * leaves it out.
 */
export function outboxEvent(row: OutboxRow): EventRow | undefined {
  const place = { seq: row.seq, at: row.at, ...(row.mutationId === undefined ? {} : { mutationId: row.mutationId }) };
  const coarse = row.coarse ? { coarse: true } : {};
  const objectId = row.objectId === undefined ? {} : { objectId: row.objectId };
  const listId = row.listId === undefined ? {} : { listId: row.listId };
  switch (row.kind) {
    case 'records':
      if (row.objectId === undefined) return undefined;
      return {
        ...place,
        kind: 'records',
        objectId: row.objectId,
        recordIds: copy(row.recordIds),
        attributeIds: copy(row.attributeIds),
        ...coarse,
      };
    case 'entries':
      if (row.listId === undefined) return undefined;
      return {
        ...place,
        kind: 'entries',
        listId: row.listId,
        ...objectId,
        entryIds: copy(row.itemIds),
        recordIds: copy(row.recordIds),
        attributeIds: copy(row.attributeIds),
        ...coarse,
      };
    case 'definitions':
      return {
        ...place,
        kind: 'definitions',
        ...objectId,
        ...listId,
        // An empty list means the write didn't name them: refetch the object's (or list's) whole set.
        ...(row.attributeIds.length === 0 ? {} : { attributeIds: copy(row.attributeIds) }),
      };
    case 'views':
      return { ...place, kind: 'views', ...objectId, ...listId, viewIds: copy(row.itemIds), ...coarse };
    case 'notes':
      return {
        ...place,
        kind: 'notes',
        ...objectId,
        recordIds: copy(row.recordIds),
        noteIds: copy(row.itemIds),
        ...coarse,
      };
    case 'tasks':
      return { ...place, kind: 'tasks', recordIds: copy(row.recordIds), taskIds: copy(row.itemIds), ...coarse };
    case 'members':
      return { ...place, kind: 'members', memberIds: copy(row.itemIds) };
    case 'access':
      return { ...place, kind: 'access', memberIds: copy(row.itemIds) };
    case 'jobs':
      return {
        ...place,
        kind: 'jobs',
        jobIds: copy(row.itemIds),
        ...coarse,
        ...(row.actorMemberId === undefined ? {} : { actorMemberId: row.actorMemberId }),
      };
  }
}

/**
 * The one audience of `workspace:<id>` until spec 0007 milestone 2 plans each
 * row per audience: the open policy, and no member named, so a rule that
 * needs to know who receives an event (a job's id, a private view, a task)
 * fails closed and the event goes coarse with no ids.
 */
const WORKSPACE_AUDIENCE: Audience = Object.freeze({
  key: SYSTEM_ACCESS.data.key,
  policy: SYSTEM_ACCESS.data,
  members: Object.freeze([]),
});

/**
 * What the relay publishes for one outbox row on `workspace:<id>`: the row's
 * event through spec 0009's `filterEvent` for the workspace's one audience,
 * in its wire shape, or the stub when the row is malformed or nothing of it
 * is left. A `records` or `definitions` row passes whole.
 */
export function liveEvent(row: OutboxRow): ChangeEvent {
  const event = outboxEvent(row);
  const kept = event === undefined ? undefined : filterEvent(WORKSPACE_AUDIENCE, event);
  return kept === undefined ? stubEvent(row.seq, row.at) : wireEvent(kept);
}

/**
 * The stub (spec 0007): what a channel receives for a `seq` its audience may
 * read nothing of. It keeps the stream gap free and names nothing.
 */
export function stubEvent(seq: number, at: string): ChangeEvent {
  return { seq, at, kind: 'restricted' };
}

/**
 * An event as it leaves the server: never the job starter (`actorMemberId`
 * is read by the access filter only), and `coarse` only when true, the shape
 * spec 0005's browsers parse.
 */
export function wireEvent(event: EventRow | AudienceEvent): AudienceEvent {
  const { actorMemberId: _starter, ...rest } = event as EventRow & { readonly actorMemberId?: string };
  if ('coarse' in rest && rest.coarse !== true) {
    const { coarse: _coarse, ...fine } = rest;
    return fine;
  }
  return rest;
}
