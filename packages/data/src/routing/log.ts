// Bookings › Routing (spec 0037, L6): the Overview and the Decisions log, for holders of `routing.manage`. No change
// event names a decision (bookings and form answers have none), so, like the reports, each is read when a screen
// first holds it and again whenever the person comes back to the page (at most once per 30 seconds). Decisions are
// one held list per workspace and filters, newest first, that `more()` grows a page at a time; a read again reads
// from the top as many pages as were shown. A failed read keeps what is shown; only a first read shows the failure.
// Nothing is fetched for a read no screen holds.
import type { RoutingDecision, RoutingDecisionPage, RoutingDecisionsInput, RoutingOverview } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { REPORT_RETURN_GAP_MS } from './reports.ts';

/** Decisions' filters, as Routing › Decisions sets them. */
export type RoutingDecisionFilters = Omit<RoutingDecisionsInput, 'workspace' | 'cursor'>;

/** What the store needs: the reads, and (for tests) the return signal and the clock. */
export interface RoutingLogDeps {
  readonly overview: (workspace: string) => Promise<RoutingOverview>;
  readonly decisions: (
    workspace: string,
    filters: RoutingDecisionFilters,
    cursor: string | undefined,
  ) => Promise<RoutingDecisionPage>;
  /** Calls `refresh` whenever the person comes back to the page; answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  readonly now?: () => number;
}

/** The Overview's state. */
export type RoutingOverviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly overview: RoutingOverview };

/** The Decisions log's state: the rows shown, whether more are there, and a next page on its way or refused. */
export type RoutingDecisionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly decisions: readonly RoutingDecision[];
      readonly hasMore: boolean;
      readonly isLoadingMore: boolean;
      readonly moreFailed?: string;
    };

/** A held read, as a screen retains it. */
export interface RoutingHeld<S> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => S;
  readonly retain: () => () => void;
  readonly reload: () => void;
}

/** The Decisions log's handle: a held read that grows. */
export interface RoutingDecisionsHeld extends RoutingHeld<RoutingDecisionsState> {
  /** The next page, after the rows shown; nothing while one is out or when there is none. */
  readonly more: () => void;
}

/** The most pages a read again reads from the top, so a long scroll back never turns into a flood. */
const REREAD_PAGES_MAX = 10;

function browserReturn(refresh: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** One held read: `run` reads it again, and the holding, return and listeners are kept here. */
function heldRead<S>(
  first: S,
  run: (set: (next: S) => void, get: () => S) => Promise<void>,
  deps: Pick<RoutingLogDeps, 'onReturn' | 'now'>,
) {
  const onReturn = deps.onReturn ?? browserReturn;
  const clock = deps.now ?? Date.now;
  let state = first;
  let held = 0;
  let askedAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | undefined;
  let again = false;
  let release: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (next: S) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const read = (): void => {
    if (reading !== undefined) {
      again = true;
      return;
    }
    askedAt = clock();
    reading = run(set, () => state).finally(() => {
      reading = undefined;
      if (again && held > 0) {
        again = false;
        read();
      }
      again = false;
    });
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    set,
    retain: () => {
      held += 1;
      if (held === 1) {
        read();
        release = onReturn(() => {
          if (reading === undefined && clock() - askedAt >= REPORT_RETURN_GAP_MS) read();
        });
      }
      return () => {
        held -= 1;
        if (held === 0) {
          release?.();
          release = undefined;
        }
      };
    },
    reload: read,
    isHeld: () => held > 0,
    isReading: () => reading !== undefined,
  };
}

/** A stable key for a filter set: its fields in order. */
function filtersKey(filters: RoutingDecisionFilters): string {
  // Absent filters are absent keys (the screen never sets one to undefined), so the entries are the filters set.
  return JSON.stringify(Object.entries(filters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The Routing tab's store: the Overview per workspace, and the Decisions log per workspace and filters. */
export function createRoutingLog(deps: RoutingLogDeps) {
  const overviews = new Map<string, ReturnType<typeof heldRead<RoutingOverviewState>>>();
  const logs = new Map<string, RoutingDecisionsHeld & { readonly isHeld: () => boolean }>();

  function makeLog(workspace: string, filters: RoutingDecisionFilters) {
    // How many pages are shown, and the cursor after the last.
    let pages = 0;
    let next: string | undefined;
    let loadingMore = false;
    // Bumped by every read from the top: a next page asked for before it lands is dropped, so no rows are skipped.
    let generation = 0;
    const read = heldRead<RoutingDecisionsState>(
      { status: 'loading' },
      async (set, get) => {
        generation += 1;
        try {
          const wanted = Math.min(Math.max(pages, 1), REREAD_PAGES_MAX);
          const rows: RoutingDecision[] = [];
          let cursor: string | undefined;
          let count = 0;
          do {
            const page = await deps.decisions(workspace, filters, cursor);
            rows.push(...page.decisions);
            cursor = page.next;
            count += 1;
          } while (cursor !== undefined && count < wanted);
          pages = count;
          next = cursor;
          set({ status: 'ready', decisions: rows, hasMore: next !== undefined, isLoadingMore: false });
        } catch (error) {
          if (get().status !== 'ready') set({ status: 'error', message: toDataError(error).message });
        }
      },
      deps,
    );
    return {
      subscribe: read.subscribe,
      getSnapshot: read.getSnapshot,
      retain: read.retain,
      reload: read.reload,
      isHeld: read.isHeld,
      more() {
        const shown = read.getSnapshot();
        if (shown.status !== 'ready' || next === undefined || loadingMore || read.isReading()) return;
        loadingMore = true;
        const asked = generation;
        const { moreFailed: _, ...kept } = shown;
        read.set({ ...kept, isLoadingMore: true });
        deps.decisions(workspace, filters, next).then(
          (page) => {
            loadingMore = false;
            const now = read.getSnapshot();
            if (now.status !== 'ready') return;
            if (asked !== generation) {
              read.set({ ...now, isLoadingMore: false });
              return;
            }
            const known = new Set(now.decisions.map((each) => each.id));
            pages += 1;
            next = page.next;
            read.set({
              status: 'ready',
              decisions: [...now.decisions, ...page.decisions.filter((each) => !known.has(each.id))],
              hasMore: next !== undefined,
              isLoadingMore: false,
            });
          },
          (error: unknown) => {
            loadingMore = false;
            const now = read.getSnapshot();
            if (now.status !== 'ready') return;
            read.set({ ...now, isLoadingMore: false, moreFailed: toDataError(error).message });
          },
        );
      },
    };
  }

  return {
    /** The workspace's routed surfaces (AC-1383), the same handle for every screen asking it. */
    overview(workspace: string): RoutingHeld<RoutingOverviewState> {
      const found = overviews.get(workspace);
      if (found !== undefined) return found;
      const made = heldRead<RoutingOverviewState>(
        { status: 'loading' },
        async (set, get) => {
          try {
            set({ status: 'ready', overview: await deps.overview(workspace) });
          } catch (error) {
            if (get().status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          }
        },
        deps,
      );
      overviews.set(workspace, made);
      return made;
    },
    /** Decisions across every surface with these filters (AC-1383), newest first. */
    decisions(workspace: string, filters: RoutingDecisionFilters): RoutingDecisionsHeld {
      const key = `${workspace}:${filtersKey(filters)}`;
      const found = logs.get(key);
      if (found !== undefined) return found;
      const made = makeLog(workspace, filters);
      logs.set(key, made);
      // Other filter sets nobody holds go, so the map stays as small as what screens show.
      for (const [old, entry] of logs) if (old !== key && !entry.isHeld()) logs.delete(old);
      return made;
    },
  };
}

/** The Routing tab's store. */
export type RoutingLog = ReturnType<typeof createRoutingLog>;
