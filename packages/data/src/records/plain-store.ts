// The plain record store: a Map of entries by id, each a base with its
// optimistic layers, and the composed row cached until the entry changes.
// Screens read it through useSyncExternalStore (the view's subscribe and
// getSnapshot). AC-40's prototype gate (tools/data-gate) measured it against TanStack DB.
//
// It holds only what something refers to: every id is reference counted
// (windows, open record views) and a record with pending layers stays too, so
// a body leaves the moment its last holder lets go and memory stays flat
// while a table scrolls.
import {
  composeRecord,
  newerBase,
  remainingLayers,
  type Layer,
  type RecordBody,
  type RecordStore,
  type RecordValues,
  type StoreListener,
} from './store.ts';

interface PendingLayer<Row extends RecordBody> {
  readonly id: string;
  readonly values: RecordValues;
  readonly draft?: Row;
}

interface Entry<Row extends RecordBody> {
  readonly base: Row | undefined;
  readonly layers: readonly PendingLayer<Row>[];
  /** The composed row, built once per change, so screens get the same object until it changes. */
  readonly shown: Row | undefined;
}

/** Whether two JSON shaped values (what the API sends) hold the same data. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameData(item, b[index]));
  }
  const left = Object.entries(a);
  const right = b as Record<string, unknown>;
  return left.length === Object.keys(right).length && left.every(([key, value]) => sameData(value, right[key]));
}

/** A record store on a plain Map, with the layering rule kept per record and bodies reference counted. */
export function createPlainStore<Row extends RecordBody>(): RecordStore<Row> {
  const entries = new Map<string, Entry<Row>>();
  const holds = new Map<string, number>();
  const listeners = new Set<StoreListener>();

  const notify = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    for (const listener of listeners) listener(ids);
  };

  const isHeld = (id: string) => (holds.get(id) ?? 0) > 0;

  /**
   * Writes an entry, or drops it once nothing holds it and no layer waits on
   * it (or it has neither base nor layers), and says whether what shows changed.
   */
  const put = (id: string, base: Row | undefined, layers: readonly PendingLayer<Row>[]): boolean => {
    const before = entries.get(id);
    if ((base === undefined || !isHeld(id)) && layers.length === 0) {
      entries.delete(id);
      return before?.shown !== undefined;
    }
    // The same base and layers show the same row: keep the object, so nothing re-renders.
    if (before !== undefined && before.base === base && before.layers === layers) return false;
    const shown = layers.length === 0 ? base : composeRecord(base, layers);
    entries.set(id, { base, layers, shown });
    return shown !== before?.shown;
  };

  /** A server row as the record's base, keeping the old object when it holds the same data. */
  const baseFrom = (current: Row | undefined, row: Row): Row => {
    const next = newerBase(current, row);
    return current !== undefined && next !== current && sameData(next, current) ? current : next;
  };

  const settle = (recordId: string, layer: PendingLayer<Row>, row: Row | undefined, confirmed: boolean) => {
    const entry = entries.get(recordId);
    if (entry === undefined) return;
    // A refused create takes every edit made on its draft with it: there is no record for them to land on.
    const isRefusedDraft = !confirmed && layer.draft !== undefined && entry.base === undefined;
    const layers = isRefusedDraft ? [] : remainingLayers(entry.layers, layer.id, confirmed);
    const base = confirmed && row !== undefined ? baseFrom(entry.base, row) : entry.base;
    if (put(recordId, base, layers)) notify(new Set([recordId]));
  };

  const layerFor = (recordId: string, layer: PendingLayer<Row>): Layer<Row> => {
    let done = false;
    return {
      id: layer.id,
      recordId,
      confirm: (row) => {
        if (done) return;
        done = true;
        settle(recordId, layer, row, true);
      },
      refuse: () => {
        if (done) return;
        done = true;
        settle(recordId, layer, undefined, false);
      },
    };
  };

  const addLayer = (recordId: string, layer: PendingLayer<Row>): Layer<Row> => {
    const entry = entries.get(recordId);
    if (put(recordId, entry?.base, [...(entry?.layers ?? []), layer])) notify(new Set([recordId]));
    return layerFor(recordId, layer);
  };

  const hold = (ids: Iterable<string>) => {
    for (const id of ids) holds.set(id, (holds.get(id) ?? 0) + 1);
  };

  return {
    get: (id) => entries.get(id)?.shown,
    receive: (rows, options) => {
      if (options?.hold === true) hold(rows.map((row) => row.id));
      const changed = new Set<string>();
      for (const row of rows) {
        const entry = entries.get(row.id);
        // Nobody holds it and nothing waits on it: nothing shows it, so it isn't kept.
        if (entry === undefined && !isHeld(row.id)) continue;
        const base = baseFrom(entry?.base, row);
        if (put(row.id, base, entry?.layers ?? [])) changed.add(row.id);
      }
      notify(changed);
    },
    hold,
    release: (ids) => {
      for (const id of ids) {
        const count = (holds.get(id) ?? 0) - 1;
        if (count > 0) {
          holds.set(id, count);
          continue;
        }
        holds.delete(id);
        const entry = entries.get(id);
        // Evicted at zero; a record with a pending layer stays until its answer.
        if (entry !== undefined && entry.layers.length === 0) entries.delete(id);
      }
    },
    remove: (ids) => {
      const changed = new Set<string>();
      for (const id of ids) if (entries.delete(id)) changed.add(id);
      notify(changed);
    },
    edit: (recordId, values, mutationId) => addLayer(recordId, { id: mutationId, values }),
    create: (draft, mutationId) => addLayer(draft.id, { id: mutationId, values: draft.values, draft }),
    pending: () => {
      const ids = new Set<string>();
      for (const [id, entry] of entries) if (entry.layers.length > 0) ids.add(id);
      return ids;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    size: () => entries.size,
    clear: () => {
      const ids = new Set(entries.keys());
      entries.clear();
      holds.clear();
      notify(ids);
    },
  };
}
