// The record picker's search (spec 0014, the data layer): what the person
// types, sent as `records.search` 150 ms after the last key, the request
// before it aborted, and each answer kept for the picker's life, so typing
// back shows it at once. Results are displays (a chip's name and look,
// whether the record is linked already, who holds it), never record bodies:
// nothing here goes into the record store. Small and free of schemas, so it
// sits in the first load beside the layer's surface.
import type { SearchResult } from '@crm/contracts';

/** How long typing must pause before a search goes out (spec 0014: 150 ms). */
export const SEARCH_DELAY_MS = 150;

/** How many answered queries one picker keeps; past it the oldest goes. */
const KEPT_ANSWERS = 30;

/** Where a search stands: the query asked last, and its results once they are in. */
export interface RecordSearchState {
  readonly query: string;
  /** `loading` from the key until its answer; `error` when it failed (another query asks again). */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly results: readonly SearchResult[];
}

/** One picker's search: ask as the person types, read the state, and look up a result already shown. */
export interface RecordSearch {
  /** Searches for `query` after the pause (at once from a kept answer); asking the same query again does nothing. */
  readonly ask: (query: string) => void;
  readonly getSnapshot: () => RecordSearchState;
  readonly subscribe: (listener: () => void) => () => void;
  /** The latest result seen for a record (to tell a pick marked "At Acme" apart, and to show its chip at once). */
  readonly resultOf: (recordId: string) => SearchResult | undefined;
  /** Stops what is out (the pause and the request); a later `ask` starts again. */
  readonly dispose: () => void;
}

/** What a search needs: the call itself (aborted by `signal`), and the timer, which tests replace. */
export interface RecordSearchOptions {
  readonly run: (query: string, signal: AbortSignal) => Promise<readonly SearchResult[]>;
  readonly delayMs?: number;
  readonly later?: (run: () => void, ms: number) => () => void;
}

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

/** A search for one picker (see the file's opening). */
export function createRecordSearch({
  run,
  delayMs = SEARCH_DELAY_MS,
  later = timeout,
}: RecordSearchOptions): RecordSearch {
  const answers = new Map<string, readonly SearchResult[]>();
  const seen = new Map<string, SearchResult>();
  const listeners = new Set<() => void>();
  let state: RecordSearchState = { query: '', status: 'idle', results: [] };
  let cancelTimer: (() => void) | undefined;
  let controller: AbortController | undefined;

  const set = (next: RecordSearchState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  // `ask` runs while the picker renders: its own change is read at once through `getSnapshot`, and the
  // listeners hear of it a moment later, never during that render.
  const setSoon = (next: RecordSearchState) => {
    state = next;
    queueMicrotask(() => {
      if (state === next) for (const listener of listeners) listener();
    });
  };
  const stop = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    controller?.abort();
    controller = undefined;
  };
  const keep = (query: string, results: readonly SearchResult[]) => {
    answers.delete(query);
    answers.set(query, results);
    if (answers.size > KEPT_ANSWERS) {
      const oldest = answers.keys().next();
      if (oldest.done !== true) answers.delete(oldest.value);
    }
    for (const result of results) seen.set(result.ref.recordId, result);
  };

  return {
    ask: (asked) => {
      const query = asked.trim();
      // The same query again does nothing, a failed one included: it waits until the person types on, so a picker
      // drawn again while offline never asks in a loop.
      if (query === state.query && state.status !== 'idle' && state.status !== 'loading') return;
      // Asked again while its answer is out (or was stopped): it carries on, or starts again once stopped.
      if (
        query === state.query &&
        state.status === 'loading' &&
        (cancelTimer !== undefined || controller !== undefined)
      ) {
        return;
      }
      stop();
      const kept = answers.get(query);
      if (kept !== undefined) {
        setSoon({ query, status: 'ready', results: kept });
        return;
      }
      setSoon({ query, status: 'loading', results: [] });
      cancelTimer = later(() => {
        cancelTimer = undefined;
        const mine = new AbortController();
        controller = mine;
        run(query, mine.signal).then(
          (results) => {
            if (mine.signal.aborted) return;
            keep(query, results);
            if (state.query === query) set({ query, status: 'ready', results });
          },
          () => {
            if (mine.signal.aborted || state.query !== query) return;
            set({ query, status: 'error', results: [] });
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
    resultOf: (recordId) => seen.get(recordId),
    dispose: () => {
      stop();
    },
  };
}
