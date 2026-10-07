// The plain record store: a Map of entries by id, each a base with its
// optimistic layers, and the composed row cached until the entry changes.
// Screens read it through useSyncExternalStore (the view's subscribe and
// getSnapshot). AC-40's prototype gate measured it against TanStack DB.
import {
  composeRecord,
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

/** A record store on a plain Map, with the layering rule kept per record. */
export function createPlainStore<Row extends RecordBody>(): RecordStore<Row> {
  const entries = new Map<string, Entry<Row>>();
  const listeners = new Set<StoreListener>();

  const notify = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    for (const listener of listeners) listener(ids);
  };

  /** Writes an entry (or drops it once it has neither base nor layers), and says whether what shows changed. */
  const put = (id: string, base: Row | undefined, layers: readonly PendingLayer<Row>[]): boolean => {
    const before = entries.get(id)?.shown;
    if (base === undefined && layers.length === 0) {
      entries.delete(id);
      return before !== undefined;
    }
    const shown = layers.length === 0 ? base : composeRecord(base, layers);
    entries.set(id, { base, layers, shown });
    return shown !== before;
  };

  const settle = (recordId: string, layerId: string, base: Row | undefined, replaceBase: boolean) => {
    const entry = entries.get(recordId);
    if (entry === undefined) return;
    const layers = remainingLayers(entry.layers, layerId, replaceBase);
    if (put(recordId, replaceBase ? base : entry.base, layers)) notify(new Set([recordId]));
  };

  const layerFor = (recordId: string, layer: PendingLayer<Row>): Layer<Row> => {
    let done = false;
    return {
      id: layer.id,
      recordId,
      confirm: (row) => {
        if (done) return;
        done = true;
        settle(recordId, layer.id, row, true);
      },
      refuse: () => {
        if (done) return;
        done = true;
        settle(recordId, layer.id, undefined, false);
      },
    };
  };

  const addLayer = (recordId: string, layer: PendingLayer<Row>): Layer<Row> => {
    const entry = entries.get(recordId);
    if (put(recordId, entry?.base, [...(entry?.layers ?? []), layer])) notify(new Set([recordId]));
    return layerFor(recordId, layer);
  };

  return {
    get: (id) => entries.get(id)?.shown,
    receive: (rows) => {
      const changed = new Set<string>();
      for (const row of rows) {
        if (put(row.id, row, entries.get(row.id)?.layers ?? [])) changed.add(row.id);
      }
      notify(changed);
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
      notify(ids);
    },
  };
}
