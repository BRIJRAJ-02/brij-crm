// The record store on TanStack DB, the one module that imports it (AC-40's
// prototype gate, which chose the plain store; this stays so the gate can be
// rerun, and is never shipped). Server rows go in through the collection's sync
// begin/write/commit; each edit is a manual TanStack transaction, held
// pending while its request is out, so a sync write is never deferred
// behind it.
//
// TanStack DB alone can't keep the layering rule: a transaction's optimistic
// row is the whole row as it stood when the edit was made, so a later layer
// carries an earlier edit's value with it, and a new base underneath never
// shows through. So the store keeps the layers itself, as the plain store
// does, and whenever a record's base or layers change it rolls back that
// record's transactions and makes them again on top of the new base.
import {
  createCollection,
  createTransaction,
  type ChangeMessageOrDeleteKeyMessage,
  type Transaction,
} from '@tanstack/db';
import {
  remainingLayers,
  type Layer,
  type RecordBody,
  type RecordStore,
  type RecordValues,
  type StoreListener,
} from '../src/records/store.ts';

interface SyncWriter<Row extends object> {
  readonly begin: (options?: { immediate?: boolean }) => void;
  readonly write: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void;
  readonly commit: () => unknown;
  readonly truncate: () => void;
}

interface PendingLayer<Row extends RecordBody> {
  readonly id: string;
  readonly values: RecordValues;
  readonly draft?: Row;
  /** The TanStack transaction showing it now; replaced each time the record's layers are rebuilt. */
  readonly transaction: Transaction<Row>;
}

/** A record store on a TanStack DB collection, with the layers kept beside it per record. */
export function createTanstackStore<Row extends RecordBody>({
  id = 'records',
}: { readonly id?: string } = {}): RecordStore<Row> {
  let writer: SyncWriter<Row> | undefined;
  const collection = createCollection<Row, string>({
    id,
    getKey: (row) => row.id,
    gcTime: 0,
    startSync: true,
    sync: {
      rowUpdateMode: 'full',
      sync: ({ begin, write, commit, truncate, markReady }) => {
        writer = { begin, write, commit, truncate };
        markReady();
      },
    },
  });
  const layers = new Map<string, readonly PendingLayer<Row>[]>();
  const listeners = new Set<StoreListener>();
  const notify = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    for (const listener of listeners) listener(ids);
  };

  // Change events gather here while the store works, so one call notifies once.
  let gathering: Set<string> | undefined;
  // The subscription lives as long as the store (the real layer drops the store on sign out).
  collection.subscribeChanges((changes) => {
    const ids = gathering ?? new Set<string>();
    for (const change of changes) ids.add(change.key);
    if (gathering === undefined) notify(ids);
  });

  const gather = (work: () => void) => {
    const outer = gathering;
    if (outer !== undefined) {
      work();
      return;
    }
    const ids = new Set<string>();
    gathering = ids;
    try {
      work();
    } finally {
      gathering = undefined;
    }
    notify(ids);
  };

  const sync = (): SyncWriter<Row> => {
    if (writer === undefined) throw new Error('The record collection has not started syncing.');
    return writer;
  };

  /** Shows one layer as a TanStack transaction on top of whatever the record shows now. */
  const show = (recordId: string, layer: Omit<PendingLayer<Row>, 'transaction'>): PendingLayer<Row> => {
    const transaction = createTransaction<Row>({ autoCommit: false, mutationFn: () => Promise.resolve() });
    // A rolled back transaction rejects its promise; nothing awaits it here.
    transaction.when('settled').catch(() => undefined);
    transaction.mutate(() => {
      if (!collection.has(recordId)) {
        // No base, and no draft under this layer (it was refused): nothing to show the edit on.
        if (layer.draft !== undefined) collection.insert(layer.draft);
        return;
      }
      collection.update(recordId, (draft) => {
        (draft as { values: RecordValues }).values = { ...draft.values, ...layer.values };
      });
    });
    return { ...layer, transaction };
  };

  /** Rolls back every layer on a record, runs `between` (a base write), then shows `keep` again in order. */
  const rebuild = (recordId: string, keep: readonly Omit<PendingLayer<Row>, 'transaction'>[], between?: () => void) => {
    gather(() => {
      for (const layer of layers.get(recordId) ?? []) {
        if (layer.transaction.state === 'pending') layer.transaction.rollback();
      }
      between?.();
      const shown = keep.map((layer) => show(recordId, layer));
      if (shown.length === 0) layers.delete(recordId);
      else layers.set(recordId, shown);
    });
  };

  const writeBases = (rows: readonly Row[]) => {
    const { begin, write, commit } = sync();
    begin({ immediate: true });
    for (const row of rows) {
      // Callers roll a record's layers back first, so `has` speaks for the synced row alone.
      write(collection.has(row.id) ? { type: 'update', value: row } : { type: 'insert', value: row });
    }
    commit();
  };

  const layerFor = (recordId: string, layerId: string): Layer<Row> => {
    let done = false;
    const without = (confirmed: boolean) => remainingLayers(layers.get(recordId) ?? [], layerId, confirmed);
    return {
      id: layerId,
      recordId,
      confirm: (row) => {
        if (done) return;
        done = true;
        rebuild(recordId, without(true), () => {
          writeBases([row]);
        });
      },
      refuse: () => {
        if (done) return;
        done = true;
        rebuild(recordId, without(false));
      },
    };
  };

  const addLayer = (recordId: string, layer: Omit<PendingLayer<Row>, 'transaction'>): Layer<Row> => {
    gather(() => {
      layers.set(recordId, [...(layers.get(recordId) ?? []), show(recordId, layer)]);
    });
    return layerFor(recordId, layer.id);
  };

  return {
    get: (recordId) => collection.get(recordId),
    receive: (rows) => {
      gather(() => {
        const layered = rows.filter((row) => layers.has(row.id));
        if (layered.length === 0) {
          writeBases(rows);
          return;
        }
        // A record with layers: its transactions hold a stale whole row, so they're made again on the new base.
        for (const row of layered) {
          for (const layer of layers.get(row.id) ?? []) {
            if (layer.transaction.state === 'pending') layer.transaction.rollback();
          }
        }
        writeBases(rows);
        for (const row of layered) rebuild(row.id, layers.get(row.id) ?? []);
      });
    },
    remove: (ids) => {
      gather(() => {
        for (const recordId of ids) rebuild(recordId, []);
        const { begin, write, commit } = sync();
        begin({ immediate: true });
        for (const recordId of ids) if (collection.has(recordId)) write({ type: 'delete', key: recordId });
        commit();
      });
    },
    edit: (recordId, values, mutationId) => addLayer(recordId, { id: mutationId, values }),
    create: (draft, mutationId) => addLayer(draft.id, { id: mutationId, values: draft.values, draft }),
    pending: () => new Set(layers.keys()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    size: () => collection.size,
    clear: () => {
      gather(() => {
        for (const recordId of [...layers.keys()]) rebuild(recordId, []);
        const { begin, truncate, commit } = sync();
        begin({ immediate: true });
        truncate();
        commit();
      });
    },
  };
}

/** What TanStack DB does on its own with two optimistic edits to one record (each `true` breaks the layering rule). */
export interface TanstackLayeringFindings {
  /** Refusing (rolling back) an edit also rolls back a later pending edit to another cell of the same record. */
  readonly refusalTakesLaterEdit: boolean;
  /** A later edit's optimistic row carries an earlier edit's value, so it outlives the earlier edit's own refusal. */
  readonly laterEditCarriesEarlierValue: boolean;
  /** A new server row under a pending edit doesn't show through, even in cells the edit never touched. */
  readonly newBaseHiddenUnderEdit: boolean;
  /** A sync write (without `immediate`) waits while any transaction on the collection is persisting. */
  readonly syncWriteWaitsForTransaction: boolean;
}

/**
 * The gate's evidence, rerunnable: TanStack DB's own transactions, with no
 * layers kept beside them, against the layering rule. Each record is a whole
 * row in one collection, edited through manual transactions as the docs show.
 */
export async function probeTanstackLayering(): Promise<TanstackLayeringFindings> {
  interface Row {
    readonly id: string;
    readonly values: RecordValues;
  }
  let probes = 0;
  const open = () => {
    let writer: SyncWriter<Row> | undefined;
    probes += 1;
    const collection = createCollection<Row, string>({
      id: `layering-probe-${String(probes)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      startSync: true,
      sync: {
        rowUpdateMode: 'full',
        sync: ({ begin, write, commit, truncate, markReady }) => {
          writer = { begin, write, commit, truncate };
          markReady();
        },
      },
    });
    const put = (values: RecordValues, immediate = true) => {
      if (writer === undefined) throw new Error('The probe collection has not started syncing.');
      writer.begin(immediate ? { immediate: true } : undefined);
      writer.write({ type: collection.has('r1') ? 'update' : 'insert', value: { id: 'r1', values } });
      writer.commit();
    };
    const edit = (values: RecordValues) => {
      // The request never answers: the edit stays in flight until the probe rolls it back.
      const transaction = createTransaction<Row>({
        autoCommit: false,
        mutationFn: () => new Promise<void>(() => undefined),
      });
      transaction.when('settled').catch(() => undefined);
      transaction.mutate(() => {
        collection.update('r1', (draft) => {
          (draft as { values: RecordValues }).values = { ...draft.values, ...values };
        });
      });
      return transaction;
    };
    const shown = () => collection.get('r1')?.values;
    put({ domain: 'base.com', fit: 3, employees: '1' });
    return { put, edit, shown };
  };
  const tick = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

  const one = open();
  const first = one.edit({ domain: 'first.com' });
  const later = one.edit({ fit: 1 });
  first.rollback();
  const refusalTakesLaterEdit = later.state === 'failed' && one.shown()?.fit === 3;

  const two = open();
  const earlier = two.edit({ domain: 'first.com' });
  two.edit({ fit: 1 });
  // Take the earlier edit back alone (as our own refusal would want), without the cascade.
  earlier.rollback({ isSecondaryRollback: true });
  const laterEditCarriesEarlierValue = two.shown()?.domain === 'first.com';
  two.put({ domain: 'server.com', fit: 3, employees: '7' });
  const newBaseHiddenUnderEdit = two.shown()?.employees !== '7';

  const three = open();
  const persisting = three.edit({ domain: 'first.com' });
  void persisting.commit().catch(() => undefined);
  await tick();
  three.put({ domain: 'base.com', fit: 3, employees: '99' }, false);
  await tick();
  const syncWriteWaitsForTransaction = persisting.state === 'persisting' && three.shown()?.employees === '1';

  return { refusalTakesLaterEdit, laterEditCarriesEarlierValue, newBaseHiddenUnderEdit, syncWriteWaitsForTransaction };
}
