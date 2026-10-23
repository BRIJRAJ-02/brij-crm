// The operator console's reads (spec 0047), held: one entry per question
// (a period, a person, a page, a search), read when first asked, kept for the
// app load (the newest 40), and read again behind the shown numbers when asked
// after a minute. A screen holds an entry through `useOperator`, so a new
// period or search shows its own loading state in place while the page, its
// period switch and its search field stay mounted. No live event: the numbers
// are a snapshot of a period. The users list grows a page at a time with
// `more()`, its pages kept for that period and search.
import type {
  OperatorOverview,
  OperatorPageDetail,
  OperatorPages,
  OperatorPeriod,
  OperatorSite,
  OperatorUserDetail,
  OperatorUserPage,
  OperatorUserRow,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** One read's state: loading (nothing yet), its answer, or its refusal. */
export type OperatorState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly error: DataError };

/** A held read: its state for `useSyncExternalStore`, and a promise of its first answer for a route's loader. */
export interface OperatorHeld<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  /** Settles once the read has answered (or refused); never rejects. */
  readonly ready: () => Promise<void>;
}

/** The users list for one period and search: the rows so far, and whether more are coming or failed. */
export interface OperatorUsersState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly users: readonly OperatorUserRow[];
  readonly total: number;
  readonly hasMore: boolean;
  /** A further page is on its way. */
  readonly isLoadingMore: boolean;
  /** The first page's refusal (status `error`), or a further page's (the rows so far stay). */
  readonly error?: DataError;
  readonly period: OperatorPeriod;
}

/** The users list, held, with a way to read its next page. */
export interface OperatorUsersHeld extends OperatorHeld<OperatorUsersState> {
  /** Reads the next page and appends it; nothing while one is on its way or none is left. */
  readonly more: () => void;
}

/** The calls the store makes: the oRPC client's, through the data layer's `call`. */
export interface OperatorApi {
  readonly overview: (period: OperatorPeriod) => Promise<OperatorOverview>;
  readonly users: (input: {
    readonly period: OperatorPeriod;
    readonly q?: string;
    readonly after?: string;
  }) => Promise<OperatorUserPage>;
  readonly user: (userId: string, period: OperatorPeriod) => Promise<OperatorUserDetail>;
  readonly pages: (period: OperatorPeriod) => Promise<OperatorPages>;
  readonly page: (pageId: string, period: OperatorPeriod) => Promise<OperatorPageDetail>;
  readonly site: (period: OperatorPeriod) => Promise<OperatorSite>;
}

/** How long an answer is shown before it is read again behind it, when asked for again. */
export const OPERATOR_FRESH_MS = 60_000;

/** How many questions the store keeps; the least recently asked go first. */
const KEPT = 40;

interface Entry<T> {
  state: T;
  at: number;
  readonly listeners: Set<() => void>;
  readonly settled: Promise<void>;
  readonly held: OperatorHeld<T>;
}

/** The store, one per data layer. `now` is passed in for tests. */
export function createOperatorStore(api: OperatorApi, now: () => number = Date.now) {
  const entries = new Map<string, Entry<unknown>>();

  const keep = (key: string, entry: Entry<unknown>) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > KEPT) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      const gone = entries.get(oldest.value);
      // Never drop one a screen still holds.
      if (gone !== undefined && gone.listeners.size > 0) {
        entries.delete(oldest.value);
        entries.set(oldest.value, gone);
        break;
      }
      entries.delete(oldest.value);
    }
  };

  const entryOf = <T>(key: string, start: T, run: (entry: Entry<T>, set: (next: T) => void) => Promise<void>) => {
    const held = entries.get(key) as Entry<T> | undefined;
    if (held !== undefined) {
      keep(key, held as Entry<unknown>);
      return held;
    }
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const listeners = new Set<() => void>();
    const entry: Entry<T> = {
      state: start,
      at: now(),
      listeners,
      settled,
      held: {
        getSnapshot: () => entry.state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        ready: () => settled,
      },
    };
    const set = (next: T) => {
      entry.state = next;
      entry.at = now();
      for (const listener of [...listeners]) listener();
    };
    keep(key, entry as Entry<unknown>);
    void run(entry, set).finally(settle);
    return entry;
  };

  /** A plain read, held by `key`: read now, read again when asked after a minute or after a refusal. */
  function read<T>(key: string, load: () => Promise<T>): OperatorHeld<OperatorState<T>> {
    const fetchInto = (set: (next: OperatorState<T>) => void, keepShown: boolean, current: () => OperatorState<T>) =>
      load().then(
        (value) => set({ status: 'ready', value }),
        (error: unknown) => {
          // A read behind shown numbers that fails keeps them; a first read shows why.
          if (!keepShown || current().status !== 'ready') set({ status: 'error', error: toDataError(error) });
        },
      );
    const entry = entryOf<OperatorState<T>>(key, { status: 'loading' }, (made, set) =>
      fetchInto(set, false, () => made.state),
    );
    const state = entry.state;
    const stale = now() - entry.at > OPERATOR_FRESH_MS;
    if (state.status === 'error' || (state.status === 'ready' && stale)) {
      entry.at = now();
      const set = (next: OperatorState<T>) => {
        entry.state = next;
        entry.at = now();
        for (const listener of [...entry.listeners]) listener();
      };
      if (state.status === 'error') set({ status: 'loading' });
      void fetchInto(set, state.status === 'ready', () => entry.state);
    }
    return entry.held;
  }

  /** The users list for a period and search, its pages kept together. */
  function usersList(period: OperatorPeriod, q: string): OperatorUsersHeld {
    let next: string | undefined;
    const start: OperatorUsersState = {
      status: 'loading',
      users: [],
      total: 0,
      hasMore: false,
      isLoadingMore: false,
      period,
    };
    const key = `users:${period}:${q}`;
    const known = entries.get(key) as (Entry<OperatorUsersState> & { more?: () => void }) | undefined;
    if (known?.more !== undefined) {
      keep(key, known as Entry<unknown>);
      const more = known.more;
      return { ...known.held, more };
    }
    let setState: (state: OperatorUsersState) => void = () => undefined;
    const entry = entryOf<OperatorUsersState>(key, start, async (made, set) => {
      setState = set;
      try {
        const page = await api.users({ period, ...(q === '' ? {} : { q }) });
        next = page.next;
        set({ ...made.state, status: 'ready', users: page.users, total: page.total, hasMore: next !== undefined });
      } catch (error) {
        set({ ...made.state, status: 'error', error: toDataError(error) });
      }
    }) as Entry<OperatorUsersState> & { more?: () => void };
    const more = () => {
      const state = entry.state;
      if (state.status !== 'ready' || state.isLoadingMore || next === undefined) return;
      const after = next;
      const { error: _dropped, ...shown } = state;
      setState({ ...shown, isLoadingMore: true });
      api.users({ period, after, ...(q === '' ? {} : { q }) }).then(
        (page) => {
          next = page.next;
          setState({
            ...entry.state,
            users: [...entry.state.users, ...page.users],
            hasMore: next !== undefined,
            isLoadingMore: false,
          });
        },
        (error: unknown) => setState({ ...entry.state, isLoadingMore: false, error: toDataError(error) }),
      );
    };
    entry.more = more;
    return { ...entry.held, more };
  }

  return {
    overview: (period: OperatorPeriod) => read(`overview:${period}`, () => api.overview(period)),
    users: usersList,
    user: (userId: string, period: OperatorPeriod) => read(`user:${userId}:${period}`, () => api.user(userId, period)),
    pages: (period: OperatorPeriod) => read(`pages:${period}`, () => api.pages(period)),
    page: (pageId: string, period: OperatorPeriod) => read(`page:${pageId}:${period}`, () => api.page(pageId, period)),
    site: (period: OperatorPeriod) => read(`site:${period}`, () => api.site(period)),
  };
}

/** The operator store's reads. */
export type OperatorStore = ReturnType<typeof createOperatorStore>;
