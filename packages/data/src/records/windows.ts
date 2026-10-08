// A view's ordered ids, in blocks of 100 (spec 0006, windows). The store
// never orders rows: only the server knows the stored sort keys, so a window
// keeps which id sits at which row itself. Blocks hold ids; bodies live in
// the record store, which the windows hold them in (one hold per loaded id).
//
// Two modes (`canJump` in `@crm/contracts` picks): by position, where block b
// is read at row b × 100; and by cursor, where blocks form a chain and each
// block's checkpoint is the `nextCursor` that ended the block before it. A
// block far from the screen is dropped and keeps its checkpoint, so scrolling
// back reloads it with one call.

/** A range of row positions, `start` included and `end` excluded (the grid's ListRange). */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

/** How a window reads: jumping to a row by position, or paging forward by cursor. */
export type WindowMode = 'position' | 'cursor';

/** Where a read starts: a row (position mode), or after a checkpoint (cursor mode; none for the first block). */
export interface ReadFrom {
  readonly position?: number;
  readonly cursor?: string;
}

/** What one read answered: its ids in order, and the cursor after the last when there are more. */
export interface BlockRead {
  readonly ids: readonly string[];
  readonly nextCursor?: string;
}

/**
 * Reads `limit` ids from `from`, putting their bodies in the store on the way,
 * each held once (`receive(rows, { hold: true })`). The windows let go of
 * those holds through `release`: when the block is dropped or replaced, or
 * at once when its answer comes too late to keep.
 */
export type BlockReader = (from: ReadFrom, limit: number, signal: AbortSignal) => Promise<BlockRead>;

/** The count a window was told (`records.count`): exact, or at least `count` (10,000+, a filtered view). */
export interface WindowCount {
  readonly count: number;
  readonly atLeast: boolean;
}

/** Options for createWindows. */
export interface WindowsOptions {
  /** Read when a block loads, so a window can learn its mode before its first read. */
  readonly mode: () => WindowMode;
  readonly read: BlockReader;
  /** Ids per block: 100. */
  readonly blockSize?: number;
  /** Ids per read when a cursor window reads ahead of its chain (a scrollbar drag): 200, the API's `MAX_PAGE`. */
  readonly jumpSize?: number;
  /** Blocks kept either side of the range on screen; further ones are dropped. 5. */
  readonly keep?: number;
  /**
   * A read failed (not aborted). `withCursor` says whether it carried a
   * checkpoint, so a refused cursor can restart the chain. The block loads
   * again the next time it's on screen, or on `refresh`.
   */
  readonly onError?: (error: unknown, read: { readonly withCursor: boolean }) => void;
  /** A read landed: the run of failures, and the one restart a refused cursor allows, start over. */
  readonly onRead?: () => void;
  /** Lets go of the store's holds on ids the windows no longer keep (`RecordStore.release`). */
  readonly release?: (ids: readonly string[]) => void;
  /** Rows moved under the windows (fewer than the count promised, a record gone): the count is out of date. */
  readonly onStale?: () => void;
}

/** A view's windows: which id is at which row, loaded around the range on screen. */
export interface Windows {
  /** The rows the scrollbar covers: the count, or in a cursor window past 10,000, the rows loaded beyond it. */
  readonly count: () => number;
  /** The count `records.count` last answered (or the end a cursor chain reached). */
  readonly told: () => WindowCount;
  /** The id at `index`, or undefined while its block isn't loaded. */
  readonly idAt: (index: number) => string | undefined;
  /** Where a loaded id sits, or undefined when no loaded block holds it. */
  readonly indexOf: (id: string) => number | undefined;
  /** Whether a loaded block holds `id`: only those rows are on screen. */
  readonly has: (id: string) => boolean;
  /** Every id the loaded blocks hold. */
  readonly loadedIds: () => readonly string[];
  /** The range on screen (plus overscan) now; empty before the first `show`. */
  readonly shown: () => RowRange;
  /** The range on screen (plus overscan): loads its blocks, aborts and drops the far ones. An empty range changes nothing. */
  readonly show: (range: RowRange) => void;
  /** A new count (from `records.count`): replaces the old one, never adds to it; rows past a smaller exact count go. */
  readonly setCount: (count: WindowCount) => void;
  /**
   * Records gone elsewhere (deleted, out of reach): their rows empty at once,
   * and their blocks and every later loaded block load again, since the rows
   * after them moved up; `onStale` refetches the count.
   */
  readonly drop: (ids: ReadonlySet<string>) => void;
  /** Loads every loaded block, and every block on screen, again (a retry). */
  readonly refresh: () => void;
  /** Loads the blocks on screen that aren't loaded or loading (one that failed, tried again). */
  readonly loadMissing: () => void;
  /** Starts a cursor chain again from block 0, forgetting every block and checkpoint (a refused cursor). */
  readonly restart: () => void;
  /**
   * Reads the blocks on screen again in one go and lets go of the other
   * loaded blocks (settle, spec 0006, AC-56): by position from the first
   * block on screen, or by cursor from its checkpoint (the nearest one
   * before it), as many rows as the screen spans, in reads of up to 200.
   * The new rows replace the old at once. Rejects when a read fails or the
   * windows are disposed; `aborted` reads reject too.
   */
  readonly reread: (signal: AbortSignal) => Promise<void>;
  /** How many blocks hold ids now, how many are loading, and how many checkpoints are kept. */
  readonly stats: () => { readonly loaded: number; readonly loading: number; readonly checkpoints: number };
  readonly subscribe: (listener: () => void) => () => void;
  /** Aborts every load, forgets every block and lets go of its ids. */
  readonly dispose: () => void;
}

type Block = readonly (string | undefined)[];

const idsIn = (block: Block): readonly string[] => block.filter((id): id is string => id !== undefined);

/** Where a filtered count stops (`COUNT_CAP` on the server): past it a cursor window grows as rows load. */
export const COUNT_CAP = 10_000;

/** The most reads one run ahead of a cursor chain makes: 50 reads of 200 cover 10,000 rows (spec 0006). */
export const MAX_READ_AHEAD = 50;

/** A view's windows over `read`, starting with nothing loaded and a count of 0. */
export function createWindows({
  mode,
  read,
  blockSize = 100,
  jumpSize = 200,
  keep = 5,
  onError,
  onRead = () => undefined,
  release = () => undefined,
  onStale = () => undefined,
}: WindowsOptions): Windows {
  let told: WindowCount = { count: 0, atLeast: false };
  // A cursor chain's end once a read came back short: the exact number of rows.
  let ended: number | undefined;
  // The furthest row a cursor chain has loaded, so the scrollbar past 10,000 never shrinks back.
  let reached = 0;
  let shown: RowRange = { start: 0, end: 0 };
  let isDisposed = false;
  const blocks = new Map<number, Block>();
  // Where each loaded id sits, so a store change can tell whether it's on screen.
  const positions = new Map<string, number>();
  const loading = new Map<number, AbortController>();
  // Cursor mode: block b's checkpoint, the cursor that ended block b - 1. Block 0 needs none.
  const checkpoints = new Map<number, string>();
  // Cursor mode: the one read ahead of the chain, towards `target`.
  let jump: { target: number; from: number; controller: AbortController } | undefined;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const blockOf = (index: number) => Math.floor(index / blockSize);
  const isCursor = () => mode() === 'cursor';
  /** The rows the scrollbar covers. */
  /**
   * The rows the scrollbar covers. By position, the count. By cursor, the
   * count up to 10,000; past it (a capped count, or an exact one over
   * 10,000, as an unfiltered view sorted by a member has) 10,000 plus the
   * rows loaded beyond it, so a drag never reaches further than 50 reads of
   * 200 could go, and the bar grows as the end comes into reach.
   */
  const height = () => {
    if (!isCursor()) return told.count;
    if (ended !== undefined) return ended;
    if (!told.atLeast && told.count <= COUNT_CAP) return told.count;
    const grown = Math.max(COUNT_CAP, reached);
    return told.atLeast ? grown : Math.min(told.count, grown);
  };
  const blockCount = () => Math.ceil(height() / blockSize);
  const lastShown = () => blockOf(Math.max(shown.start, shown.end - 1));
  const isFar = (block: number) => block < blockOf(shown.start) - keep || block > lastShown() + keep;
  /** Whether a cursor chain may hold rows past the scrollbar's end (a count of 10,000+ not yet reached). */
  const mayGrow = () =>
    isCursor() && ended === undefined && (told.atLeast || (told.count > COUNT_CAP && height() < told.count));

  /**
   * Puts `next` in place of `block` (or empties it), keeping the positions.
   * A block fresh from a read came with a hold on each of its ids, so every
   * old id is let go; a block changed in place lets go only of the ids it no
   * longer has.
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

  /** A cursor read landed for `block` onwards: notes where the chain goes next, or where it ends. */
  const chainAfter = (block: number, ids: number, nextCursor: string | undefined, blocksRead: number) => {
    const end = block * blockSize + ids;
    reached = Math.max(reached, end);
    if (nextCursor !== undefined) {
      checkpoints.set(block + blocksRead, nextCursor);
      return;
    }
    // No cursor after it: the chain ends here, and the count is the rows it holds.
    ended = end;
    for (const at of [...checkpoints.keys()]) if (at > block) checkpoints.delete(at);
  };

  /** Places the ids a read brought for blocks from `first` on, keeping only those near the screen. */
  const place = (first: number, ids: readonly string[], blocksRead: number) => {
    for (let at = 0; at < blocksRead; at += 1) {
      const part = ids.slice(at * blockSize, (at + 1) * blockSize);
      const block = first + at;
      if (part.length === 0) {
        if (blocks.has(block)) setBlock(block, undefined);
        continue;
      }
      if (isFar(block) || block >= blockCount()) {
        release(part);
        continue;
      }
      setBlock(block, part, true);
    }
  };

  const fail = (error: unknown, controller: AbortController, withCursor: boolean) => {
    if (!controller.signal.aborted && !isDisposed) onError?.(error, { withCursor });
  };

  const fetchBlock = (block: number) => {
    if (isCursor() && block > 0 && !checkpoints.has(block)) {
      readAhead(block);
      return;
    }
    // A newer request for the block supersedes any still running.
    loading.get(block)?.abort();
    const controller = new AbortController();
    loading.set(block, controller);
    const cursor = isCursor() ? checkpoints.get(block) : undefined;
    const from: ReadFrom = isCursor() ? (cursor === undefined ? {} : { cursor }) : { position: block * blockSize };
    read(from, blockSize, controller.signal).then(
      ({ ids, nextCursor }) => {
        if (loading.get(block) !== controller || isDisposed) {
          release(ids);
          return;
        }
        loading.delete(block);
        onRead();
        if (isCursor()) chainAfter(block, ids.length, nextCursor, 1);
        if (isFar(block) || block >= blockCount()) {
          release(ids);
          notify();
          return;
        }
        // Never past an exact count: a smaller count arrived while this block loaded.
        const room = isCursor() ? ids.length : told.count - block * blockSize;
        const kept = ids.length > room ? ids.slice(0, room) : ids;
        if (ids.length > room) release(ids.slice(room));
        setBlock(block, kept, true);
        // Fewer rows than the count promised: rows went elsewhere, so the count is out of date.
        if (!isCursor() && kept.length < Math.min(blockSize, room)) onStale();
        notify();
        // A chain that may grow: the screen reached its end, so the next block comes too.
        loadShown();
      },
      (error: unknown) => {
        if (loading.get(block) !== controller) return;
        loading.delete(block);
        fail(error, controller, cursor !== undefined);
      },
    );
  };

  /**
   * Cursor mode: reads forward from the last checkpoint before `target`, 200
   * rows a call, filling two blocks each, until `target` has loaded. One run
   * at a time; a further target moves the running one on, and a screen that
   * moved back before where it reads aborts it.
   */
  const readAhead = (target: number) => {
    if (jump !== undefined) {
      jump.target = Math.max(jump.target, target);
      return;
    }
    const controller = new AbortController();
    const run = { target, from: target, controller, calls: 0 };
    jump = run;
    const step = async (): Promise<void> => {
      if (blocks.has(run.target)) return;
      // The nearest checkpoint at or before the target (block 0 needs none).
      let from = run.target;
      while (from > 0 && !checkpoints.has(from)) from -= 1;
      run.from = from;
      const cursor = from === 0 ? undefined : checkpoints.get(from);
      const blocksRead = Math.max(1, Math.floor(jumpSize / blockSize));
      run.calls += 1;
      const answer = await read(cursor === undefined ? {} : { cursor }, blocksRead * blockSize, controller.signal);
      if (jump !== run || isDisposed) {
        release(answer.ids);
        return;
      }
      onRead();
      chainAfter(from, answer.ids.length, answer.nextCursor, blocksRead);
      // The second block of a read of 200 has no checkpoint of its own: dropped, it reloads from the first one's.
      place(from, answer.ids, blocksRead);
      notify();
      const nextFrom = from + blocksRead;
      if (answer.nextCursor === undefined || nextFrom > run.target) return;
      // Moved back before where the next call would start: stop here.
      if (lastShown() + keep < nextFrom) return;
      // Never more than 50 reads in one run (10,000 rows): the bar never offers further than that past what loaded.
      if (run.calls >= MAX_READ_AHEAD) return;
      await step();
    };
    step().then(
      () => {
        if (jump === run) jump = undefined;
        loadShown();
      },
      (error: unknown) => {
        if (jump !== run) return;
        jump = undefined;
        fail(error, controller, true);
      },
    );
  };

  /** Loads each block the range on screen covers that isn't loaded or loading; and the next one when a chain may grow. */
  const loadShown = () => {
    if (isDisposed || shown.end <= shown.start) return;
    const first = blockOf(shown.start);
    const wanted = Math.min(blockOf(shown.end - 1), blockCount() - 1);
    // The screen reached the end of a chain that may hold more: its next block comes too, so the bar grows.
    const last = mayGrow() && shown.end >= height() ? Math.max(wanted, blockCount()) : wanted;
    if (height() === 0) return;
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

  const abortAll = () => {
    for (const controller of loading.values()) controller.abort();
    loading.clear();
    jump?.controller.abort();
    jump = undefined;
  };

  const reread = async (signal: AbortSignal): Promise<void> => {
    if (shown.end <= shown.start || height() === 0) return;
    const first = blockOf(shown.start);
    const last = Math.max(first, Math.min(lastShown(), Math.max(0, blockCount() - 1)));
    let start = first;
    if (isCursor()) while (start > 0 && !checkpoints.has(start)) start -= 1;
    const rows = (last + 1 - start) * blockSize;
    const ids: string[] = [];
    let cursor = isCursor() && start > 0 ? checkpoints.get(start) : undefined;
    let nextCursor: string | undefined;
    const found = new Map<number, string>();
    try {
      while (ids.length < rows) {
        const limit = Math.min(jumpSize, rows - ids.length);
        const from: ReadFrom = isCursor()
          ? cursor === undefined
            ? {}
            : { cursor }
          : { position: start * blockSize + ids.length };
        const answer = await read(from, limit, signal);
        ids.push(...answer.ids);
        nextCursor = answer.nextCursor;
        if (isCursor()) {
          // A read that ends on a block boundary names the next block's checkpoint.
          if (nextCursor !== undefined && ids.length % blockSize === 0)
            found.set(start + ids.length / blockSize, nextCursor);
          if (nextCursor === undefined) break;
          cursor = nextCursor;
        } else if (answer.ids.length < limit) break;
      }
    } catch (error) {
      release(ids);
      throw error;
    }
    if (isDisposed || signal.aborted) {
      release(ids);
      throw signal.reason ?? new Error('The windows were disposed.');
    }
    onRead();
    // Loads still running would land older rows over these: they go, and load again if still wanted.
    abortAll();
    if (isCursor()) {
      // The chain from here on is read afresh: later checkpoints and its end are forgotten.
      for (const at of [...checkpoints.keys()]) if (at > start) checkpoints.delete(at);
      for (const [at, value] of found) checkpoints.set(at, value);
      ended = nextCursor === undefined ? start * blockSize + ids.length : undefined;
      reached = Math.max(told.atLeast ? told.count : 0, start * blockSize + ids.length);
    }
    const spanned = Math.ceil(ids.length / blockSize);
    // The other loaded blocks let go: they load when scrolled back to.
    for (const block of [...blocks.keys()]) {
      if (block < start || block > Math.max(last, start + spanned - 1)) setBlock(block, undefined);
    }
    for (let at = 0; at < last + 1 - start; at += 1) {
      const part = ids.slice(at * blockSize, (at + 1) * blockSize);
      if (part.length === 0) setBlock(start + at, undefined);
      else setBlock(start + at, part, true);
    }
    // Rows past the span (a read that went further) are not kept.
    if (ids.length > (last + 1 - start) * blockSize) release(ids.slice((last + 1 - start) * blockSize));
    notify();
    loadShown();
  };

  return {
    count: height,
    told: () => (ended === undefined || !isCursor() ? told : { count: ended, atLeast: false }),
    idAt: (index) => blocks.get(blockOf(index))?.[index % blockSize],
    indexOf: (id) => positions.get(id),
    has: (id) => positions.has(id),
    loadedIds: () => [...positions.keys()],
    shown: () => shown,
    show: (range) => {
      if (range.end <= range.start) return;
      shown = range;
      for (const [block, controller] of loading) {
        if (isFar(block)) {
          controller.abort();
          loading.delete(block);
        }
      }
      // The screen moved back before where the read ahead reads: its call is aborted.
      if (jump !== undefined && lastShown() + keep < jump.from) {
        const stopped = jump;
        jump = undefined;
        stopped.controller.abort();
      } else if (jump !== undefined && isFar(jump.target)) {
        jump.target = Math.min(jump.target, lastShown());
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
      if (next.count === told.count && next.atLeast === told.atLeast) return;
      told = next;
      if (isCursor() && ended !== undefined && (next.atLeast || next.count !== ended)) {
        // The server counts differently from where the chain ended: the chain's end is out of date.
        ended = undefined;
      }
      const end = blockCount();
      for (const [block, controller] of loading) {
        if (block >= end && !mayGrow()) {
          controller.abort();
          loading.delete(block);
        }
      }
      if (!mayGrow()) {
        for (const [block, ids] of [...blocks]) {
          const room = height() - block * blockSize;
          if (room <= 0) setBlock(block, undefined);
          else if (ids.length > room) setBlock(block, ids.slice(0, room));
          // More rows than a loaded block holds: it loads again to bring them.
          else if (ids.length < Math.min(blockSize, room) && !loading.has(block)) fetchBlock(block);
        }
      }
      loadShown();
      notify();
    },
    drop,
    refresh: () => {
      for (const block of new Set([...blocks.keys(), ...loading.keys()])) fetchBlock(block);
      loadShown();
    },
    loadMissing: loadShown,
    restart: () => {
      abortAll();
      for (const block of [...blocks.keys()]) setBlock(block, undefined);
      checkpoints.clear();
      ended = undefined;
      reached = 0;
      notify();
      loadShown();
    },
    reread,
    stats: () => ({ loaded: blocks.size, loading: loading.size, checkpoints: checkpoints.size }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      isDisposed = true;
      abortAll();
      for (const block of [...blocks.keys()]) setBlock(block, undefined);
    },
  };
}
