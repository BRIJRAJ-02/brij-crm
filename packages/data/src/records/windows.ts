// A view's ordered ids, in blocks of 100 (spec 0005, windows). The store
// never orders rows: only the server knows the stored sort keys, so a view
// keeps which id sits at which position itself. Blocks hold ids; bodies live
// in the record store, which the windows hold them in (one hold per loaded id).

/** A range of row positions, `start` included and `end` excluded (the grid's ListRange). */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Loads the ids at `offset`, at most `limit` of them, putting their bodies in
 * the store on the way, each held once (`receive(rows, { hold: true })`).
 * The windows let go of those holds through `release`: when the block is
 * dropped or replaced, or at once when its answer comes too late to keep.
 */
export type BlockLoader = (offset: number, limit: number, signal: AbortSignal) => Promise<readonly string[]>;

/** Options for createWindows. */
export interface WindowsOptions {
  readonly load: BlockLoader;
  readonly count: number;
  /** Ids per block: 100. */
  readonly blockSize?: number;
  /** Blocks kept either side of the range on screen; further ones are dropped. 5. */
  readonly keep?: number;
  /** A block that failed to load; it loads again the next time it's on screen, or on `refresh`. */
  readonly onError?: (error: unknown) => void;
  /** Holds an id the windows took in without loading it (a record made here, `add`): `RecordStore.hold`. */
  readonly hold?: (ids: readonly string[]) => void;
  /** Lets go of the store's holds on ids the windows no longer keep (`RecordStore.release`). */
  readonly release?: (ids: readonly string[]) => void;
  /** Rows moved under the windows (a record deleted elsewhere): the count is out of date, so refetch it. */
  readonly onStale?: () => void;
}

/** A view's windows: which id is at which row, loaded around the range on screen. */
export interface Windows {
  readonly count: () => number;
  /** The id at `index`, or undefined while its block isn't loaded (or the row there is being refetched). */
  readonly idAt: (index: number) => string | undefined;
  /** Where a loaded id sits, or undefined when no loaded block holds it. */
  readonly indexOf: (id: string) => number | undefined;
  /** Whether a loaded block holds `id`: only those rows are on screen. */
  readonly has: (id: string) => boolean;
  /** The range on screen (plus overscan): loads its blocks, aborts and drops the far ones. An empty range changes nothing. */
  readonly show: (range: RowRange) => void;
  /** A new count (from `records.count`): replaces the old one, never adds to it; rows past a smaller count go. */
  readonly setCount: (count: number) => void;
  /**
   * A record made here: it joins the end (the loop's order is creation
   * order) and the count goes up by one. Its id is held while the last block
   * is loaded; otherwise that block brings it when it loads. Answers its row.
   */
  readonly add: (id: string) => number;
  /** A record `add`ed here that the server refused: it leaves and the count goes back down. */
  readonly withdraw: (id: string) => void;
  /**
   * Records gone elsewhere (deleted, out of reach): their rows empty at once,
   * and their blocks and every later loaded block load again, since the rows
   * after them moved up; `onStale` refetches the count.
   */
  readonly drop: (ids: ReadonlySet<string>) => void;
  /** Loads every loaded block, and every block on screen, again (a retry, or live changes missed). */
  readonly refresh: () => void;
  /** How many blocks hold ids now, and how many are loading. */
  readonly stats: () => { readonly loaded: number; readonly loading: number };
  readonly subscribe: (listener: () => void) => () => void;
  /** Aborts every load, forgets every block and lets go of its ids. */
  readonly dispose: () => void;
}

type Block = readonly (string | undefined)[];

const idsIn = (block: Block): readonly string[] => block.filter((id): id is string => id !== undefined);

/** A view's windows over `load`, starting with nothing loaded. */
export function createWindows({
  load,
  count: initialCount,
  blockSize = 100,
  keep = 5,
  onError,
  hold = () => undefined,
  release = () => undefined,
  onStale = () => undefined,
}: WindowsOptions): Windows {
  let count = initialCount;
  let shown: RowRange = { start: 0, end: 0 };
  const blocks = new Map<number, Block>();
  // Where each loaded id sits, so a store change can tell whether it's on screen.
  const positions = new Map<string, number>();
  const loading = new Map<number, AbortController>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const blockOf = (index: number) => Math.floor(index / blockSize);
  const blockCount = () => Math.ceil(count / blockSize);
  const isFar = (block: number) =>
    block < blockOf(shown.start) - keep || block > blockOf(Math.max(shown.start, shown.end - 1)) + keep;

  /**
   * Puts `next` in place of `block` (or empties it), keeping the positions.
   * A block fresh from the loader came with a hold on each of its ids, so
   * every old id is let go; a block changed in place lets go only of the ids
   * it no longer has.
   */
  const setBlock = (block: number, next: Block | undefined, isFresh = false) => {
    const before = blocks.get(block) ?? [];
    before.forEach((id, at) => {
      if (id !== undefined && positions.get(id) === block * blockSize + at) positions.delete(id);
    });
    if (next === undefined) blocks.delete(block);
    else {
      blocks.set(block, next);
      next.forEach((id, at) => {
        if (id !== undefined) positions.set(id, block * blockSize + at);
      });
    }
    // Let go of the old holds only after the new ones are in, so an id in both never leaves the store.
    const kept = new Set(isFresh || next === undefined ? [] : idsIn(next));
    release(idsIn(before).filter((id) => !kept.has(id)));
  };

  const fetchBlock = (block: number) => {
    // A newer request for the block supersedes any still running.
    loading.get(block)?.abort();
    const controller = new AbortController();
    loading.set(block, controller);
    load(block * blockSize, blockSize, controller.signal).then(
      (ids) => {
        if (loading.get(block) !== controller || isFar(block) || block >= blockCount()) {
          if (loading.get(block) === controller) loading.delete(block);
          release(ids);
          return;
        }
        loading.delete(block);
        // Never past the count: a smaller count arrived while this block loaded.
        const room = count - block * blockSize;
        setBlock(block, ids.length > room ? ids.slice(0, room) : ids, true);
        if (ids.length > room) release(ids.slice(room));
        notify();
      },
      (error: unknown) => {
        if (loading.get(block) !== controller) return;
        loading.delete(block);
        if (!controller.signal.aborted) onError?.(error);
      },
    );
  };

  /** Loads each block the range on screen covers that isn't loaded or loading. */
  const loadShown = () => {
    if (count === 0 || shown.end <= shown.start) return;
    const first = blockOf(shown.start);
    const last = Math.min(blockOf(shown.end - 1), blockCount() - 1);
    for (let block = first; block <= last; block += 1) {
      if (!blocks.has(block) && !loading.has(block)) fetchBlock(block);
    }
  };

  const drop = (ids: ReadonlySet<string>) => {
    let first: number | undefined;
    for (const id of ids) {
      const at = positions.get(id);
      if (at === undefined) continue;
      const block = blockOf(at);
      const current = blocks.get(block);
      if (current === undefined) continue;
      setBlock(
        block,
        current.map((each) => (each === id ? undefined : each)),
      );
      first = first === undefined ? block : Math.min(first, block);
    }
    if (first === undefined) return;
    // Every row after a gone one moved up a place: load its block and the later ones again.
    const from = first;
    for (const block of [...blocks.keys()].filter((each) => each >= from)) fetchBlock(block);
    onStale();
    notify();
  };

  return {
    count: () => count,
    idAt: (index) => blocks.get(blockOf(index))?.[index % blockSize],
    indexOf: (id) => positions.get(id),
    has: (id) => positions.has(id),
    show: (range) => {
      if (range.end <= range.start) return;
      shown = range;
      for (const [block, controller] of loading) {
        if (isFar(block)) {
          controller.abort();
          loading.delete(block);
        }
      }
      let evicted = false;
      for (const block of [...blocks.keys()]) {
        if (isFar(block)) {
          setBlock(block, undefined);
          evicted = true;
        }
      }
      loadShown();
      if (evicted) notify();
    },
    setCount: (next) => {
      if (next === count) return;
      count = next;
      const end = blockCount();
      for (const [block, controller] of loading) {
        if (block >= end) {
          controller.abort();
          loading.delete(block);
        }
      }
      for (const [block, ids] of [...blocks]) {
        const room = count - block * blockSize;
        if (room <= 0) setBlock(block, undefined);
        else if (ids.length > room) setBlock(block, ids.slice(0, room));
      }
      loadShown();
      notify();
    },
    add: (id) => {
      const index = count;
      const block = blockOf(index);
      const at = index % blockSize;
      count += 1;
      // The row's block is loaded, or it starts a new block right after a loaded one (or the first).
      const current = blocks.get(block) ?? (at === 0 && (block === 0 || blocks.has(block - 1)) ? [] : undefined);
      if (current !== undefined) {
        hold([id]);
        const padded =
          current.length >= at ? current.slice(0, at) : [...current, ...new Array<undefined>(at - current.length)];
        setBlock(block, [...padded, id]);
      }
      notify();
      return index;
    },
    withdraw: (id) => {
      const at = positions.get(id);
      if (at !== undefined && at !== count - 1) {
        // Something joined after it: its place empties and the rows after it load again.
        drop(new Set([id]));
        return;
      }
      count = Math.max(0, count - 1);
      if (at !== undefined) {
        const block = blockOf(at);
        setBlock(block, at % blockSize === 0 ? undefined : (blocks.get(block) ?? []).slice(0, at % blockSize));
      }
      notify();
    },
    drop,
    refresh: () => {
      for (const block of new Set([...blocks.keys(), ...loading.keys()])) fetchBlock(block);
      loadShown();
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
      for (const block of [...blocks.keys()]) setBlock(block, undefined);
    },
  };
}
