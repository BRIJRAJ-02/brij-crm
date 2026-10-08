// The outbox hook (spec 0005, change events, AC-39): every write that changes
// something stores its events in the same transaction, so an event can never
// describe a change that rolled back, nor miss one that committed. One row per
// object whose records changed (`records`) and one per object whose attributes
// changed (`definitions`), ids only, numbered per workspace from
// `workspace_counters.outbox_seq` under that row's lock, so the numbers have no
// gaps and follow commit order. Then `pg_notify`, delivered on commit, wakes
// the relay. The counter, the rows and the notify are one statement, so the
// hook costs the write one round trip while it holds the counter row. Each row
// also names the member whose write stored it (`actor_member_id`, spec 0007,
// never published) and its commit time (`created_at`, taken after the counter
// row, so it follows `seq` order). Entry changes aren't published yet: no
// screen shows lists (spec 0007, milestone 2).
import { sql } from 'drizzle-orm';
import { OUTBOX_CHANNEL } from '@crm/db';
import { isUuid } from './ids.ts';
import { cappedHook, type AfterWrite, type CappedChange } from './write.ts';

/** One outbox row before it gets its number. */
export interface OutboxEvent {
  readonly kind: 'records' | 'definitions';
  readonly objectId: string;
  readonly recordIds: readonly string[];
  readonly attributeIds: readonly string[];
  readonly coarse: boolean;
}

/** What the outbox hook needs from the request. */
export interface OutboxHookOptions {
  /** The browser's id for this write (a uuid), echoed in the event so it can skip its own change. */
  readonly mutationId?: string | undefined;
}

/**
 * The events a capped change publishes, in a stable order: each object's
 * records row (its record ids merged across every record list, the
 * references and the record values, or `coarse` with none past the cap),
 * then each object's definitions row. Nothing for an empty change, or one
 * that only touched list entries.
 */
export function outboxEvents(change: CappedChange): readonly OutboxEvent[] {
  const records = new Map<string, { readonly recordIds: Set<string>; readonly attributeIds: Set<string> }>();
  const touch = (objectId: string) => {
    const found = records.get(objectId);
    if (found !== undefined) return found;
    const created = { recordIds: new Set<string>(), attributeIds: new Set<string>() };
    records.set(objectId, created);
    return created;
  };
  for (const list of [change.createdRecords, change.deletedRecords, change.restoredRecords, change.purgedRecords]) {
    for (const ref of list) touch(ref.objectId).recordIds.add(ref.recordId);
  }
  for (const reference of change.references) {
    const object = touch(reference.objectId);
    object.recordIds.add(reference.recordId);
    object.attributeIds.add(reference.attributeId);
  }
  for (const value of change.values) {
    if (value.ownerKind !== 'record') continue;
    const object = touch(value.objectId);
    object.recordIds.add(value.ownerId);
    object.attributeIds.add(value.attributeId);
  }
  const coarse = new Set(change.coarse.map((item) => item.objectId));
  for (const objectId of coarse) touch(objectId);

  const definitions = new Map<string, Set<string>>();
  for (const definition of change.definitions) {
    const ids = definitions.get(definition.objectId) ?? new Set<string>();
    for (const attributeId of definition.attributeIds) ids.add(attributeId);
    definitions.set(definition.objectId, ids);
  }

  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [
    ...[...records.keys()].sort(byId).map((objectId): OutboxEvent => {
      const object = touch(objectId);
      const isCoarse = coarse.has(objectId);
      return {
        kind: 'records',
        objectId,
        recordIds: isCoarse ? [] : [...object.recordIds],
        attributeIds: [...object.attributeIds],
        coarse: isCoarse,
      };
    }),
    ...[...definitions.keys()].sort(byId).map((objectId): OutboxEvent => ({
      kind: 'definitions',
      objectId,
      recordIds: [],
      attributeIds: [...(definitions.get(objectId) ?? [])],
      coarse: false,
    })),
  ];
}

/**
 * The outbox hook for one write, built with `cappedHook`, so it only ever
 * sees a change cut down by `capChange`. In one statement it takes the
 * workspace counter row (every write takes that row at its end), numbers and
 * stores its rows (`created_at` from `clock_timestamp()`, when the row was
 * written, not when the transaction began), and notifies `crm_outbox` with
 * the workspace id. An empty change stores and notifies nothing. Throws a
 * `TypeError` for a `mutationId` that isn't a uuid.
 */
export function outboxHook(options: OutboxHookOptions = {}): AfterWrite {
  const { mutationId } = options;
  if (mutationId !== undefined && !isUuid(mutationId)) {
    throw new TypeError('A mutation id is a uuid.');
  }
  return cappedHook(async (change, tx) => {
    const events = outboxEvents(change);
    if (events.length === 0) return;
    const count = events.length;
    // The member who wrote, never published: spec 0009's access filter reads it for `jobs`.
    const actorMemberId = change.actor.type === 'member' ? change.actor.id : null;
    const json = JSON.stringify(events);
    // Arrays come out of the json in their own order (with ordinality), so ids keep the order the hook gave them.
    const result = await tx.execute<{ stored: number }>(sql`
      with counter as (
        update workspace_counters set outbox_seq = outbox_seq + ${count}::bigint
        where workspace_id = ${change.workspaceId}
        returning outbox_seq - ${count}::bigint as base
      ),
      stored as (
        insert into outbox (
          workspace_id, seq, kind, object_id, record_ids, attribute_ids, coarse, mutation_id, actor_member_id, created_at
        )
        select
          ${change.workspaceId}::uuid,
          counter.base + e.ord,
          (e.value ->> 'kind')::outbox_kind,
          (e.value ->> 'objectId')::uuid,
          array(select r.id::uuid from jsonb_array_elements_text(e.value -> 'recordIds') with ordinality as r(id, i) order by r.i),
          array(select a.id::uuid from jsonb_array_elements_text(e.value -> 'attributeIds') with ordinality as a(id, i) order by a.i),
          (e.value ->> 'coarse')::boolean,
          ${mutationId ?? null}::uuid,
          ${actorMemberId}::uuid,
          clock_timestamp()
        from counter, jsonb_array_elements(${json}::jsonb) with ordinality as e(value, ord)
        returning 1
      )
      select (select count(*)::int from stored) as stored, pg_notify(${OUTBOX_CHANNEL}, ${change.workspaceId}::text)
    `);
    // No counters row means nothing was stored; the error rolls the write (and the notify) back.
    if (result.rows[0]?.stored !== count) throw new Error('The workspace has no counters row.');
  });
}
