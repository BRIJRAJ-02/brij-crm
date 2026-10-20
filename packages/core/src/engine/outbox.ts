// The outbox hook (spec 0005, change events, AC-39; spec 0007, AC-80 to
// AC-82): every write that changes something stores its events in the same
// transaction, so an event can never describe a change that rolled back, nor
// miss one that committed. `outboxHook` is the one outbox writer: one row per
// object whose records changed (`records`), one per list whose entries changed
// (`entries`), one per object, list or workspace whose definitions changed
// (`definitions`), and one per kind for what writes outside the engine record
// in the `Change` (`members` today; views, notes, tasks, access and jobs as
// their features land). Ids only, numbered per workspace from
// `workspace_counters.outbox_seq` under that row's lock, so the numbers have no
// gaps and follow commit order. Then `pg_notify`, delivered on commit, wakes
// the relay. The counter, the rows and the notify are one statement, so the
// hook costs the write one round trip while it holds the counter row. Each row
// also names the member whose write stored it (`actor_member_id`, spec 0007,
// never published) and its commit time (`created_at`, taken after the counter
// row, so it follows `seq` order).
import { sql } from 'drizzle-orm';
import { MAX_LIFECYCLE_IDS, MAX_REPLACED_CELLS } from '@crm/contracts';
import { OUTBOX_CHANNEL } from '@crm/db';
import { isUuid } from './ids.ts';
import type { Actor } from './scope.ts';
import { cappedHook, CHANGE_CAP, type AfterWrite, type CappedChange, type EntryRef } from './write.ts';

/** One cell a write replaced that its author never saw (spec 0006, AC-46): ids only. */
export interface ReplacedCell {
  readonly recordId: string;
  readonly attributeId: string;
  /** The version the write replaced. */
  readonly versionId: string;
}

/** What a write replaced: who replaced it (the write's actor, named once), and the cells. */
export interface ReplacedValues {
  readonly by: Actor;
  readonly cells: readonly ReplacedCell[];
}

/**
 * The most cells one outbox row's `replaced` names (owner decision, 8 Oct
 * 2026, `MAX_REPLACED_CELLS` in the contract); past it the row carries none,
 * and the tabs only refetch (no notice for a bulk overwrite).
 */
export const REPLACED_CAP = MAX_REPLACED_CELLS;

/**
 * The most record ids one `records` row names as created, deleted and
 * restored together (`MAX_LIFECYCLE_IDS` in the contract; owner decision
 * pending, 12 Oct 2026); past it the row is coarse.
 */
export const LIFECYCLE_CAP = MAX_LIFECYCLE_IDS;

/** One outbox row before it gets its number. */
export interface OutboxEvent {
  readonly kind: 'records' | 'entries' | 'definitions' | 'members' | 'jobs' | 'views' | 'tasks' | 'notes' | 'meetings' | 'nav';
  /** The object: a `records` row's, an `entries` row's list's parent, a `definitions` row's when it names one. */
  readonly objectId?: string;
  /** The list: an `entries` row's, a `definitions` row's when it names one. */
  readonly listId?: string;
  readonly recordIds: readonly string[];
  readonly attributeIds: readonly string[];
  /** The row's own items: entry ids for `entries`, member ids for `members`, task ids for `tasks`, meeting ids for `meetings`. */
  readonly itemIds: readonly string[];
  /** On a `records` row: the records the write created, deleted and restored, at most `LIFECYCLE_CAP` together. */
  readonly createdIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly restoredIds: readonly string[];
  readonly coarse: boolean;
  /** On a `records` row: what the write replaced, when it replaced some cells and no more than `REPLACED_CAP`. */
  readonly replaced?: ReplacedValues;
  /**
   * On a `jobs` row: the jobs' starter (a member id, or null for system
   * jobs), stored as the row's `actor_member_id` in place of the write's
   * actor, so an admin's cancel still names the member who started the job.
   */
  readonly starter?: string | null;
}

/** What the outbox hook needs from the request. */
export interface OutboxHookOptions {
  /** The browser's id for this write (a uuid), echoed in the event so it can skip its own change. */
  readonly mutationId?: string | undefined;
  /**
   * Told how many rows the write stored, each time the hook runs (a write
   * tried again after a deadlock runs it again: the last call is the one
   * that committed). Not called for an empty change, which stores none.
   * The write's answer carries it as `echoes` (spec 0006, AC-60).
   */
  readonly onStored?: (count: number) => void;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** An empty set of the lists every row carries, for a kind that names only some. */
const NO_IDS = {
  recordIds: [],
  attributeIds: [],
  itemIds: [],
  createdIds: [],
  deletedIds: [],
  restoredIds: [],
} as const;

/** Each object's `records` row: record ids merged across every record list, the references and the record values. */
function recordRows(change: CappedChange): OutboxEvent[] {
  const records = new Map<
    string,
    {
      readonly recordIds: Set<string>;
      readonly attributeIds: Set<string>;
      readonly created: Set<string>;
      readonly deleted: Set<string>;
      readonly restored: Set<string>;
      readonly replaced: ReplacedCell[];
    }
  >();
  const touch = (objectId: string) => {
    const found = records.get(objectId);
    if (found !== undefined) return found;
    const created = {
      recordIds: new Set<string>(),
      attributeIds: new Set<string>(),
      created: new Set<string>(),
      deleted: new Set<string>(),
      restored: new Set<string>(),
      replaced: [] as ReplacedCell[],
    };
    records.set(objectId, created);
    return created;
  };
  const lifecycle = [
    [change.createdRecords, 'created'],
    [change.deletedRecords, 'deleted'],
    [change.restoredRecords, 'restored'],
    [change.purgedRecords, undefined],
  ] as const;
  for (const [list, named] of lifecycle) {
    for (const ref of list) {
      const object = touch(ref.objectId);
      object.recordIds.add(ref.recordId);
      if (named !== undefined) object[named].add(ref.recordId);
    }
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
    // Counted one past the cap, which is enough to know the list goes empty.
    if (value.replaced !== undefined && object.replaced.length <= REPLACED_CAP) {
      object.replaced.push({
        recordId: value.ownerId,
        attributeId: value.attributeId,
        versionId: value.replaced.versionId,
      });
    }
  }
  const coarse = new Set(change.coarse.map((item) => item.objectId));
  for (const objectId of coarse) touch(objectId);

  return [...records.keys()].sort(byId).map((objectId): OutboxEvent => {
    const object = touch(objectId);
    // Past the lifecycle cap the row goes coarse: screens reread their windows and counts (owner decision pending).
    // A background job's batch is always coarse, for every object it names, the related ones too (spec 0022, AC-532):
    // its views then refetch at most every 5 seconds however many batches run, never once per batch.
    const isCoarse =
      change.jobId !== undefined ||
      coarse.has(objectId) ||
      object.created.size + object.deleted.size + object.restored.size > LIFECYCLE_CAP;
    const replaced = isCoarse || object.replaced.length > REPLACED_CAP ? [] : object.replaced;
    return {
      kind: 'records',
      objectId,
      ...NO_IDS,
      recordIds: isCoarse ? [] : [...object.recordIds],
      attributeIds: [...object.attributeIds],
      createdIds: isCoarse ? [] : [...object.created],
      deletedIds: isCoarse ? [] : [...object.deleted],
      restoredIds: isCoarse ? [] : [...object.restored],
      coarse: isCoarse,
      // The write's actor replaced every cell, so it is named once.
      ...(replaced.length === 0
        ? {}
        : { replaced: { by: { type: change.actor.type, id: change.actor.id }, cells: replaced } }),
    };
  });
}

/** The entry lists that put an entry on its list's row. */
const ENTRY_LISTS = [
  'createdEntries',
  'removedEntries',
  'restoredEntries',
  'hiddenEntries',
  'shownEntries',
  'purgedEntries',
  'changedEntries',
] as const satisfies readonly (keyof CappedChange)[];

/** Each list's `entries` row (AC-80): entry ids, their records, the entry attributes changed, or coarse past the cap. */
function entryRows(change: CappedChange): OutboxEvent[] {
  const lists = new Map<
    string,
    {
      objectId: string | undefined;
      readonly entryIds: Set<string>;
      readonly recordIds: Set<string>;
      readonly attributeIds: Set<string>;
    }
  >();
  const touch = (listId: string) => {
    const found = lists.get(listId);
    if (found !== undefined) return found;
    const created = {
      objectId: undefined as string | undefined,
      entryIds: new Set<string>(),
      recordIds: new Set<string>(),
      attributeIds: new Set<string>(),
    };
    lists.set(listId, created);
    return created;
  };
  const note = (ref: EntryRef) => {
    const list = touch(ref.listId);
    list.objectId ??= ref.objectId;
    list.entryIds.add(ref.entryId);
    list.recordIds.add(ref.recordId);
  };
  for (const key of ENTRY_LISTS) for (const ref of change[key]) note(ref);
  for (const value of change.values) {
    if (value.ownerKind !== 'entry') continue;
    const list = touch(value.listId);
    list.entryIds.add(value.ownerId);
    list.attributeIds.add(value.attributeId);
  }
  const coarse = new Set(change.coarseLists.map((item) => item.listId));
  for (const listId of coarse) touch(listId);
  return [...lists.keys()].sort(byId).map((listId): OutboxEvent => {
    const list = touch(listId);
    const isCoarse = coarse.has(listId);
    return {
      kind: 'entries',
      listId,
      ...(list.objectId === undefined ? {} : { objectId: list.objectId }),
      ...NO_IDS,
      itemIds: isCoarse ? [] : [...list.entryIds],
      recordIds: isCoarse ? [] : [...list.recordIds],
      attributeIds: [...list.attributeIds],
      coarse: isCoarse,
    };
  });
}

/**
 * One `definitions` row per object, list or the workspace's object list
 * (AC-81). Its attribute ids are merged; one change naming none (the object
 * or list itself changed) makes the row name none, so screens read the whole
 * set again.
 */
function definitionRows(change: CappedChange): OutboxEvent[] {
  const rows = new Map<
    string,
    { readonly objectId?: string; readonly listId?: string; ids: Set<string>; whole: boolean }
  >();
  for (const definition of change.definitions) {
    // A list's row is keyed by the list alone: its parent object rides along when a change named it.
    const key = definition.listId === undefined ? `object:${definition.objectId ?? ''}` : `list:${definition.listId}`;
    const row = rows.get(key) ?? {
      ...(definition.listId === undefined ? {} : { listId: definition.listId }),
      ...(definition.objectId === undefined ? {} : { objectId: definition.objectId }),
      ids: new Set<string>(),
      whole: false,
    };
    const merged =
      row.objectId === undefined && definition.objectId !== undefined ? { ...row, objectId: definition.objectId } : row;
    if (definition.attributeIds.length === 0) merged.whole = true;
    for (const attributeId of definition.attributeIds) merged.ids.add(attributeId);
    rows.set(key, merged);
  }
  return [...rows.keys()].sort(byId).map((key): OutboxEvent => {
    const row = rows.get(key);
    return {
      kind: 'definitions',
      ...(row?.objectId === undefined ? {} : { objectId: row.objectId }),
      ...(row?.listId === undefined ? {} : { listId: row.listId }),
      ...NO_IDS,
      attributeIds: row === undefined || row.whole ? [] : [...row.ids],
      coarse: false,
    };
  });
}

/**
 * One row per kind a write outside the engine recorded (AC-82): `members`,
 * (spec 0008) one `jobs` row per starter, its job ids in `itemIds`, and
 * (spec 0020) one `views` row per object, (spec 0019) one `tasks` row, its task ids in `itemIds` and in `recordIds`
 * every record they linked before or after the write, and (spec 0024) one `meetings` row the same way, coarse with
 * no ids past `CHANGE_CAP` meetings or records.
 */
function kindRows(change: CappedChange): OutboxEvent[] {
  const rows: OutboxEvent[] = [];
  if (change.members.length > 0) {
    rows.push({ kind: 'members', ...NO_IDS, itemIds: [...change.members].sort(byId), coarse: false });
  }
  const byStarter = new Map<string | null, string[]>();
  for (const job of change.jobs) {
    const ids = byStarter.get(job.startedBy) ?? [];
    ids.push(job.jobId);
    byStarter.set(job.startedBy, ids);
  }
  // The system's row first, then each member's by id: a stable order.
  const starters = [...byStarter.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : byId(a, b)));
  for (const starter of starters) {
    rows.push({ kind: 'jobs', ...NO_IDS, itemIds: (byStarter.get(starter) ?? []).sort(byId), coarse: false, starter });
  }
  rows.push(...viewRows(change));
  if (change.tasks.length > 0) {
    const taskIds = [...new Set(change.tasks.map((task) => task.taskId))].sort(byId);
    const recordIds = [...new Set(change.tasks.flatMap((task) => task.recordIds))].sort(byId);
    rows.push({ kind: 'tasks', ...NO_IDS, itemIds: taskIds, recordIds, coarse: false });
  }
  // One `notes` row per object (a save is one note on one record, so one row), naming the notes and their records.
  for (const objectId of [...new Set(change.notes.map((note) => note.objectId))].sort(byId)) {
    const ofObject = change.notes.filter((note) => note.objectId === objectId);
    rows.push({
      kind: 'notes',
      objectId,
      ...NO_IDS,
      itemIds: [...new Set(ofObject.map((note) => note.noteId))].sort(byId),
      recordIds: [...new Set(ofObject.map((note) => note.recordId))].sort(byId),
      coarse: false,
    });
  }
  if (change.meetings.length > 0) {
    const meetingIds = [...new Set(change.meetings.map((meeting) => meeting.meetingId))].sort(byId);
    const recordIds = [...new Set(change.meetings.flatMap((meeting) => meeting.recordIds))].sort(byId);
    // A sync batch, a disconnect or a sharing change over thousands of meetings: coarse, so no row is the size of a
    // calendar, and every open timeline reads again.
    const coarse = meetingIds.length > CHANGE_CAP || recordIds.length > CHANGE_CAP;
    rows.push({
      kind: 'meetings',
      ...NO_IDS,
      itemIds: coarse ? [] : meetingIds,
      recordIds: coarse ? [] : recordIds,
      coarse,
    });
  }
  // A member's own sidebar (spec 0034): one row naming the members whose rows the write changed, nothing else.
  if (change.nav.length > 0) {
    rows.push({ kind: 'nav', ...NO_IDS, itemIds: [...change.nav].sort(byId), coarse: false });
  }
  return rows;
}

/**
 * One `views` row per object (or list) whose saved views the write made,
 * changed or deleted (spec 0020, AC-482), its view ids in `itemIds`, private
 * views included: spec 0009's `filterEvent` decides who may see each id.
 */
function viewRows(change: CappedChange): OutboxEvent[] {
  const byParent = new Map<string, { readonly objectId?: string; readonly listId?: string; ids: Set<string> }>();
  for (const view of change.views) {
    const key = view.listId === undefined ? `object:${view.objectId ?? ''}` : `list:${view.listId}`;
    const row = byParent.get(key) ?? {
      ...(view.objectId === undefined ? {} : { objectId: view.objectId }),
      ...(view.listId === undefined ? {} : { listId: view.listId }),
      ids: new Set<string>(),
    };
    row.ids.add(view.viewId);
    byParent.set(key, row);
  }
  return [...byParent.keys()].sort(byId).flatMap((key): OutboxEvent[] => {
    const row = byParent.get(key);
    if (row === undefined) return [];
    return [
      {
        kind: 'views',
        ...(row.objectId === undefined ? {} : { objectId: row.objectId }),
        ...(row.listId === undefined ? {} : { listId: row.listId }),
        ...NO_IDS,
        itemIds: [...row.ids].sort(byId),
        coarse: false,
      },
    ];
  });
}

/**
 * The events a capped change publishes, in a stable order: each object's
 * records row (its record ids merged across every record list, the
 * references and the record values, with the ones created, deleted and
 * restored named, or `coarse` with none past a cap), each list's entries
 * row, each definitions row, then one row per kind recorded outside the
 * engine. Nothing for an empty change.
 */
export function outboxEvents(change: CappedChange): readonly OutboxEvent[] {
  return [...recordRows(change), ...entryRows(change), ...definitionRows(change), ...kindRows(change)];
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
  const { mutationId, onStored } = options;
  if (mutationId !== undefined && !isUuid(mutationId)) {
    throw new TypeError('A mutation id is a uuid.');
  }
  return cappedHook(async (change, tx) => {
    const events = outboxEvents(change);
    if (events.length === 0) return;
    const count = events.length;
    // The member who wrote, never published: spec 0009's access filter reads it (a `jobs` row carries its starter).
    const actorMemberId = change.actor.type === 'member' ? change.actor.id : null;
    const json = JSON.stringify(events);
    // Arrays come out of the json in their own order (with ordinality), so ids keep the order the hook gave them.
    const ids = (name: string) =>
      sql.raw(
        `array(select x.id::uuid from jsonb_array_elements_text(e.value -> '${name}') with ordinality as x(id, i) order by x.i)`,
      );
    const result = await tx.execute<{ stored: number }>(sql`
      with counter as (
        update workspace_counters set outbox_seq = outbox_seq + ${count}::bigint
        where workspace_id = ${change.workspaceId}
        returning outbox_seq - ${count}::bigint as base
      ),
      stored as (
        insert into outbox (
          workspace_id, seq, kind, object_id, list_id, record_ids, attribute_ids, item_ids, created_ids, deleted_ids,
          restored_ids, coarse, mutation_id, actor_member_id, created_at, replaced, job_id
        )
        select
          ${change.workspaceId}::uuid,
          counter.base + e.ord,
          (e.value ->> 'kind')::outbox_kind,
          (e.value ->> 'objectId')::uuid,
          (e.value ->> 'listId')::uuid,
          ${ids('recordIds')},
          ${ids('attributeIds')},
          ${ids('itemIds')},
          ${ids('createdIds')},
          ${ids('deletedIds')},
          ${ids('restoredIds')},
          (e.value ->> 'coarse')::boolean,
          ${mutationId ?? null}::uuid,
          -- A jobs row names its jobs' starter; every other row the write's member.
          case when e.value ? 'starter' then (e.value ->> 'starter')::uuid else ${actorMemberId}::uuid end,
          clock_timestamp(),
          e.value -> 'replaced',
          -- A job's batch (spec 0022): stored, never published.
          ${change.jobId ?? null}::uuid
        from counter, jsonb_array_elements(${json}::jsonb) with ordinality as e(value, ord)
        returning 1
      )
      select (select count(*)::int as n from stored) as stored, pg_notify(${OUTBOX_CHANNEL}, ${change.workspaceId}::text)
    `);
    // No counters row means nothing was stored; the error rolls the write (and the notify) back.
    if (result.rows[0]?.stored !== count) throw new Error('The workspace has no counters row.');
    onStored?.(count);
  });
}
