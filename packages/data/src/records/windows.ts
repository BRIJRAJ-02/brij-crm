// A view's ordered ids, in blocks of 100 (spec 0005, windows). The store
// never orders rows: only the server knows the stored sort keys, so a view
// keeps which id sits at which position itself. Blocks hold ids; bodies live
// in the record store.

/** A range of row positions, `start` included and `end` excluded (the grid's ListRange). */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

/** Loads the ids at `offset`, at most `limit` of them, putting their bodies in the store on the way. */
export type BlockLoader = (offset: number, limit: number, signal: AbortSignal) => Promise<readonly string[]>;

/** Options for createWindows. */
export interface WindowsOptions {
  readonly load: BlockLoader;
  readonly count: number;
  /** Ids per block: 100. */
  readonly blockSize?: number;
  /** Blocks kept either side of the range on screen; further ones are dropped. 5. */
  readonly keep?: number;
  /** A block that failed to load; it loads again the next time it's on screen. */
  readonly onError?: (error: unknown) => void;
}

/** A view's windows: which id is at which row, loaded around the range on screen. */
export interface Windows {
  readonly count: () => number;
  /** The id at `index`, or undefined while its block isn't loaded. */
  readonly idAt: (index: number) => string | undefined;
  /** The range on screen (plus overscan): loads its blocks, aborts and drops the far ones. */
  readonly show: (range: RowRange) => void;
  /** A new count (from `records.count`): replaces the old one, never adds to it. */
  readonly setCount: (count: number) => void;
  /** Takes ids out of every block (deleted elsewhere); later rows move up. */
  readonly drop: (ids: ReadonlySet<string>) => void;
  /** How many blocks hold ids now, and how many are loading. */
  readonly stats: () => { readonly loaded: number; readonly loading: number };
  readonly subscribe: (listener: () => void) => () => void;
  /** Aborts every load and forgets every block. */
  readonly dispose: () => void;
}

/** A view's windows over `load`, starting with nothing loaded. */
export function createWindows({
  load,
  count: initialCount,
  blockSize = 100,
  keep = 5,
  onError,
}: WindowsOptions): Windows {
  let count = initialCount;
  let shown: RowRange = { start: 0, end: 0 };
  const blocks = new Map<number, readonly string[]>();
  const loading = new Map<number, AbortController>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const blockOf = (index: number) => Math.floor(index / blockSize);
  const lastBlock = () => Math.max(0, Math.ceil(count / blockSize) - 1);
  const isFar = (block: number) =>
    block < blockOf(shown.start) - keep || block > blockOf(Math.max(shown.start, shown.end - 1)) + keep;

  const fetchBlock = (block: number) => {
    const controller = new AbortController();
    loading.set(block, controller);
    load(block * blockSize, blockSize, controller.signal).then(
      (ids) => {
        if (loading.get(block) !== controller) return;
        loading.delete(block);
        if (isFar(block)) return;
        blocks.set(block, ids);
        notify();
      },
      (error: unknown) => {
        if (loading.get(block) !== controller) return;
        loading.delete(block);
        if (!controller.signal.aborted) onError?.(error);
      },
    );
  };

  return {
    count: () => count,
    idAt: (index) => blocks.get(blockOf(index))?.[index % blockSize],
    show: (range) => {
      shown = range;
      if (range.end <= range.start) return;
      for (const [block, controller] of loading) {
        if (isFar(block)) {
          controller.abort();
          loading.delete(block);
        }
      }
      let evicted = false;
      for (const block of blocks.keys()) {
        if (isFar(block)) {
          blocks.delete(block);
          evicted = true;
        }
      }
      const first = blockOf(range.start);
      const last = Math.min(blockOf(range.end - 1), lastBlock());
      for (let block = first; block <= last; block += 1) {
        if (!blocks.has(block) && !loading.has(block)) fetchBlock(block);
      }
      if (evicted) notify();
    },
    setCount: (next) => {
      if (next === count) return;
      count = next;
      notify();
    },
    drop: (ids) => {
      // Simple and rare: rebuild the loaded blocks without the ids. Row positions after them shift up by the
      // number dropped before them, which the next load of later blocks corrects.
      let changed = false;
      for (const [block, blockIds] of blocks) {
        const kept = blockIds.filter((id) => !ids.has(id));
        if (kept.length !== blockIds.length) {
          blocks.set(block, kept);
          changed = true;
        }
      }
      if (changed) notify();
    },
    stats: () => ({ loaded: blocks.size, loading: loading.size }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      for (const controller of loading.values()) controller.abort();
      loading.clear();
      blocks.clear();
    },
  };
}
