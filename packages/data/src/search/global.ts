// The command menu's search (spec 0039, the data layer): what the person
// types, sent as `search.query` 150 ms after the last key, the request before
// it aborted, and each answer kept for the menu's life, so typing back shows
// it at once. Results are displays (a record's chip, a view's name), never
// record bodies: nothing here goes into the record store (AC-1100). Loaded
// with `import()` when the menu first opens, never in the first load.
import type { GlobalSearchResults, RecordHit, ViewHit } from '@crm/contracts';
import { SEARCH_DELAY_MS } from '../records/search.ts';

/** How many answered queries one menu keeps; past it the oldest goes. */
const KEPT_ANSWERS = 30;

/** Where a search stands: the query asked last, and what it found once it is in. */
export interface GlobalSearchState {
  readonly query: string;
  /** `idle` with nothing typed; `loading` from the key until its answer; `error` when it failed. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly records: readonly RecordHit[];
  readonly views: readonly ViewHit[];
}

/** One menu's search: ask as the person types, and read the state. */
export interface GlobalSearch {
  /** Searches for `query` after the pause (at once from a kept answer, at once to idle when blank). */
  readonly ask: (query: string) => void;
  /** Asks the last query again (after a failure). */
  readonly retry: () => void;
  readonly getSnapshot: () => GlobalSearchState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Stops what is out (the pause and the request); a later `ask` starts again. */
  readonly dispose: () => void;
}

/** What a search needs: the call itself (aborted by `signal`), and the timer, which tests replace. */
export interface GlobalSearchOptions {
  readonly run: (query: string, signal: AbortSignal) => Promise<GlobalSearchResults>;
  readonly delayMs?: number;
  readonly later?: (run: () => void, ms: number) => () => void;
}

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

const IDLE: GlobalSearchState = { query: '', status: 'idle', records: [], views: [] };

/** A search for one opening of the command menu (see the file's opening). */
export function createGlobalSearch({
  run,
  delayMs = SEARCH_DELAY_MS,
  later = timeout,
}: GlobalSearchOptions): GlobalSearch {
  const answers = new Map<string, GlobalSearchResults>();
  const listeners = new Set<() => void>();
  let state: GlobalSearchState = IDLE;
  let cancelTimer: (() => void) | undefined;
  let controller: AbortController | undefined;

  const set = (next: GlobalSearchState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    controller?.abort();
    controller = undefined;
  };
  const keep = (query: string, results: GlobalSearchResults) => {
    answers.delete(query);
    answers.set(query, results);
    if (answers.size > KEPT_ANSWERS) {
      const oldest = answers.keys().next();
      if (oldest.done !== true) answers.delete(oldest.value);
    }
  };
  const start = (query: string) => {
    set({ query, status: 'loading', records: state.records, views: state.views });
    cancelTimer = later(() => {
      cancelTimer = undefined;
      const mine = new AbortController();
      controller = mine;
      run(query, mine.signal).then(
        (results) => {
          if (mine.signal.aborted) return;
          controller = undefined;
          keep(query, results);
          if (state.query === query) set({ query, status: 'ready', records: results.records, views: results.views });
        },
        () => {
          if (mine.signal.aborted || state.query !== query) return;
          controller = undefined;
          set({ query, status: 'error', records: [], views: [] });
        },
      );
    }, delayMs);
  };

  return {
    ask: (asked) => {
      const query = asked.trim();
      if (query === state.query && state.status !== 'idle') return;
      stop();
      if (query === '') {
        set(IDLE);
        return;
      }
      const kept = answers.get(query);
      if (kept !== undefined) {
        set({ query, status: 'ready', records: kept.records, views: kept.views });
        return;
      }
      start(query);
    },
    retry: () => {
      if (state.status !== 'error') return;
      stop();
      start(state.query);
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
    },
  };
}
