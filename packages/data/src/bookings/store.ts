// Bookings (spec 0025, AC-646): one held list per workspace and tab
// (upcoming, past or cancelled), and one held calendar read per workspace and
// range (the week view: its bookings and the reader's own calendar events),
// read while a screen retains them. Bookings are settings, not CRM data, so
// no change event says one arrived yet (a `bookings` event kind is the
// follow-up): while held, each is kept current by `fresh.ts`, read again
// whenever the window comes back into focus or the tab becomes visible, and
// every minute while the page shows and live updates are paused or off, so a
// booking made on a public page, or a meeting a calendar sync brought, shows
// without a refresh (owner ask A115). A failed read keeps what is shown; only
// a first read shows the failure. A change the member makes reads every held
// one again (`reloadAll`); Sync now reads the held ones once it has run
// (`refreshHeld`).
import type { BookingHosts, BookingListItem, BookingsCalendarView, BookingsTab } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { keepFresh, type FreshDeps, type Freshness } from './fresh.ts';

/** The calls the store makes. */
export interface BookingsApi {
  readonly listAll: (input: {
    readonly workspace: string;
    readonly when: BookingsTab;
  }) => Promise<readonly BookingListItem[]>;
  readonly calendar: (input: {
    readonly workspace: string;
    readonly from: string;
    readonly to: string;
    readonly hosts: BookingHosts;
  }) => Promise<BookingsCalendarView>;
}

/** What the store needs: the calls, and what keeps a held read current (`fresh.ts`: the return signal, live's status). */
export interface BookingsDeps extends FreshDeps {
  readonly api: BookingsApi;
}

/** One held read's state: loading, failed, or what the server last said. */
export type HeldState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & T);

/** One list's state. */
export type BookingsState = HeldState<{ readonly bookings: readonly BookingListItem[] }>;

/** One range's state: its bookings and the reader's calendar events. */
export type BookingsCalendarState = HeldState<BookingsCalendarView>;

/** A held read, as a screen retains it. */
export interface HeldView<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  /**
   * Held while a screen shows it: read when first held, again whenever the person comes back to the page, and every
   * minute while the page shows and live updates are paused or off (`fresh.ts`).
   */
  readonly retain: () => () => void;
  /** Settles once the first read did; after a failed read, reads again. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** One workspace's list. */
export type BookingsView = HeldView<BookingsState>;

/** One workspace's range. */
export type BookingsCalendarHeld = HeldView<BookingsCalendarState>;

/** At most this many ranges are kept that no screen holds (the weeks paged past), the oldest dropped first. */
const UNHELD_RANGES_MAX = 12;

/** The bookings store: every workspace's lists and ranges. */
export function createBookingsStore(deps: BookingsDeps) {
  const lists = new Map<
    string,
    BookingsView & {
      readonly refresh: () => void;
      readonly patch: (
        edit: (shown: { readonly bookings: readonly BookingListItem[] }) => {
          readonly bookings: readonly BookingListItem[];
        },
      ) => () => void;
    }
  >();
  const ranges = new Map<
    string,
    BookingsCalendarHeld & {
      readonly refresh: () => void;
      readonly isHeld: () => boolean;
      readonly patch: (edit: (shown: BookingsCalendarView) => BookingsCalendarView) => () => void;
    }
  >();

  function makeView<T extends object>(load: () => Promise<T>) {
    let state: HeldState<T> = { status: 'loading' };
    let held = 0;
    // The read that is out, answering whether it landed: one at a time, whoever asks.
    let reading: Promise<boolean> | undefined;
    let settled: Promise<void> | undefined;
    let fresh: Freshness | undefined;
    const listeners = new Set<() => void>();
    const set = (next: HeldState<T>) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<boolean> => {
      reading ??= load()
        .then(
          (answer) => {
            set({ status: 'ready', ...answer });
            return true;
          },
          (error: unknown) => {
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
            return false;
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
        if (held === 1) fresh = keepFresh(read, deps);
        return () => {
          held -= 1;
          if (held === 0) {
            fresh?.stop();
            fresh = undefined;
          }
        };
      },
      ready() {
        // A failed read is tried again when asked, so a passing outage doesn't stick to a range no screen holds.
        if (state.status === 'error' && reading === undefined) settled = read().then(() => undefined);
        settled ??= read().then(() => undefined);
        return settled;
      },
      reload() {
        void read();
      },
      /** Reads it now when a screen holds it, starting its minute again (Sync now ran); nothing when none does. */
      refresh() {
        fresh?.now();
      },
      /** Shows `edit` of what is shown at once (a ready state only); answers how to put it back. */
      patch(edit: (shown: T) => T): () => void {
        if (state.status !== 'ready') return () => undefined;
        const before = state;
        const patched: HeldState<T> = { ...before, ...edit(before) };
        set(patched);
        // Only while nothing newer landed: a read or another change since then is left as it is.
        return () => {
          if (state === patched) set(before);
        };
      },
      isHeld: () => held > 0,
    };
  }

  return {
    /** One workspace's upcoming, past or cancelled list. */
    view(workspace: string, when: BookingsTab): BookingsView {
      const key = `${workspace}:${when}`;
      const found = lists.get(key);
      if (found !== undefined) return found;
      const made = makeView(async () => ({ bookings: await deps.api.listAll({ workspace, when }) }));
      lists.set(key, made);
      return made;
    },
    /**
     * One workspace's range: its bookings and the reader's calendar events (the week view). `hosts` is whose
     * bookings: the reader's own (the default), or everyone's for an admin; each is its own held read.
     */
    calendar(workspace: string, from: string, to: string, hosts: BookingHosts = 'mine'): BookingsCalendarHeld {
      const key = `${workspace}:${from}:${to}:${hosts}`;
      const found = ranges.get(key);
      if (found !== undefined) return found;
      const made = makeView(() => deps.api.calendar({ workspace, from, to, hosts }));
      ranges.set(key, made);
      const unheld = [...ranges.entries()].filter(([, view]) => !view.isHeld());
      for (const [old] of unheld.slice(0, Math.max(0, unheld.length - UNHELD_RANGES_MAX))) ranges.delete(old);
      return made;
    },
    /**
     * Shows `edit` on every range of the workspace at once (an optimistic block
     * or removal, spec 0027); answers how to put them all back on a refusal.
     */
    patchRanges(workspace: string, edit: (shown: BookingsCalendarView) => BookingsCalendarView): () => void {
      const restores = [...ranges.entries()]
        .filter(([key]) => key.startsWith(`${workspace}:`))
        .map(([, view]) => view.patch(edit));
      return () => {
        for (const restore of restores) restore();
      };
    },
    /**
     * Shows `edit` of one booking in every list and range of the workspace at
     * once (an optimistic cancel or move); answers how to put them all back.
     * The lists are read again after the server answers, so a booking that
     * changed tabs lands in the right one.
     */
    patchBooking(
      workspace: string,
      bookingId: string,
      edit: (booking: BookingListItem) => BookingListItem,
    ): () => void {
      const each = (bookings: readonly BookingListItem[]) =>
        bookings.map((booking) => (booking.id === bookingId ? edit(booking) : booking));
      const restores = [
        ...[...lists.entries()]
          .filter(([key]) => key.startsWith(`${workspace}:`))
          .map(([, view]) => view.patch((shown) => ({ bookings: each(shown.bookings) }))),
        ...[...ranges.entries()]
          .filter(([key]) => key.startsWith(`${workspace}:`))
          .map(([, view]) => view.patch((shown) => ({ ...shown, bookings: each(shown.bookings) }))),
      ];
      return () => {
        for (const restore of restores) restore();
      };
    },
    /** Reads every list and range a screen holds again (after the member changed a booking). */
    reloadAll(workspace: string): void {
      for (const [key, view] of [...lists.entries(), ...ranges.entries()]) {
        if (key.startsWith(`${workspace}:`)) view.reload();
      }
    },
    /**
     * Reads the lists and ranges a screen holds now, each unless a read of it is out, and starts their minute again
     * (Sync now ran); one nobody holds reads when held again.
     */
    refreshHeld(workspace: string): void {
      for (const [key, view] of [...lists.entries(), ...ranges.entries()]) {
        if (key.startsWith(`${workspace}:`)) view.refresh();
      }
    },
  };
}

/** The bookings store. */
export type BookingsStore = ReturnType<typeof createBookingsStore>;
