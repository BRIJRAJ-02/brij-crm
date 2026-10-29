// Bookings' list of every meeting (the owner's ask of 21 October 2026): one
// held list per workspace and question (tab, source and the calendars panel's
// pick), read a page at a time by cursor while a screen retains it. The first
// page is read when first held; More reads the next page and adds it. While
// held, the list is kept current as the other Bookings reads are (`fresh.ts`:
// on the person's return, and every minute while the page shows and live
// updates are paused or off, owner ask A115), and Sync now reads it once it
// has run: each of those reads what is shown from the top, as many rows as
// More added (in reads of at most `MEETINGS_PAGE_MAX`), so the pages a person
// opened stay open, and none starts while another read of the list is out. A
// failed first read shows the failure; a failed next page keeps what is shown
// and says so in `moreFailed`; a failed read of what is shown keeps it.
import type {
  BookingHosts,
  BookingListItem,
  BookingsTab,
  MeetingListItem,
  MeetingListPage,
  MeetingSource,
} from '@crm/contracts';
import { MEETINGS_PAGE_MAX } from '@crm/contracts/meeting-limits';
import { toDataError } from '../errors.ts';
import { keepFresh, type FreshDeps, type Freshness } from './fresh.ts';

/** The question a list answers. */
export interface MeetingsQuery {
  readonly when: BookingsTab;
  readonly source: MeetingSource;
  /** Whose bookings: the reader's own (absent, the default), or everyone's for an admin (`booking.admin`). */
  readonly hosts?: BookingHosts;
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

/** What the store needs: the calls, and what keeps a held list current (`fresh.ts`: the return signal, live's status). */
export interface MeetingsDeps extends FreshDeps {
  readonly api: MeetingsApi;
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

/**
 * The most rows a read of what is shown covers: five reads of `MEETINGS_PAGE_MAX`. A list More grew past it shows the
 * first ones after such a read, and More reads the rest again.
 */
export const SHOWN_READ_MAX = 5 * MEETINGS_PAGE_MAX;

/** The key one question is held under. */
const keyOf = (workspace: string, query: MeetingsQuery) =>
  [
    workspace,
    query.when,
    query.source,
    query.hosts ?? 'mine',
    query.calendarIds === undefined ? '*' : [...query.calendarIds].sort().join(','),
  ].join(':');

/** The meetings store: one held list per workspace and question. */
export function createMeetingsStore(deps: MeetingsDeps) {
  const limit = deps.pageSize ?? 50;
  const lists = new Map<string, Made>();

  /** A held list as the store keeps it: its workspace, and a way to show an edit of its items at once. */
  type Made = MeetingsHeld & {
    readonly workspace: string;
    /** Reads what is shown again now, when a screen holds the list (Sync now ran). */
    readonly refresh: () => void;
    readonly patch: (edit: (item: MeetingListItem) => MeetingListItem) => () => void;
  };

  function make(workspace: string, query: MeetingsQuery): Made {
    let state: MeetingsState = { status: 'loading' };
    let cursor: string | undefined;
    let held = 0;
    let fresh: Freshness | undefined;
    // Each read from the top counts; one that lands after a newer one began is dropped.
    let generation = 0;
    // Each read from the top that landed counts; a next page asked for before one landed is dropped.
    let landed = 0;
    // The read from the top that is out, and the next page that is out: a read of what is shown waits for either.
    let topRead: Promise<boolean> | undefined;
    let moreRead: Promise<void> | undefined;
    const listeners = new Set<() => void>();
    const set = (next: MeetingsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const ask = (after: string | undefined, size: number) =>
      deps.api.page({
        workspace,
        when: query.when,
        source: query.source,
        hosts: query.hosts ?? 'mine',
        ...(query.calendarIds === undefined ? {} : { calendarIds: [...query.calendarIds] }),
        ...(after === undefined ? {} : { cursor: after }),
        limit: size,
      });
    let settled: Promise<void> | undefined;
    /**
     * Reads from the top, a page first, then on until `rows` rows are covered or the list ends, in reads of at most
     * `MEETINGS_PAGE_MAX`, and shows them at once when all landed. Answers whether it landed (one a newer read from the
     * top replaced counts).
     */
    const readTop = (rows: number): Promise<boolean> => {
      generation += 1;
      const mine = generation;
      const read = async (): Promise<boolean> => {
        let items: readonly MeetingListItem[] = [];
        let next: string | undefined;
        let page: MeetingListPage;
        do {
          page = await ask(next, Math.min(MEETINGS_PAGE_MAX, Math.max(limit, rows - items.length)));
          if (mine !== generation) return true;
          items = [...items, ...page.items];
          next = page.nextCursor;
        } while (next !== undefined && page.items.length > 0 && items.length < rows);
        cursor = next;
        landed += 1;
        set({ status: 'ready', items, hasMore: next !== undefined, isLoadingMore: false, moreFailed: false });
        return true;
      };
      const reading = read()
        .catch((error: unknown) => {
          if (mine !== generation) return true;
          if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          return false;
        })
        .finally(() => {
          if (topRead === reading) topRead = undefined;
        });
      topRead = reading;
      return reading;
    };
    const readFirst = () => readTop(0);
    /**
     * What is shown, read again from the top (at most `SHOWN_READ_MAX` rows, the rest left to More): never beside
     * another read of the list, whose answer it waits for instead.
     */
    const readShown = (): Promise<boolean> => {
      if (topRead !== undefined) return topRead;
      if (moreRead !== undefined) return moreRead.then(() => true);
      return readTop(Math.min(SHOWN_READ_MAX, state.status === 'ready' ? state.items.length : 0));
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
        if (held === 1) fresh = keepFresh(readShown, deps);
        return () => {
          held -= 1;
          if (held === 0) {
            fresh?.stop();
            fresh = undefined;
          }
        };
      },
      loadMore() {
        if (state.status !== 'ready' || state.isLoadingMore || cursor === undefined) return;
        const shown = state;
        // A read from the top that lands meanwhile shows the list afresh (and More again): this page is dropped.
        const seen = landed;
        set({ ...shown, isLoadingMore: true, moreFailed: false });
        const reading = ask(cursor, limit)
          .then(
            (page) => {
              if (seen !== landed || state.status !== 'ready') return;
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
              if (seen !== landed || state.status !== 'ready') return;
              set({ ...state, isLoadingMore: false, moreFailed: true });
            },
          )
          .finally(() => {
            if (moreRead === reading) moreRead = undefined;
          });
        moreRead = reading;
      },
      ready() {
        settled ??= readFirst().then(() => undefined);
        return settled;
      },
      reload() {
        void readFirst();
      },
      refresh() {
        fresh?.now();
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
    /**
     * Reads what the lists a screen holds show now, keeping the pages More added, and starts their minute again
     * (Sync now ran); a list nobody holds reads when held again.
     */
    refreshHeld(workspace: string): void {
      for (const each of lists.values()) if (each.workspace === workspace) each.refresh();
    },
  };
}

/** The meetings store. */
export type MeetingsStore = ReturnType<typeof createMeetingsStore>;
