// Likely duplicates in the data layer (spec 0049): the check a create dialog or
// a record page asks as fields change (300 ms after the last, the request before
// aborted), and the pairs a Duplicates page or a record's banner shows, paged,
// with "Not a duplicate" hiding a pair at once and putting it back on a refusal.
// Matches and pairs are displays (record chips), never record bodies: nothing
// here goes into the record store. No Zod, no runtime imports beyond types.
import type { DuplicateMatch, DuplicatePair, DuplicatePairs } from '@crm/contracts';

/** How long after the last change a check is asked (AC-4904). */
export const DUPLICATE_CHECK_DELAY_MS = 300;
/** Pages one `more()` reads at most while a page comes back short but the search has more to read. */
const PAGES_PER_MORE = 5;
/** Pairs a page wants before it stops reading on by itself. */
const WANTED = 50;

/** Where a check stands. `idle` with nothing to check; a failed check shows as nothing, never as an error. */
export interface DuplicateCheckState {
  readonly status: 'idle' | 'checking' | 'ready';
  readonly matches: readonly DuplicateMatch[];
}

/** One form's check: ask with the draft's values, read the state, dispose when the form closes. */
export interface DuplicateCheck {
  /** Checks these draft values after the pause; nothing to check (no values) goes idle at once. */
  readonly ask: (values: Readonly<Record<string, unknown>>) => void;
  readonly getSnapshot: () => DuplicateCheckState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
}

/** What a check needs: the call (aborted by `signal`), and the timer, which tests replace. */
export interface DuplicateCheckOptions {
  readonly run: (values: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<readonly DuplicateMatch[]>;
  readonly delayMs?: number;
  readonly later?: (run: () => void, ms: number) => () => void;
}

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

const IDLE: DuplicateCheckState = { status: 'idle', matches: [] };

/** True when a draft holds nothing a rule could read. */
const isBlank = (values: Readonly<Record<string, unknown>>) =>
  Object.values(values).every(
    (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0),
  );

/** A check for one opening of a form (see the file's opening). */
export function createDuplicateCheck({
  run,
  delayMs = DUPLICATE_CHECK_DELAY_MS,
  later = timeout,
}: DuplicateCheckOptions): DuplicateCheck {
  const listeners = new Set<() => void>();
  let state: DuplicateCheckState = IDLE;
  let asked = '';
  let cancelTimer: (() => void) | undefined;
  let controller: AbortController | undefined;
  const set = (next: DuplicateCheckState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    controller?.abort();
    controller = undefined;
  };
  return {
    ask: (values) => {
      const key = JSON.stringify(values);
      if (key === asked) return;
      asked = key;
      stop();
      if (isBlank(values)) {
        set(IDLE);
        return;
      }
      // The matches shown stay while the next check is out, so the hint never flickers away and back.
      if (state.status !== 'checking') set({ status: 'checking', matches: state.matches });
      cancelTimer = later(() => {
        cancelTimer = undefined;
        const mine = new AbortController();
        controller = mine;
        run(values, mine.signal).then(
          (matches) => {
            if (mine.signal.aborted) return;
            controller = undefined;
            set({ status: 'ready', matches });
          },
          () => {
            if (mine.signal.aborted) return;
            controller = undefined;
            // A hint, never a wall: a failed or limited check shows nothing and blocks nothing.
            set({ status: 'ready', matches: [] });
          },
        );
      }, delayMs);
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      stop();
      listeners.clear();
    },
  };
}

/** A pair's identity: its two record ids, in either order. */
export const pairKey = (pair: Pick<DuplicatePair, 'a' | 'b'>): string =>
  [pair.a.recordId, pair.b.recordId].sort().join(':');

/** Where a list of pairs stands. */
export interface DuplicatePairsState {
  /** `loading` before the first page; `failed` when it couldn't be read; `forbidden` for an object out of reach. */
  readonly status: 'loading' | 'ready' | 'failed' | 'forbidden';
  readonly pairs: readonly DuplicatePair[];
  /** The search has more to read: `more()` goes on. */
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  /** The last `more()` failed; the pairs shown stay. */
  readonly moreFailed: boolean;
}

/** An object's pairs (the Duplicates page), or one record's (its banner). */
export interface DuplicatePairsList {
  readonly getSnapshot: () => DuplicatePairsState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Reads on from where the last page ended. */
  readonly more: () => void;
  /** Reads the first page again (after a failure, or when the records changed). */
  readonly retry: () => void;
  /**
   * "Not a duplicate" (AC-4908): the pair leaves at once, everywhere this list shows it; a refusal puts it back
   * where it was and rejects with the error. Resolves once the server kept it.
   */
  readonly dismiss: (pair: DuplicatePair) => Promise<void>;
  /** Undo of a dismiss: the pair comes back where it was at once; a refusal takes it away again and rejects. */
  readonly restore: (pair: DuplicatePair) => Promise<void>;
  /** Stops what is out. */
  readonly dispose: () => void;
}

/** What a list needs: a page read (aborted by `signal`), and the two writes. */
export interface DuplicatePairsOptions {
  readonly load: (cursor: string | undefined, signal: AbortSignal) => Promise<DuplicatePairs>;
  readonly dismiss: (pair: DuplicatePair) => Promise<unknown>;
  readonly restore: (pair: DuplicatePair) => Promise<unknown>;
  /** Whether a failure means the object is out of reach (no access, or gone). */
  readonly isForbidden: (error: unknown) => boolean;
}

/** A list of likely pairs (see the file's opening). Reads its first page at once. */
export function createDuplicatePairs({
  load,
  dismiss,
  restore,
  isForbidden,
}: DuplicatePairsOptions): DuplicatePairsList {
  const listeners = new Set<() => void>();
  let state: DuplicatePairsState = {
    status: 'loading',
    pairs: [],
    hasMore: false,
    isLoadingMore: false,
    moreFailed: false,
  };
  let cursor: string | undefined;
  let controller: AbortController | undefined;
  /** Pairs hidden by a dismiss on its way, with where each showed, so a refusal puts it back in place. */
  const hidden = new Map<string, { readonly pair: DuplicatePair; readonly index: number }>();
  const set = (next: DuplicatePairsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const visible = (pairs: readonly DuplicatePair[]) => pairs.filter((pair) => !hidden.has(pairKey(pair)));

  const read = (first: boolean) => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    if (first) {
      cursor = undefined;
      set({ status: 'loading', pairs: [], hasMore: false, isLoadingMore: false, moreFailed: false });
    } else set({ ...state, isLoadingMore: true, moreFailed: false });
    const gathered: DuplicatePair[] = first ? [] : [...state.pairs];
    const step = (pages: number): void => {
      load(cursor, mine.signal).then(
        (page) => {
          if (mine.signal.aborted) return;
          const seen = new Set(gathered.map(pairKey));
          for (const pair of page.pairs) if (!seen.has(pairKey(pair))) gathered.push(pair);
          cursor = page.cursor;
          const wanted = (first ? WANTED : state.pairs.length + WANTED) - gathered.length;
          // A short page with more to read: the search read its bounded share of records, so read on by itself.
          if (cursor !== undefined && wanted > 0 && pages + 1 < PAGES_PER_MORE) {
            step(pages + 1);
            return;
          }
          controller = undefined;
          set({
            status: 'ready',
            pairs: visible(gathered),
            hasMore: cursor !== undefined,
            isLoadingMore: false,
            moreFailed: false,
          });
        },
        (error: unknown) => {
          if (mine.signal.aborted) return;
          controller = undefined;
          if (first) {
            set({ ...state, status: isForbidden(error) ? 'forbidden' : 'failed', isLoadingMore: false });
          } else set({ ...state, isLoadingMore: false, moreFailed: true });
        },
      );
    };
    step(0);
  };

  read(true);
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    more: () => {
      if (state.status !== 'ready' || state.isLoadingMore || cursor === undefined) return;
      read(false);
    },
    retry: () => {
      read(true);
    },
    dismiss: async (pair) => {
      const key = pairKey(pair);
      const index = state.pairs.findIndex((each) => pairKey(each) === key);
      hidden.set(key, { pair, index });
      set({ ...state, pairs: state.pairs.filter((each) => pairKey(each) !== key) });
      try {
        await dismiss(pair);
      } catch (error) {
        hidden.delete(key);
        if (index >= 0 && !state.pairs.some((each) => pairKey(each) === key)) {
          const pairs = [...state.pairs];
          pairs.splice(Math.min(index, pairs.length), 0, pair);
          set({ ...state, pairs });
        }
        throw error;
      }
    },
    restore: async (pair) => {
      const key = pairKey(pair);
      const where = hidden.get(key)?.index ?? 0;
      hidden.delete(key);
      if (!state.pairs.some((each) => pairKey(each) === key)) {
        const pairs = [...state.pairs];
        pairs.splice(Math.min(Math.max(where, 0), pairs.length), 0, pair);
        set({ ...state, pairs });
      }
      try {
        await restore(pair);
      } catch (error) {
        set({ ...state, pairs: state.pairs.filter((each) => pairKey(each) !== key) });
        throw error;
      }
    },
    dispose: () => {
      controller?.abort();
      controller = undefined;
      listeners.clear();
    },
  };
}
