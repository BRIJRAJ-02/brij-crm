// Bookings' list of every meeting (the owner's ask of 21 October 2026): one
// held list per workspace and question (tab, source and the calendars panel's
// pick), read a page at a time by cursor while a screen retains it. The first
// page is read when first held, and again when the person comes back to the
// page (as the other Bookings reads are); More reads the next page and adds
// it. A failed first read shows the failure; a failed next page keeps what is
// shown and says so in `moreFailed`.
import type { BookingListItem, BookingsTab, MeetingListItem, MeetingListPage, MeetingSource } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { browserReturn } from './store.ts';

/** The question a list answers. */
export interface MeetingsQuery {
  readonly when: BookingsTab;
  readonly source: MeetingSource;
  /** The calendars panel's pick; absent is every calendar shown. */
  readonly calendarIds?: readonly string[];
}

/** The calls the store makes. */
export interface MeetingsApi {
  readonly page: (
    input: { readonly workspace: string; readonly cursor?: string; readonly limit: number } & Omit<
      MeetingsQuery,
      'calendarIds'
    > & { readonly calendarIds?: string[] },
  ) => Promise<MeetingListPage>;
}

/** What the store needs. */
export interface MeetingsDeps {
  readonly api: MeetingsApi;
  /** Calls `refresh` whenever the person comes back to the page; answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  /** Rows a page asks for. */
  readonly pageSize?: number;
}

/** One list's state. */
export type MeetingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly items: readonly MeetingListItem[];
      /** More pages wait. */
      readonly hasMore: boolean;
      readonly isLoadingMore: boolean;
      /** The last next page failed: More tries again. */
      readonly moreFailed: boolean;
    };

/** One list, as a screen retains it. */
export interface MeetingsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => MeetingsState;
  readonly retain: () => () => void;
  /** Settles once a first read did (the route's loader), read or failed. */
  readonly ready: () => Promise<void>;
  /** Reads the next page and adds it (More). */
  readonly loadMore: () => void;
  /** Reads the first page again (Try again). */
  readonly reload: () => void;
}

/** The key one question is held under. */
const keyOf = (workspace: string, query: MeetingsQuery) =>
  [
    workspace,
    query.when,
    query.source,
    query.calendarIds === undefined ? '*' : [...query.calendarIds].sort().join(','),
  ].join(':');

/** The meetings store: one held list per workspace and question. */
export function createMeetingsStore(deps: MeetingsDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const limit = deps.pageSize ?? 50;
  const lists = new Map<string, Made>();

  /** A held list as the store keeps it: its workspace, and a way to show an edit of its items at once. */
  type Made = MeetingsHeld & {
    readonly workspace: string;
    readonly patch: (edit: (item: MeetingListItem) => MeetingListItem) => () => void;
  };

  function make(workspace: string, query: MeetingsQuery): Made {
    let state: MeetingsState = { status: 'loading' };
    let cursor: string | undefined;
    let held = 0;
    let release: (() => void) | undefined;
    // Each first read counts; a page that lands after a newer first read began is dropped.
    let generation = 0;
    const listeners = new Set<() => void>();
    const set = (next: MeetingsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const ask = (after: string | undefined) =>
      deps.api.page({
        workspace,
        when: query.when,
        source: query.source,
        ...(query.calendarIds === undefined ? {} : { calendarIds: [...query.calendarIds] }),
        ...(after === undefined ? {} : { cursor: after }),
        limit,
      });
    let settled: Promise<void> | undefined;
    const readFirst = (): Promise<void> => {
      generation += 1;
      const mine = generation;
      return ask(undefined).then(
        (page) => {
          if (mine !== generation) return;
          cursor = page.nextCursor;
          set({
            status: 'ready',
            items: page.items,
            hasMore: page.nextCursor !== undefined,
            isLoadingMore: false,
            moreFailed: false,
          });
        },
        (error: unknown) => {
          if (mine !== generation) return;
          if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
        },
      );
    };
    return {
      workspace,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (held === 1) {
          void readFirst();
          release = onReturn(() => void readFirst());
        }
        return () => {
          held -= 1;
          if (held === 0) {
            release?.();
            release = undefined;
          }
        };
      },
      loadMore() {
        if (state.status !== 'ready' || state.isLoadingMore || cursor === undefined) return;
        const shown = state;
        const mine = generation;
        set({ ...shown, isLoadingMore: true, moreFailed: false });
        ask(cursor).then(
          (page) => {
            if (mine !== generation || state.status !== 'ready') return;
            cursor = page.nextCursor;
            set({
              status: 'ready',
              items: [...state.items, ...page.items],
              hasMore: page.nextCursor !== undefined,
              isLoadingMore: false,
              moreFailed: false,
            });
          },
          () => {
            if (mine !== generation || state.status !== 'ready') return;
            set({ ...state, isLoadingMore: false, moreFailed: true });
          },
        );
      },
      ready() {
        settled ??= readFirst();
        return settled;
      },
      reload() {
        void readFirst();
      },
      patch(edit) {
        if (state.status !== 'ready') return () => undefined;
        const before = state;
        const patched: MeetingsState = { ...before, items: before.items.map(edit) };
        set(patched);
        // Only while nothing newer landed: a read or another change since then is left as it is.
        return () => {
          if (state === patched) set(before);
        };
      },
    };
  }

  return {
    /** One workspace's list for a question: the same one for the same question. */
    list(workspace: string, query: MeetingsQuery): MeetingsHeld {
      const key = keyOf(workspace, query);
      const found = lists.get(key);
      if (found !== undefined) return found;
      const made = make(workspace, query);
      lists.set(key, made);
      return made;
    },
    /** Forgets every list (signed out): the next person's lists start from nothing. */
    clear(): void {
      lists.clear();
    },
    /**
     * Shows `edit` of one booking in every list of the workspace at once (a link made by hand, polish F2); answers
     * how to put them all back on a refusal.
     */
    patchBooking(
      workspace: string,
      bookingId: string,
      edit: (booking: BookingListItem) => BookingListItem,
    ): () => void {
      const restores = [...lists.values()]
        .filter((each) => each.workspace === workspace)
        .map((each) =>
          each.patch((item) =>
            item.kind === 'booking' && item.booking.id === bookingId ? { ...item, booking: edit(item.booking) } : item,
          ),
        );
      return () => {
        for (const restore of restores) restore();
      };
    },
    /** Reads every held list of a workspace again (a booking made, moved or cancelled; a calendar shown). */
    reloadAll(workspace: string): void {
      for (const each of lists.values()) if (each.workspace === workspace) each.reload();
    },
  };
}

/** The meetings store. */
export type MeetingsStore = ReturnType<typeof createMeetingsStore>;
