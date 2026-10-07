// A view of records for the grid: its windows give the order, the store gives
// the bodies. getSnapshot answers a new source object only when something on
// it changed (its windows, or a record a loaded block holds), at most once a
// frame, so useSyncExternalStore re-renders the grid once per frame however
// many changes land, and never for a record this view doesn't show.
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
  /** Something else the view's screen shows changed (its status, a cell's refusal): render again on the next frame. */
  readonly invalidate: () => void;
  readonly dispose: () => void;
}

/** Runs `flush` once, before the next frame paints. */
export type Scheduler = (flush: () => void) => void;

/** The browser's next frame; a timer where there are no frames (Node, a hidden worker). */
export const nextFrame: Scheduler = (flush) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else setTimeout(flush, 16);
};

/** The view over `windows`, with bodies from `store`, announcing changes at most once per `schedule`d flush. */
export function createRecordView<Row extends RecordBody>({
  store,
  windows,
  schedule = nextFrame,
}: {
  readonly store: RecordStore<Row>;
  readonly windows: Windows;
  readonly schedule?: Scheduler;
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
  let isDirty = false;
  let isScheduled = false;
  let isDisposed = false;

  const flush = () => {
    isScheduled = false;
    if (!isDirty || isDisposed) return;
    isDirty = false;
    snapshot = snapshotOf();
    for (const listener of listeners) listener();
  };
  const changed = () => {
    isDirty = true;
    if (isScheduled) return;
    isScheduled = true;
    schedule(flush);
  };
  const stopStore = store.subscribe((ids) => {
    for (const id of ids) {
      if (windows.has(id)) {
        changed();
        return;
      }
    }
  });
  const stopWindows = windows.subscribe(changed);
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    invalidate: changed,
    dispose: () => {
      isDisposed = true;
      stopStore();
      stopWindows();
      windows.dispose();
    },
  };
}
