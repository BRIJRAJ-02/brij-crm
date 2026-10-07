// A view of records for the grid: its windows give the order, the store gives
// the bodies. getSnapshot answers a new source object whenever either
// changes, so useSyncExternalStore re-renders the grid, and the same object
// otherwise, so nothing renders twice.
import type { RecordBody, RecordStore } from './store.ts';
import type { RowRange, Windows } from './windows.ts';

/** The grid's RowSource, as the view hands it over (structurally `RowSource<Row>` from `@crm/ui/grid`). */
export interface RecordSource<Row extends RecordBody> {
  readonly count: number;
  readonly getItem: (index: number) => Row | undefined;
  readonly getKey: (row: Row) => string;
  readonly onRangeChange: (range: RowRange) => void;
}

/** A view store for useSyncExternalStore. */
export interface RecordViewStore<Row extends RecordBody> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RecordSource<Row>;
  readonly dispose: () => void;
}

/** The view over `windows`, with bodies from `store`. */
export function createRecordView<Row extends RecordBody>({
  store,
  windows,
}: {
  readonly store: RecordStore<Row>;
  readonly windows: Windows;
}): RecordViewStore<Row> {
  const listeners = new Set<() => void>();
  const getKey = (row: Row) => row.id;
  const getItem = (index: number) => {
    const id = windows.idAt(index);
    return id === undefined ? undefined : store.get(id);
  };
  const onRangeChange = (range: RowRange) => {
    windows.show(range);
  };
  const snapshotOf = (): RecordSource<Row> => ({ count: windows.count(), getItem, getKey, onRangeChange });
  let snapshot = snapshotOf();
  const changed = () => {
    snapshot = snapshotOf();
    for (const listener of listeners) listener();
  };
  const stopStore = store.subscribe(changed);
  const stopWindows = windows.subscribe(changed);
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    dispose: () => {
      stopStore();
      stopWindows();
      windows.dispose();
    },
  };
}
