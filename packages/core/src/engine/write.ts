// The one way the engine writes (spec 0004, AC-13, AC-17): one transaction
// inside withWorkspace(), the changes it made collected as it goes, then every
// afterWrite hook in the same transaction. #7 adds the outbox hook and #36 the
// audit hook; a hook that throws rolls the whole write back.
import type { WorkspaceTx } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { isRefusal, postgresError } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';

/** A record a write touched, with its object: the outbox groups a change by object. */
export interface RecordRef {
  readonly recordId: string;
  readonly objectId: string;
}

/** One attribute's value that changed on a record (with its object) or a list entry (with its list). */
export type ValueChange = {
  readonly ownerId: string;
  readonly attributeId: string;
  /** The new version, shared by every item row this write made for the attribute. */
  readonly versionId: string;
  /** When the edit started from an older version: the version and actor it replaced (AC-12). */
  readonly replaced?: { readonly versionId: string; readonly setBy: Actor };
} & (
  { readonly ownerKind: 'record'; readonly objectId: string } | { readonly ownerKind: 'entry'; readonly listId: string }
);

/**
 * A record's reference value that changed on screen with no new version: a
 * record it links to went to the trash, came back, or was erased.
 */
export interface ReferenceChange {
  readonly recordId: string;
  readonly objectId: string;
  readonly attributeId: string;
}

/**
 * Everything one write landed or made visible or invisible, as the hooks see
 * it. Records and entries that only appear or disappear (a record's entries
 * on its delete, the reference values pointing at it) are listed too, so a
 * screen showing them knows to read them again.
 */
export interface Change {
  readonly kind: 'write' | 'erasure';
  readonly workspaceId: string;
  readonly actor: Actor;
  readonly createdRecords: readonly RecordRef[];
  /** Records moved to the trash (or erased while live): they leave every read. */
  readonly deletedRecords: readonly RecordRef[];
  readonly restoredRecords: readonly RecordRef[];
  /** Records removed for good, by the purge or an erasure. */
  readonly purgedRecords: readonly RecordRef[];
  readonly createdEntries: readonly string[];
  readonly removedEntries: readonly string[];
  readonly restoredEntries: readonly string[];
  /** Entries still in their lists whose record went to the trash (or was erased): they leave every read. */
  readonly hiddenEntries: readonly string[];
  /** Entries in their lists whose record came back from the trash. */
  readonly shownEntries: readonly string[];
  /** Entries removed for good, by the purge or an erasure. */
  readonly purgedEntries: readonly string[];
  readonly values: readonly ValueChange[];
  /** Reference values on other records that a delete, restore or erasure changed without a new version. */
  readonly references: readonly ReferenceChange[];
}

/** Marks a change `capChange` made: a type only brand, nothing at run time. */
declare const CAPPED: unique symbol;

/**
 * A change cut down for a published event: past the cap, an object's record
 * ids give way to a coarse marker. Only `capChange` makes one (it carries a
 * type only brand), so a step that takes it can't be handed a full `Change`,
 * or one dressed up with an empty `coarse`.
 */
export interface CappedChange extends Change {
  readonly [CAPPED]: true;
  /**
   * Objects with more than `CHANGE_CAP` distinct record ids across the
   * change: their ids are left out of every record list, `references` and the
   * record values, and a screen refetches whatever it holds of the object.
   */
  readonly coarse: readonly { readonly objectId: string }[];
}

/** The most record ids of one object a published event lists before it names the object coarse. */
export const CHANGE_CAP = 1_000;

/** The record lists the cap merges: every list of records, and the reference values. */
const CAPPED_KEYS = ['createdRecords', 'deletedRecords', 'restoredRecords', 'purgedRecords', 'references'] as const;

/**
 * Caps a change for the outbox hook (spec 0005): each object's record ids,
 * merged across the record lists, `references` and the record values, at
 * `CHANGE_CAP` distinct ids. An object past the cap goes into `coarse` and
 * its ids leave all of them, so a bulk delete or purge never becomes an event
 * the size of the table. `runWrite` never calls it: every hook receives the
 * full `Change`, since the audit log must name every record.
 */
export function capChange(change: Change): CappedChange {
  const idsByObject = new Map<string, Set<string>>();
  const note = (objectId: string, recordId: string) => {
    const ids = idsByObject.get(objectId) ?? new Set<string>();
    idsByObject.set(objectId, ids.add(recordId));
  };
  for (const key of CAPPED_KEYS) for (const item of change[key]) note(item.objectId, item.recordId);
  for (const value of change.values) if (value.ownerKind === 'record') note(value.objectId, value.ownerId);
  const coarse = [...idsByObject].flatMap(([objectId, ids]) => (ids.size > CHANGE_CAP ? [objectId] : []));
  if (coarse.length === 0) return brand({ ...change, coarse: [] });
  const isCoarse = new Set(coarse);
  const fine = <T extends { readonly objectId: string }>(items: readonly T[]) =>
    items.filter((item) => !isCoarse.has(item.objectId));
  return brand({
    ...change,
    createdRecords: fine(change.createdRecords),
    deletedRecords: fine(change.deletedRecords),
    restoredRecords: fine(change.restoredRecords),
    purgedRecords: fine(change.purgedRecords),
    references: fine(change.references),
    values: change.values.filter((value) => value.ownerKind !== 'record' || !isCoarse.has(value.objectId)),
    coarse: coarse.sort().map((objectId) => ({ objectId })),
  });
}

/** Gives a capped change its brand. Only `capChange` calls it. */
function brand(change: Omit<CappedChange, typeof CAPPED>): CappedChange {
  return change as CappedChange;
}

/** The lists of a change that a write step adds to. */
type ChangeLists = Omit<Change, 'kind' | 'workspaceId' | 'actor'>;
const LIST_KEYS = [
  'createdRecords',
  'deletedRecords',
  'restoredRecords',
  'purgedRecords',
  'createdEntries',
  'removedEntries',
  'restoredEntries',
  'hiddenEntries',
  'shownEntries',
  'purgedEntries',
  'values',
  'references',
] as const satisfies readonly (keyof ChangeLists)[];

/**
 * A step that runs after the write, inside its transaction (the outbox, the
 * audit log). It gets the full `Change`.
 *
 * Hooks run inside the transaction after the workspace counter row is taken
 * (every write takes it last, and the outbox numbers from it), so every other
 * write in the workspace waits while a hook runs. A hook therefore writes a
 * bounded, compact amount: one row per write with ids as arrays in it, never
 * one row per far reference or per record the change names. The outbox hook
 * must cap the change with `capChange`: build it with `cappedHook`, whose
 * step takes a `CappedChange`, so handing it the full change is a type error.
 */
export type AfterWrite = (change: Change, tx: WorkspaceTx) => Promise<void>;

/** A hook's step that takes the change already capped: the outbox's (spec 0005). */
export type CappedStep = (change: CappedChange, tx: WorkspaceTx) => Promise<void>;

/**
 * The one way to make a hook from a `CappedStep`: the change goes through
 * `capChange` before the step sees it, so the outbox never writes an event
 * the size of a bulk delete while the counter row is held.
 */
export function cappedHook(step: CappedStep): AfterWrite {
  return (change, tx) => step(capChange(change), tx);
}

/** What a write step gets: the transaction, the scope, and a place to record what it changed. */
export interface WriteContext {
  readonly tx: WorkspaceTx;
  readonly scope: EngineScope;
  /** Notes a change, for the hooks. */
  record(part: Partial<ChangeLists>): void;
  /**
   * Member ids this write already found active, shared by its savepoints, so
   * a batch looks each member up once. Only a read a rollback can't undo
   * belongs here, never a lock: a savepoint's rollback releases its locks.
   */
  readonly activeMembers: Set<string>;
  /**
   * Runs one record's part of a batch under its own savepoint, handing `work`
   * a context whose `tx` is that savepoint. A refusal rolls back only that
   * part, and its changes are left out of what the hooks see.
   */
  perRecord<T>(
    work: (context: WriteContext) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; refusals: readonly EngineRefusal[] }>;
}

/**
 * Adds `items` to the end of `target` one at a time. `target.push(...items)`
 * passes every item as an argument, and past about 125,000 items that
 * overflows the call stack (`RangeError`), so a record with that many links
 * could never be deleted, restored or erased.
 */
function append<T>(target: T[], items: readonly T[] | undefined): void {
  if (items === undefined) return;
  for (const item of items) target.push(item);
}

/** The deadlock and serialisation failures a fresh attempt can get past. */
const RETRYABLE = new Set(['40P01', '40001']);
const ATTEMPTS = 3;

/**
 * Runs `work` as one transaction in the scope's workspace, then the hooks.
 * Retries the whole transaction up to 3 times on a deadlock or a
 * serialisation failure. A refusal or any other error rolls it all back.
 */
export async function runWrite<T>(
  scope: EngineScope,
  work: (context: WriteContext) => Promise<T>,
  hooks: readonly AfterWrite[] = [],
  kind: Change['kind'] = 'write',
): Promise<{ result: T; change: Change }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await scope.db.withWorkspace(scope.workspaceId, async (tx) => {
        // Collected as the write goes; local to this attempt, so nothing outlives it.
        const collected = {
          createdRecords: [] as RecordRef[],
          deletedRecords: [] as RecordRef[],
          restoredRecords: [] as RecordRef[],
          purgedRecords: [] as RecordRef[],
          createdEntries: [] as string[],
          removedEntries: [] as string[],
          restoredEntries: [] as string[],
          hiddenEntries: [] as string[],
          shownEntries: [] as string[],
          purgedEntries: [] as string[],
          values: [] as ValueChange[],
          references: [] as ReferenceChange[],
        };
        const context: WriteContext = {
          tx,
          scope,
          activeMembers: new Set<string>(),
          record(part) {
            // A loop, never `push(...items)`: spreading a list of a few hundred thousand (a record with that many
            // links, deleted or erased) as call arguments overflows the stack.
            append(collected.createdRecords, part.createdRecords);
            append(collected.deletedRecords, part.deletedRecords);
            append(collected.restoredRecords, part.restoredRecords);
            append(collected.purgedRecords, part.purgedRecords);
            append(collected.createdEntries, part.createdEntries);
            append(collected.removedEntries, part.removedEntries);
            append(collected.restoredEntries, part.restoredEntries);
            append(collected.hiddenEntries, part.hiddenEntries);
            append(collected.shownEntries, part.shownEntries);
            append(collected.purgedEntries, part.purgedEntries);
            append(collected.values, part.values);
            append(collected.references, part.references);
          },
          async perRecord(step) {
            const marks = LIST_KEYS.map((key) => collected[key].length);
            try {
              const value = await tx.transaction((savepoint) => step({ ...context, tx: savepoint }));
              return { ok: true, value };
            } catch (error) {
              if (!isRefusal(error)) throw error;
              LIST_KEYS.forEach((key, index) => {
                collected[key].length = marks[index] ?? 0;
              });
              return { ok: false, refusals: error.refusals };
            }
          },
        };
        const result = await work(context);
        // The full change: the outbox hook caps its own copy with `capChange`, and the audit log names every record.
        const change: Change = {
          kind,
          workspaceId: scope.workspaceId,
          actor: scope.actor,
          createdRecords: [...collected.createdRecords],
          deletedRecords: [...collected.deletedRecords],
          restoredRecords: [...collected.restoredRecords],
          purgedRecords: [...collected.purgedRecords],
          createdEntries: [...collected.createdEntries],
          removedEntries: [...collected.removedEntries],
          restoredEntries: [...collected.restoredEntries],
          hiddenEntries: [...collected.hiddenEntries],
          shownEntries: [...collected.shownEntries],
          purgedEntries: [...collected.purgedEntries],
          values: [...collected.values],
          references: [...collected.references],
        };
        for (const hook of hooks) await hook(change, tx);
        return { result, change };
      });
    } catch (error) {
      const code = postgresError(error)?.code;
      if (attempt < ATTEMPTS && code !== undefined && RETRYABLE.has(code)) continue;
      throw error;
    }
  }
}
