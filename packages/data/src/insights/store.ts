// Insights (spec 0067): the screen's held reads. Visits come from visitors, who send no change event into this
// workspace, so there is nothing to subscribe to: each read is made when a screen first holds it and again whenever
// the person comes back to the page, at most once every `INSIGHTS_RETURN_GAP_MS` (the forms analytics store's rule,
// `forms/analytics.ts`). A failed read keeps what is shown; only a first read shows the failure. A newer read out
// keeps the old numbers on screen, marked refreshing, so changing the range never blanks the page.
//
// Sessions are paged by cursor (50 at a time, More adds the next), read again from the top on return. Share links
// are one held list a workspace: Create waits for the server (the token comes from it, shown once), Revoke shows at
// once and is put back on a refusal.
import type {
  InsightPages,
  InsightPeriod,
  Insights,
  InsightSession,
  InsightSessionFilter,
  InsightSessionPage,
  InsightShare,
  InsightShareCreated,
  InsightRange,
} from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** How soon after an answer coming back to the page reads again. Try again always reads. */
export const INSIGHTS_RETURN_GAP_MS = 30_000;

/** A held read as a screen retains it. */
export interface InsightRead<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  /** Held while a screen shows it: read when first held, and again when the person comes back. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** The numbers: loading, failed, or what the server last said (and whether a newer read is out). */
export type InsightNumbersState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly insights: Insights; readonly isRefreshing: boolean };

/** A page of sessions as the table shows it. */
export type InsightSessionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly items: readonly InsightSession[];
      readonly hasMore: boolean;
      readonly isLoadingMore: boolean;
      readonly isRefreshing: boolean;
    };

/** The held sessions, with More. */
export interface InsightSessionsHeld extends InsightRead<InsightSessionsState> {
  readonly more: () => void;
}

/** The share links: loading, failed, or the list. */
export type InsightSharesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly shares: readonly InsightShare[] };

/** What the store needs: the calls, and (for tests) the return signal and the clock. */
export interface InsightsDeps {
  readonly read: (workspace: string, period: InsightPeriod, pages: InsightPages) => Promise<Insights>;
  readonly sessions: (
    workspace: string,
    query: {
      readonly period: InsightPeriod;
      readonly pages: InsightPages;
      readonly filter: InsightSessionFilter;
      readonly cursor?: string;
    },
  ) => Promise<InsightSessionPage>;
  readonly listShares: (workspace: string) => Promise<{ readonly shares: readonly InsightShare[] }>;
  readonly createShare: (
    workspace: string,
    input: {
      readonly label: string;
      readonly pages: InsightPages;
      readonly range: InsightRange;
      readonly expiresAt?: string;
    },
  ) => Promise<InsightShareCreated>;
  readonly revokeShare: (workspace: string, shareId: string) => Promise<InsightShare>;
  readonly onReturn?: (refresh: () => void) => () => void;
  readonly now?: () => number;
}

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

/** A held thing that knows whether a screen holds it, so the map can drop the rest. */
type Entry<Held> = Held & { readonly isHeld: () => boolean };

/** One read held by screens: the shared machinery of the three kinds of read below. */
function heldRead<State>(options: {
  readonly initial: State;
  readonly run: (current: State) => Promise<State>;
  readonly failed: (current: State, message: string) => State;
  readonly onReturn: (refresh: () => void) => () => void;
  readonly clock: () => number;
}) {
  let state = options.initial;
  let held = 0;
  let askedAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | undefined;
  let again = false;
  let release: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (next: State) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const read = (): void => {
    if (reading !== undefined) {
      again = true;
      return;
    }
    askedAt = options.clock();
    reading = options
      .run(state)
      .then(
        (next) => set(next),
        (error: unknown) => set(options.failed(state, toDataError(error).message)),
      )
      .finally(() => {
        reading = undefined;
        if (again && held > 0) {
          again = false;
          read();
          return;
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
    get: () => state,
    retain: () => {
      held += 1;
      if (held === 1) {
        read();
        release = options.onReturn(() => {
          if (reading === undefined && options.clock() - askedAt >= INSIGHTS_RETURN_GAP_MS) read();
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
  };
}

/** A stable key for a query: the same question always reads as the same held read. */
const keyOf = (parts: readonly unknown[]) => JSON.stringify(parts);

/** The Insights store: every held read, read again when the person comes back to the page. */
export function createInsightsStore(deps: InsightsDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const clock = deps.now ?? Date.now;
  const numbers = new Map<string, Entry<InsightRead<InsightNumbersState>>>();
  const sessions = new Map<string, Entry<InsightSessionsHeld>>();
  const shares = new Map<string, ReturnType<typeof heldRead<InsightSharesState>>>();
  // The last numbers any read answered, by workspace: a new range shows them dimmed instead of a blank page.
  const lastNumbers = new Map<string, Insights>();

  /** Unheld reads go, so a map stays as small as what screens show. */
  const prune = <Held extends { readonly isHeld: () => boolean }>(map: Map<string, Held>, keep: string) => {
    for (const [key, entry] of map) if (key !== keep && !entry.isHeld()) map.delete(key);
  };

  function numbersView(
    workspace: string,
    period: InsightPeriod,
    pages: InsightPages,
  ): InsightRead<InsightNumbersState> {
    const key = keyOf([workspace, period, pages]);
    const found = numbers.get(key);
    if (found !== undefined) return found;
    const previous = lastNumbers.get(workspace);
    // Whether what shows is this question's own answer, rather than the last range's held over while it loads.
    let isOwn = false;
    const read = heldRead<InsightNumbersState>({
      initial:
        previous === undefined ? { status: 'loading' } : { status: 'ready', insights: previous, isRefreshing: true },
      run: async (current) => {
        if (current.status === 'ready' && !current.isRefreshing) read.set({ ...current, isRefreshing: true });
        const insights = await deps.read(workspace, period, pages);
        lastNumbers.set(workspace, insights);
        isOwn = true;
        return { status: 'ready', insights, isRefreshing: false };
      },
      // A failure keeps this question's own numbers on screen; borrowed ones give way to the failure.
      failed: (current, message) =>
        current.status === 'ready' && isOwn ? { ...current, isRefreshing: false } : { status: 'error', message },
      onReturn,
      clock,
    });
    const entry = {
      subscribe: read.subscribe,
      getSnapshot: read.getSnapshot,
      retain: read.retain,
      reload: read.reload,
      isHeld: read.isHeld,
    };
    numbers.set(key, entry);
    prune(numbers, key);
    return entry;
  }

  function sessionsView(
    workspace: string,
    period: InsightPeriod,
    pages: InsightPages,
    filter: InsightSessionFilter,
  ): InsightSessionsHeld {
    const key = keyOf([workspace, period, pages, filter]);
    const found = sessions.get(key);
    if (found !== undefined) return found;
    let cursor: string | undefined;
    const read = heldRead<InsightSessionsState>({
      initial: { status: 'loading' },
      run: async (current) => {
        if (current.status === 'ready') read.set({ ...current, isRefreshing: true });
        // From the top: a return reads again what the table starts with; More pages on from there.
        const page = await deps.sessions(workspace, { period, pages, filter });
        cursor = page.nextCursor;
        return {
          status: 'ready',
          items: page.items,
          hasMore: page.nextCursor !== undefined,
          isLoadingMore: false,
          isRefreshing: false,
        };
      },
      failed: (current, message) =>
        current.status === 'ready' ? { ...current, isRefreshing: false } : { status: 'error', message },
      onReturn,
      clock,
    });
    let loadingMore = false;
    const more = () => {
      const current = read.get();
      if (loadingMore || current.status !== 'ready' || cursor === undefined) return;
      loadingMore = true;
      read.set({ ...current, isLoadingMore: true });
      deps
        .sessions(workspace, { period, pages, filter, cursor })
        .then(
          (page) => {
            const now = read.get();
            if (now.status !== 'ready') return;
            cursor = page.nextCursor;
            // A row already shown (a visit that moved on since) is kept where it is, never twice.
            const seen = new Set(now.items.map((item) => item.id));
            read.set({
              ...now,
              items: [...now.items, ...page.items.filter((item) => !seen.has(item.id))],
              hasMore: page.nextCursor !== undefined,
              isLoadingMore: false,
            });
          },
          () => {
            const now = read.get();
            if (now.status === 'ready') read.set({ ...now, isLoadingMore: false });
          },
        )
        .finally(() => {
          loadingMore = false;
        });
    };
    const entry = {
      subscribe: read.subscribe,
      getSnapshot: read.getSnapshot,
      retain: read.retain,
      reload: read.reload,
      isHeld: read.isHeld,
      more,
    };
    sessions.set(key, entry);
    prune(sessions, key);
    return entry;
  }

  function sharesOf(workspace: string) {
    const found = shares.get(workspace);
    if (found !== undefined) return found;
    const read = heldRead<InsightSharesState>({
      initial: { status: 'loading' },
      run: async () => ({ status: 'ready', shares: (await deps.listShares(workspace)).shares }),
      failed: (current, message) => (current.status === 'ready' ? current : { status: 'error', message }),
      onReturn,
      clock,
    });
    shares.set(workspace, read);
    return read;
  }

  return {
    /** The numbers over a period and pages: one held read per question, shared by every screen asking it. */
    numbers: numbersView,
    /** A page of sessions, newest first, with More. */
    sessions: sessionsView,
    /** The workspace's share links the reader may see. */
    shares: (workspace: string): InsightRead<InsightSharesState> => sharesOf(workspace),
    /**
     * Makes a share link: waits for the server, whose answer carries the token (shown once), then puts the link at
     * the top of the held list.
     */
    async createShare(
      workspace: string,
      input: {
        readonly label: string;
        readonly pages: InsightPages;
        readonly range: InsightRange;
        readonly expiresAt?: string;
      },
    ): Promise<InsightShareCreated> {
      const made = await deps.createShare(workspace, input);
      const list = sharesOf(workspace);
      const current = list.get();
      if (current.status === 'ready') list.set({ status: 'ready', shares: [made.share, ...current.shares] });
      return made;
    },
    /** Revokes a link: shown at once, put back on a refusal, which rejects with its message. */
    async revokeShare(workspace: string, shareId: string): Promise<void> {
      const list = sharesOf(workspace);
      const before = list.get();
      if (before.status === 'ready') {
        const at = new Date(clock()).toISOString();
        list.set({
          status: 'ready',
          shares: before.shares.map((share) => (share.id === shareId ? { ...share, revokedAt: at } : share)),
        });
      }
      try {
        const revoked = await deps.revokeShare(workspace, shareId);
        const now = list.get();
        if (now.status === 'ready') {
          list.set({ status: 'ready', shares: now.shares.map((share) => (share.id === shareId ? revoked : share)) });
        }
      } catch (error) {
        const now = list.get();
        const was = before.status === 'ready' ? before.shares.find((share) => share.id === shareId) : undefined;
        if (now.status === 'ready' && was !== undefined) {
          list.set({ status: 'ready', shares: now.shares.map((share) => (share.id === shareId ? was : share)) });
        }
        throw toDataError(error);
      }
    },
  };
}

/** The Insights store. */
export type InsightsStore = ReturnType<typeof createInsightsStore>;
