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
  /** Reads it again after a refusal (Retry); nothing while an answer is shown or on its way. */
  readonly retry: () => void;
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
  readonly page: (workspaceId: string, pageId: string, period: OperatorPeriod) => Promise<OperatorPageDetail>;
  readonly site: (period: OperatorPeriod) => Promise<OperatorSite>;
}

/** How long an answer is shown before it is read again behind it, when asked for again. */
export const OPERATOR_FRESH_MS = 60_000;

/** The users list's page size (the contract's `OPERATOR_USERS_PAGE`). */
const OPERATOR_USERS_PAGE_SIZE = 50;

/** How many questions the store keeps; the least recently asked go first. */
const KEPT = 40;

interface Entry<T> {
  state: T;
  at: number;
  /** A read is on its way. */
  busy: boolean;
  readonly listeners: Set<() => void>;
  readonly settled: Promise<void>;
  readonly held: OperatorHeld<T>;
  /** Reads again: `keepShown` keeps a shown answer while it reads and if the read fails. */
  readonly refresh: (keepShown: boolean) => void;
}

/** The store, one per data layer. `now` is passed in for tests. */
export function createOperatorStore(api: OperatorApi, now: () => number = Date.now) {
  const entries = new Map<string, Entry<unknown>>();
  /** Each users list's cursor to its next page, by its entry's key: dropped with the entry. */
  const cursors = new Map<string, string | undefined>();

  /** The entry for `key`, made and read the first time: kept for the app load, the newest `KEPT` of them. */
  const entryOf = <T>(
    key: string,
    start: T,
    load: (entry: Entry<T>, keepShown: boolean) => Promise<T>,
    isShown: (state: T) => boolean,
    failed: (state: T, error: DataError) => T,
  ): Entry<T> => {
    const known = entries.get(key) as Entry<T> | undefined;
    if (known !== undefined) {
      entries.delete(key);
      entries.set(key, known);
      return known;
    }
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const listeners = new Set<() => void>();
    const set = (next: T) => {
      entry.state = next;
      for (const listener of [...listeners]) listener();
    };
    const refresh = (keepShown: boolean) => {
      if (entry.busy) return;
      entry.busy = true;
      entry.at = now();
      if (!keepShown || !isShown(entry.state)) set(start);
      load(entry, keepShown)
        .then(
          (next) => {
            entry.busy = false;
            entry.at = now();
            set(next);
          },
          (error: unknown) => {
            entry.busy = false;
            // A read behind shown numbers that fails keeps them; any other read shows why.
            if (!(keepShown && isShown(entry.state))) set(failed(entry.state, toDataError(error)));
          },
        )
        .finally(settle);
    };
    const entry: Entry<T> = {
      state: start,
      at: now(),
      busy: false,
      listeners,
      settled,
      refresh,
      held: {
        getSnapshot: () => entry.state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        ready: () => settled,
        retry: () => {
          if (!isShown(entry.state)) refresh(false);
        },
      },
    };
    entries.set(key, entry);
    // Never past `KEPT`: the least recently asked go first, unless a screen still holds them.
    for (const [old, kept] of entries) {
      if (entries.size <= KEPT) break;
      if (kept.listeners.size === 0) {
        entries.delete(old);
        cursors.delete(old);
      }
    }
    refresh(false);
    return entry;
  };

  /** A minute old answer, asked for again, is read again behind itself. */
  const freshen = <T>(entry: Entry<T>, isShown: (state: T) => boolean) => {
    if (isShown(entry.state) && now() - entry.at > OPERATOR_FRESH_MS) entry.refresh(true);
  };

  /** A plain read, held by `key`. */
  function read<T>(key: string, load: () => Promise<T>): OperatorHeld<OperatorState<T>> {
    const isShown = (state: OperatorState<T>) => state.status === 'ready';
    const entry = entryOf<OperatorState<T>>(
      key,
      { status: 'loading' },
      () => load().then((value) => ({ status: 'ready', value }) as const),
      isShown,
      (_state, error) => ({ status: 'error', error }),
    );
    freshen(entry, isShown);
    return entry.held;
  }

  /** The users list for a period and search, its pages kept together. */
  function usersList(period: OperatorPeriod, q: string): OperatorUsersHeld {
    const key = `users:${period}:${q}`;
    const search = q === '' ? {} : { q };
    const isShown = (state: OperatorUsersState) => state.status === 'ready';
    const entry = entryOf<OperatorUsersState>(
      key,
      { status: 'loading', users: [], total: 0, hasMore: false, isLoadingMore: false, period },
      async () => {
        const page = await api.users({ period, ...search });
        cursors.set(key, page.next);
        return {
          status: 'ready',
          users: page.users,
          total: page.total,
          hasMore: page.next !== undefined,
          isLoadingMore: false,
          period,
        };
      },
      isShown,
      (state, error) => ({ ...state, status: 'error', error }),
    );
    // A list grown past its first page isn't read again behind itself: that would cut it back to one page.
    if (entry.state.users.length <= OPERATOR_USERS_PAGE_SIZE) freshen(entry, isShown);
    const set = (next: OperatorUsersState) => {
      entry.state = next;
      for (const listener of [...entry.listeners]) listener();
    };
    const more = () => {
      const after = cursors.get(key);
      const state = entry.state;
      if (state.status !== 'ready' || state.isLoadingMore || entry.busy || after === undefined) return;
      const { error: _dropped, ...shown } = state;
      // Busy while it reads, so no refresh starts under it and lands its first page on the grown list.
      entry.busy = true;
      set({ ...shown, isLoadingMore: true });
      api.users({ period, after, ...search }).then(
        (page) => {
          entry.busy = false;
          cursors.set(key, page.next);
          set({
            ...entry.state,
            users: [...entry.state.users, ...page.users],
            hasMore: page.next !== undefined,
            isLoadingMore: false,
          });
        },
        (error: unknown) => {
          entry.busy = false;
          set({ ...entry.state, isLoadingMore: false, error: toDataError(error) });
        },
      );
    };
    return { ...entry.held, more };
  }

  return {
    overview: (period: OperatorPeriod) => read(`overview:${period}`, () => api.overview(period)),
    users: usersList,
    user: (userId: string, period: OperatorPeriod) => read(`user:${userId}:${period}`, () => api.user(userId, period)),
    pages: (period: OperatorPeriod) => read(`pages:${period}`, () => api.pages(period)),
    page: (workspaceId: string, pageId: string, period: OperatorPeriod) =>
      read(`page:${workspaceId}:${pageId}:${period}`, () => api.page(workspaceId, pageId, period)),
    site: (period: OperatorPeriod) => read(`site:${period}`, () => api.site(period)),
  };
}

/** The operator store's reads. */
export type OperatorStore = ReturnType<typeof createOperatorStore>;
