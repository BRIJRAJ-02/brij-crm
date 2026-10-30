// Outbox rows as change events (spec 0007, The event): the one mapping from
// what the outbox stores to spec 0007's `ChangeEvent`, used by the relay and
// by catch up alike. `item_ids` names the row's own items by kind; the never
// published `actor_member_id` rides along only on a `jobs` row, for spec
// 0009's `filterEvent`, and `wireEvent` drops it before anything leaves.
import type { ChangeEvent } from '@crm/contracts';
import type { OutboxRow } from '@crm/db';
import type { AudienceEvent, EventRow } from '../access/events.ts';

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
        // Which records were made, deleted or restored (owner decision pending, 12 Oct 2026), only when any were.
        ...(row.createdIds.length === 0 ? {} : { createdIds: copy(row.createdIds) }),
        ...(row.deletedIds.length === 0 ? {} : { deletedIds: copy(row.deletedIds) }),
        ...(row.restoredIds.length === 0 ? {} : { restoredIds: copy(row.restoredIds) }),
        ...coarse,
        // A job's batch wrote it (spec 0022): open views refetch at most every 5 seconds. The flag, never the id.
        ...(row.fromJob === true ? { fromJob: true as const } : {}),
        // What the write replaced (spec 0006), copied, so the event shares nothing with its row.
        ...(row.replaced === undefined
          ? {}
          : {
              replaced: {
                by: { ...row.replaced.by },
                cells: row.replaced.cells.map((cell) => ({ ...cell })),
              },
            }),
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
    case 'meetings':
      return {
        ...place,
        kind: 'meetings',
        recordIds: copy(row.recordIds),
        meetingIds: copy(row.itemIds),
        ...coarse,
      };
    case 'schedules':
      return {
        ...place,
        kind: 'schedules',
        scheduleIds: copy(row.itemIds),
        ...coarse,
        ...(row.actorMemberId === undefined ? {} : { actorMemberId: row.actorMemberId }),
      };
    case 'comments':
      return {
        ...place,
        kind: 'comments',
        ...objectId,
        recordIds: copy(row.recordIds),
        threadIds: copy(row.itemIds),
        ...coarse,
      };
    case 'notifications':
      return { ...place, kind: 'notifications', memberIds: copy(row.itemIds) };
    case 'members':
      return { ...place, kind: 'members', memberIds: copy(row.itemIds) };
    case 'access':
      return { ...place, kind: 'access', memberIds: copy(row.itemIds) };
    case 'nav':
      return { ...place, kind: 'nav', memberIds: copy(row.itemIds) };
    case 'calendars':
      return { ...place, kind: 'calendars', memberIds: copy(row.itemIds) };
    case 'time_off':
      return { ...place, kind: 'time_off' };
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
 * The stub (spec 0007): what a channel receives for a `seq` its audience may
 * read nothing of. It keeps the stream gap free and names nothing.
 */
export function stubEvent(seq: number, at: string): ChangeEvent {
  return { seq, at, kind: 'restricted' };
}

/**
 * An event as it leaves the server: never a job's starter or a schedules row's writer (`actorMemberId`
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
