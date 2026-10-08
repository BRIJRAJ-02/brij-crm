// A view of records for the grid: its windows give the order, the store gives
// the bodies, and the member's own rows sit on top (spec 0006, AC-56): a row
// they edited keeps its place through a settle until it scrolls out of sight,
// and a record they created sits first until they leave. getSnapshot answers
// a new source object only when something on it changed (its windows, its
// pinned rows, or a record a loaded block holds), at most once a frame, so
// useSyncExternalStore re-renders the grid once per frame however many
// changes land, and never for a record this view doesn't show.
import type { RecordBody, RecordStore } from './store.ts';
import type { RowRange, Windows } from './windows.ts';

/** The grid's RowSource, as the view hands it over (structurally `RowSource<Row>` from `@crm/ui/grid`). */
export interface RecordSource<Row extends RecordBody> {
  readonly count: number;
  readonly getItem: (index: number) => Row | undefined;
  readonly getKey: (row: Row) => string;
  readonly onRangeChange: (range: RowRange) => void;
}

/** What a pinned row says (the grid's row note): made here, or no longer matching the view's filter. */
export type RowNote = 'new' | 'no-longer-matches';

/** A row the member is working on, held at a row of the screen while the server's order moves under it. */
export interface Pin {
  readonly id: string;
  /** The row it shows at, in the screen's rows. */
  readonly index: number;
  readonly note?: RowNote;
}

/** A view store for useSyncExternalStore. */
export interface RecordViewStore<Row extends RecordBody> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RecordSource<Row>;
  /** Something else the view's screen shows changed (its status, a cell's refusal): render again on the next frame. */
  readonly invalidate: () => void;
  /** Announces now whatever waits for the next frame (a view that just became ready, so its first render has rows). */
  readonly flush: () => void;
  /** The pinned rows now, by screen row. */
  readonly pins: () => readonly Pin[];
  /** Puts the pinned rows in place of the old ones (each held in the store while pinned). */
  readonly setPins: (pins: readonly Pin[]) => void;
  /** The screen row a record shows at: a pinned row's, or its place in the windows past the pins; undefined when not loaded. */
  readonly rowOf: (id: string) => number | undefined;
  /** The range on screen in the screen's rows (what the grid last asked for). */
  readonly shown: () => RowRange;
  readonly dispose: () => void;
}

/** Runs `flush` once, before the next frame paints. */
export type Scheduler = (flush: () => void) => void;

/** The browser's next frame; a timer where there are no frames (Node, a hidden worker). */
export const nextFrame: Scheduler = (flush) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else setTimeout(flush, 16);
};

/**
 * The view over `windows`, with bodies from `store` and `pins` on top,
 * announcing changes at most once per `schedule`d flush. A pinned row's place
 * in the windows (when loaded) is skipped, so it never shows twice, and the
 * rows between move by one around it.
 */
export function createRecordView<Row extends RecordBody>({
  store,
  windows,
  schedule = nextFrame,
  onShown = () => undefined,
}: {
  readonly store: RecordStore<Row>;
  readonly windows: Windows;
  readonly schedule?: Scheduler;
  /** The grid asked for a new range (in screen rows): pinned rows out of sight can let go. */
  readonly onShown?: (range: RowRange) => void;
}): RecordViewStore<Row> {
  const listeners = new Set<() => void>();
  let pins: readonly Pin[] = [];
  let shown: RowRange = { start: 0, end: 0 };
  const getKey = (row: Row) => row.id;

  /** The windows' rows a pinned record holds (skipped), in order. */
  const hiddenRows = () =>
    pins
      .map((pin) => windows.indexOf(pin.id))
      .filter((at): at is number => at !== undefined)
      .sort((a, b) => a - b);

  const snapshotOf = (): RecordSource<Row> => {
    const ordered = [...pins].sort((a, b) => a.index - b.index);
    const hidden = hiddenRows();
    const count = Math.max(0, windows.count() - hidden.length) + pins.length;
    const byIndex = new Map(ordered.map((pin) => [pin.index, pin]));
    /** The windows' row the screen's `index` shows, past the pins before it and the hidden rows. */
    const windowRow = (index: number) => {
      const before = ordered.filter((pin) => pin.index < index).length;
      let row = index - before;
      for (const skipped of hidden) if (skipped <= row) row += 1;
      return row;
    };
    const getItem = (index: number) => {
      const pin = byIndex.get(index);
      const id = pin === undefined ? windows.idAt(windowRow(index)) : pin.id;
      return id === undefined ? undefined : store.get(id);
    };
    const onRangeChange = (range: RowRange) => {
      shown = range;
      // The windows' rows the range covers, widened by the pins, which move rows by one each.
      windows.show({ start: Math.max(0, range.start - pins.length), end: range.end + pins.length });
      onShown(range);
    };
    return { count, getItem, getKey, onRangeChange };
  };

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
  const isShown = (id: string) => windows.has(id) || pins.some((pin) => pin.id === id);
  const stopStore = store.subscribe((ids) => {
    for (const id of ids) {
      if (isShown(id)) {
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
    flush,
    pins: () => pins,
    setPins: (next) => {
      const before = pins;
      pins = next;
      store.hold(next.map((pin) => pin.id));
      store.release(before.map((pin) => pin.id));
      changed();
    },
    rowOf: (id) => {
      const pin = pins.find((each) => each.id === id);
      if (pin !== undefined) return pin.index;
      const at = windows.indexOf(id);
      if (at === undefined) return undefined;
      const hidden = hiddenRows().filter((row) => row < at).length;
      const window = at - hidden;
      // Pins before it push it down: count them in screen rows.
      let index = window;
      for (const each of [...pins].sort((a, b) => a.index - b.index)) if (each.index <= index) index += 1;
      return index;
    },
    shown: () => shown,
    dispose: () => {
      isDisposed = true;
      stopStore();
      stopWindows();
      store.release(pins.map((pin) => pin.id));
      pins = [];
      windows.dispose();
    },
  };
}
