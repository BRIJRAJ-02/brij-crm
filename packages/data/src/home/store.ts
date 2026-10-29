// Home's own reads (spec 0041): Team today, one held read per workspace and
// day, the metrics row, one per workspace and week, and Recently viewed, one
// per workspace. Neither is CRM data
// with a change event of its own (bookings and synced meetings have none
// yet), so, like Bookings, each is read when a screen first holds it and
// again whenever the person comes back to the page (at most once per 30
// seconds). Nothing polls: Team
// today holds the whole day, so the screen works out "Free now" from the
// clock as time passes. A failed read keeps what is shown; only a first read
// shows the failure. Nothing is ever fetched for a read no screen holds.
import type { HomeMetricsView, RecentItems, TeamTodayView } from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** The calls the store makes. */
export interface HomeApi {
  readonly teamToday: (input: {
    readonly workspace: string;
    readonly from: string;
    readonly to: string;
  }) => Promise<TeamTodayView>;
  readonly metrics: (input: { readonly workspace: string; readonly weekStart: string }) => Promise<HomeMetricsView>;
  /** The member's recent records and views (spec 0039's `recents.list`), only what they may still see. */
  readonly recents: (input: { readonly workspace: string }) => Promise<RecentItems>;
}

/** What the store needs: the calls, and (for tests) the return signal. */
export interface HomeDeps {
  readonly api: HomeApi;
  /** Calls `refresh` whenever the person comes back to the page (focus, visible again); answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  /** The clock, for tests. */
  readonly now?: () => number;
}

/** One held read's state: loading, failed, or what the server last said. */
export type HomeReadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & T);

/** Team today's state. */
export type TeamTodayState = HomeReadState<TeamTodayView>;

/** The metrics row's state. */
export type HomeMetricsState = HomeReadState<{ readonly metrics: HomeMetricsView }>;

/** Recently viewed's state: the member's recent records and views, newest first. */
export type HomeRecentsState = HomeReadState<RecentItems>;

/** A held read, as a screen retains it. */
export interface HomeHeld<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  /** Held while a screen shows it: read when first held, and again whenever the person comes back to the page. */
  readonly retain: () => () => void;
  /** Settles once the first read did. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** How soon after an answer coming back to the page reads again. Try again always reads. */
export const RETURN_GAP_MS = 30_000;

/** At most this many reads are kept that no screen holds (yesterday's day, last week's row). */
const UNHELD_MAX = 4;

/** The browser's return signal: the window's focus and the document becoming visible. */
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

/** The home store: every workspace's Team today and metrics reads. */
export function createHomeStore(deps: HomeDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const clock = deps.now ?? Date.now;
  const reads = new Map<string, HomeHeld<HomeReadState<object>> & { readonly isHeld: () => boolean }>();

  function makeHeld<T extends object>(load: () => Promise<T>) {
    let state: HomeReadState<T> = { status: 'loading' };
    let held = 0;
    let reading: Promise<void> | undefined;
    let settled: Promise<void> | undefined;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const set = (next: HomeReadState<T>) => {
      state = next;
      for (const listener of listeners) listener();
    };
    let readAt = Number.NEGATIVE_INFINITY;
    const read = (): Promise<void> => {
      reading ??= load()
        .then(
          (answer) => {
            readAt = clock();
            set({ status: 'ready', ...answer });
          },
          (error: unknown) => {
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (held === 1) {
          // A read that just answered (the route's prewarm, or a visit a moment ago) stands: no second request.
          if (clock() - readAt >= RETURN_GAP_MS) void read();
          // Coming back within RETURN_GAP_MS of the last answer reads nothing: focus fires on every click back.
          release = onReturn(() => {
            if (clock() - readAt >= RETURN_GAP_MS) void read();
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
      ready() {
        settled ??= read();
        return settled;
      },
      reload() {
        void read();
      },
      isHeld: () => held > 0,
    };
  }

  function keep<State>(key: string, make: () => HomeHeld<State> & { readonly isHeld: () => boolean }) {
    const found = reads.get(key);
    if (found !== undefined) return found as unknown as HomeHeld<State>;
    const made = make();
    reads.set(key, made as unknown as HomeHeld<HomeReadState<object>> & { readonly isHeld: () => boolean });
    const unheld = [...reads.entries()].filter(([, view]) => !view.isHeld());
    for (const [old] of unheld.slice(0, Math.max(0, unheld.length - UNHELD_MAX))) reads.delete(old);
    return made;
  }

  return {
    /** Every member's day in [from, to) as the reader may see it (Home's Team today). */
    teamToday(workspace: string, from: string, to: string): HomeHeld<TeamTodayState> {
      return keep(`team:${workspace}:${from}:${to}`, () => makeHeld(() => deps.api.teamToday({ workspace, from, to })));
    },
    /** The metrics row for the week starting `weekStart` (the reader's Monday's midnight, UTC). */
    metrics(workspace: string, weekStart: string): HomeHeld<HomeMetricsState> {
      return keep(`metrics:${workspace}:${weekStart}`, () =>
        makeHeld(async () => ({ metrics: await deps.api.metrics({ workspace, weekStart }) })),
      );
    },
    /** The member's recent records and views (Home's Recently viewed): read each time a screen first holds it. */
    recents(workspace: string): HomeHeld<HomeRecentsState> {
      return keep(`recents:${workspace}`, () => makeHeld(() => deps.api.recents({ workspace })));
    },
    /**
     * Reads every held read of the workspace again, and forgets the unheld ones (spec 0037, AC-1274: the person's
     * scheduling reach changed, so Team today may show more or fewer people).
     */
    reloadAll(workspace: string): void {
      for (const [key, view] of [...reads]) {
        if (key.split(':')[1] !== workspace) continue;
        if (view.isHeld()) view.reload();
        else reads.delete(key);
      }
    },
  };
}

/** The home store. */
export type HomeStore = ReturnType<typeof createHomeStore>;
