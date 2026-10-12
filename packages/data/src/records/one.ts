// One record, subscribed to (spec 0006, `records.one`; built here for spec
// 0017's record page): served from the same store as every table, holding its
// body while subscribed, reading only the attributes the body lacks, patched
// live through the layer's pipeline, and saying `deleted` when the record goes
// away. The records layer owns it and hands it the store and its reads.
import type { RecordView } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { NameState, RecordRef } from './names.ts';
import type { RecordStore } from './store.ts';

/** Where a subscribed record stands. */
export type RecordStatus = 'loading' | 'ready' | 'deleted' | 'error';

/** What a screen reads from a record subscription, one object per change. */
export interface RecordState {
  readonly status: RecordStatus;
  /**
   * The record as the store shows it (pending edits on top). After it went
   * away while shown (`isLost`), the last one shown, so the screen can keep
   * it on screen, read only.
   */
  readonly record?: RecordView;
  /**
   * The record was shown and then went away: deleted elsewhere, or the
   * person lost access to it (the layer can't tell which, and says neither).
   * False when it was never there (`deleted` on the first load).
   */
  readonly isLost: boolean;
  /** Why it failed, while `status` is `error`. */
  readonly error?: DataError;
  /** Refused values on this record, by attribute id, to a sentence; each goes with the value's next edit. */
  readonly cellErrors: ReadonlyMap<string, string>;
  /**
   * How the records its reference values link to show (a person's Company):
   * as a view's `referenceDisplays`, read once per record and batched; a new
   * snapshot comes when names arrive.
   */
  readonly referenceDisplays: (refs: readonly RecordRef[]) => readonly NameState[];
}

/** One record, as a screen subscribes to it (`useRecord` in `@crm/data/react`). */
export interface RecordSubscription {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RecordState;
  /** Reads it again after a failure. */
  readonly retry: () => void;
  /** Settles once the first read landed, or failed (the status then says so). */
  readonly ready: () => Promise<void>;
  /**
   * A screen shows it (`useRecord` calls this in an effect); the answer lets
   * go. A subscription nobody shows for 30 seconds lets go of its body.
   * Counted, so StrictMode's second effect changes nothing.
   */
  readonly retain: () => () => void;
}

/** Which attributes a subscription reads: these ids (the primary always comes), or every one the object has. */
export type RecordAttributes = readonly string[] | 'all';

/** What the subscriptions need from the records layer. */
export interface RecordSubscriptionsOptions {
  readonly store: RecordStore<RecordView>;
  /** Reads records by id (with only `attributeIds` and the primary, when given), trying again while busy. */
  readonly read: (workspace: string, ids: readonly string[], attributeIds?: readonly string[]) => Promise<RecordView[]>;
  /** Reads held records again by id; ids the server leaves out are gone and leave the store. */
  readonly refetch: (workspace: string, ids: readonly string[], attributeIds?: readonly string[]) => Promise<void>;
  /** Whether a view of the workspace shows the record now, so live changes keep its body fresh. */
  readonly isShown: (workspace: string, recordId: string) => boolean;
  /** Refused values on a record, by attribute id. */
  readonly cellErrorsOf: (recordId: string) => ReadonlyMap<string, string>;
  /** The names of linked records, as views read them. */
  readonly displaysOf: (workspace: string, refs: readonly RecordRef[]) => readonly NameState[];
  /** Runs `run` after `ms`, answering a cancel. */
  readonly later: (run: () => void, ms: number) => () => void;
  /** How long a subscription nobody shows is kept, in ms. */
  readonly keepUnusedMs: number;
}

interface Entry {
  readonly workspace: string;
  readonly recordId: string;
  /** The attributes it reads now; a screen asking more widens it (`widen`). */
  readonly attributes: () => RecordAttributes;
  /** Reads these attributes too, from now on, keeping the same subscription. */
  readonly widen: (more: RecordAttributes) => void;
  readonly subscription: RecordSubscription;
  readonly update: () => void;
  readonly reread: (attributeIds?: readonly string[]) => void;
  /** Names of linked records arrived: a new snapshot, so the screen draws them. */
  readonly renamed: () => void;
  readonly dispose: () => void;
}

const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map();

/** Whether two maps of refusals say the same. */
const sameErrors = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) =>
  a.size === b.size && [...a].every(([key, message]) => b.get(key) === message);

/** The record subscriptions of one records layer, keyed by workspace and record. */
export function createRecordSubscriptions({
  store,
  read,
  refetch,
  isShown,
  cellErrorsOf,
  displaysOf,
  later,
  keepUnusedMs,
}: RecordSubscriptionsOptions) {
  const entries = new Map<string, Entry>();
  const keyOf = (workspace: string, recordId: string) => `${workspace}\u0000${recordId}`;

  const unsubscribeStore = store.subscribe((ids) => {
    for (const entry of entries.values()) if (ids.has(entry.recordId)) entry.update();
  });

  function open(workspace: string, recordId: string, asked: RecordAttributes): Entry {
    const key = keyOf(workspace, recordId);
    const listeners = new Set<() => void>();
    let status: RecordStatus = 'loading';
    let isLost = false;
    let error: DataError | undefined;
    let last: RecordView | undefined;
    let attributes = asked;
    let retains = 0;
    let isDisposed = false;
    let cancelUnused: (() => void) | undefined;
    let settleReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    let referenceDisplays = (refs: readonly RecordRef[]) => displaysOf(workspace, refs);
    let snapshot: RecordState = { status, isLost, cellErrors: EMPTY_ERRORS, referenceDisplays };
    // Its body stays while it is subscribed, whatever the windows do.
    store.hold([recordId]);

    const build = (): RecordState => {
      const shown = store.get(recordId);
      if (shown !== undefined) last = shown;
      const record = shown ?? (isLost ? last : undefined);
      const errors = cellErrorsOf(recordId);
      const cellErrors = sameErrors(errors, snapshot.cellErrors) ? snapshot.cellErrors : errors;
      return {
        status,
        isLost,
        cellErrors,
        referenceDisplays,
        ...(record === undefined ? {} : { record }),
        ...(error === undefined ? {} : { error }),
      };
    };
    const announce = () => {
      const next = build();
      const changed =
        next.status !== snapshot.status ||
        next.isLost !== snapshot.isLost ||
        next.record !== snapshot.record ||
        next.error !== snapshot.error ||
        next.cellErrors !== snapshot.cellErrors ||
        next.referenceDisplays !== snapshot.referenceDisplays;
      if (!changed) return;
      snapshot = next;
      for (const listener of listeners) listener();
    };
    const update = () => {
      const isHere = store.get(recordId) !== undefined || store.pending().has(recordId);
      // Shown, then gone from the store: deleted elsewhere or out of reach now.
      if (status === 'ready' && !isHere) {
        status = 'deleted';
        isLost = true;
      } else if (status === 'deleted' && isLost && store.get(recordId) !== undefined) {
        // Back again (restored, or in reach once more): a read put its body back.
        status = 'ready';
        isLost = false;
      }
      announce();
    };

    /** The attributes the body lacks; all of them when no view keeps it fresh. */
    const lacking = (): readonly string[] | undefined => {
      if (attributes === 'all') return undefined;
      const body = store.get(recordId);
      if (body === undefined || !isShown(workspace, recordId)) return attributes;
      return attributes.filter((id) => !Object.hasOwn(body.values, id));
    };

    const load = () => {
      const missing = lacking();
      const body = store.get(recordId);
      // Everything asked for is held and kept fresh by a view: shown at once, with no read.
      if (body !== undefined && missing !== undefined && missing.length === 0) {
        status = 'ready';
        error = undefined;
        announce();
        settleReady();
        return;
      }
      if (status === 'error') {
        status = 'loading';
        error = undefined;
        announce();
      }
      read(workspace, [recordId], missing).then(
        (rows) => {
          if (entries.get(key) !== entry) return;
          store.receive(rows);
          const found = rows.some((row) => row.id === recordId) || store.pending().has(recordId);
          if (found) status = 'ready';
          else {
            // Never there, or gone since it was shown.
            isLost = isLost || status === 'ready';
            status = 'deleted';
          }
          error = undefined;
          announce();
          settleReady();
        },
        (failure: unknown) => {
          if (entries.get(key) !== entry) return;
          status = 'error';
          error = toDataError(failure);
          announce();
          settleReady();
        },
      );
    };

    // Lets go of its body once, however often it is called; a screen retaining it again opens it again.
    const dispose = () => {
      cancelUnused?.();
      cancelUnused = undefined;
      if (isDisposed) return;
      isDisposed = true;
      if (entries.get(key) === entry) entries.delete(key);
      store.release([recordId]);
      // Anything waiting on the first read stops waiting.
      settleReady();
    };
    const revive = () => {
      if (!isDisposed || entries.has(key)) return;
      isDisposed = false;
      store.hold([recordId]);
      entries.set(key, entry);
      load();
    };

    const subscription: RecordSubscription = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => snapshot,
      retry: load,
      ready: () => readyPromise,
      retain: () => {
        retains += 1;
        // A screen holding a subscription let go of meanwhile (a page shown again from the router's cache).
        revive();
        cancelUnused?.();
        cancelUnused = undefined;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          retains -= 1;
          if (retains > 0) return;
          cancelUnused = later(dispose, keepUnusedMs);
        };
      },
    };

    const entry: Entry = {
      workspace,
      recordId,
      attributes: () => attributes,
      widen: (more) => {
        if (attributes === 'all') return;
        const held = attributes;
        const added = more === 'all' ? undefined : more.filter((id) => !held.includes(id));
        if (added !== undefined && added.length === 0) return;
        attributes = added === undefined ? 'all' : [...held, ...added];
        // Only what it didn't read before: the body it holds is kept fresh by the live pipeline.
        read(workspace, [recordId], added).then(
          (rows) => {
            if (entries.get(key) === entry) store.receive(rows);
          },
          () => undefined,
        );
      },
      subscription,
      update,
      reread: (attributeIds) => {
        if (status === 'deleted' && !isLost) return;
        // Read with nothing else to fetch: the record's name alone, which still tells whether it is there.
        void refetch(workspace, [recordId], attributeIds).catch(() => undefined);
      },
      renamed: () => {
        referenceDisplays = (refs) => displaysOf(workspace, refs);
        announce();
      },
      dispose,
    };
    entries.set(key, entry);
    // Nobody shows it yet: it goes after the same wait as one let go, unless a screen retains it first.
    cancelUnused = later(dispose, keepUnusedMs);
    load();
    return entry;
  }

  return {
    /**
     * One record of a workspace with the attributes a screen shows (the
     * primary always comes): the same subscription for every screen asking
     * it, made on first use. A second screen asking other attributes reads
     * them once.
     */
    one: (workspace: string, recordId: string, attributes: RecordAttributes): RecordSubscription => {
      const existing = entries.get(keyOf(workspace, recordId));
      if (existing === undefined) return open(workspace, recordId, attributes).subscription;
      // More attributes than it reads (a column added since): the same subscription reads them too.
      existing.widen(attributes);
      return existing.subscription;
    },

    /** Whether a subscription of the workspace holds the record. */
    holds: (workspace: string, recordId: string): boolean => entries.has(keyOf(workspace, recordId)),

    /**
     * A frame of change events named these records of the workspace: each one
     * subscribed is read again with the changed attributes it shows, or just
     * its name when the event names none of them but made, deleted or
     * restored it (which tells whether it is still there).
     */
    changed: (
      workspace: string,
      ids: ReadonlySet<string> | readonly string[],
      changedAttributes: ReadonlySet<string> | 'all',
      lifecycle: ReadonlySet<string>,
    ): void => {
      const named = new Set(ids);
      for (const entry of entries.values()) {
        if (entry.workspace !== workspace || !named.has(entry.recordId)) continue;
        const reads = entry.attributes();
        if (changedAttributes === 'all') {
          entry.reread(reads === 'all' ? undefined : reads);
          continue;
        }
        const wanted = reads === 'all' ? [...changedAttributes] : reads.filter((id) => changedAttributes.has(id));
        if (wanted.length > 0 || lifecycle.has(entry.recordId) || changedAttributes.size === 0) entry.reread(wanted);
      }
    },

    /** Changes may have been missed: every subscribed record of the workspace (or of one object) is read again. */
    reload: (workspace: string, objectId?: string): void => {
      for (const entry of entries.values()) {
        if (entry.workspace !== workspace) continue;
        const body = store.get(entry.recordId);
        if (objectId !== undefined && body !== undefined && body.objectId !== objectId) continue;
        const reads = entry.attributes();
        entry.reread(reads === 'all' ? undefined : reads);
      }
    },

    /** Names of linked records arrived in the workspace: its subscriptions draw them. */
    renamed: (workspace: string): void => {
      for (const entry of entries.values()) if (entry.workspace === workspace) entry.renamed();
    },

    /** Refused values changed: each subscription says so when its record's did. */
    invalidate: (): void => {
      for (const entry of entries.values()) entry.update();
    },

    /** Forgets every subscription (sign out). */
    clear: (): void => {
      for (const entry of [...entries.values()]) entry.dispose();
      entries.clear();
    },

    /** Stops listening to the store (the layer is gone). */
    stop: unsubscribeStore,
  };
}

/** The record subscriptions of a records layer. */
export type RecordSubscriptions = ReturnType<typeof createRecordSubscriptions>;
