// Bookings, the workspace's list (spec 0025, AC-646): one held list per
// workspace and tab (upcoming or past), read while a screen retains it.
// Bookings are settings, not CRM data, so no change event says one arrived
// yet (a `bookings` event kind is the follow-up): while held, the list is
// read again whenever the window comes back into focus or the tab becomes
// visible, so a booking made on a public page shows without a refresh.
// Nothing polls. A failed read keeps the list already shown; only a first
// read shows the failure.
import type { BookingListItem, BookingsTab } from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** The call the store makes. */
export interface BookingsApi {
  readonly listAll: (input: {
    readonly workspace: string;
    readonly when: BookingsTab;
  }) => Promise<readonly BookingListItem[]>;
}

/** What the store needs: the call, and (for tests) the return signal. */
export interface BookingsDeps {
  readonly api: BookingsApi;
  /** Calls `refresh` whenever the person comes back to the page (focus, visible again); answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
}

/** One list's state: loading, failed, or the bookings as the server last said. */
export type BookingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly bookings: readonly BookingListItem[] };

/** One workspace's list, as a screen retains it. */
export interface BookingsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => BookingsState;
  /** Held while a screen shows it: read when first held, and again whenever the person comes back to the page. */
  readonly retain: () => () => void;
  /** Settles once the first read did. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
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

/** The bookings store: every workspace's two lists. */
export function createBookingsStore(deps: BookingsDeps) {
  const onReturn = deps.onReturn ?? browserReturn;
  const views = new Map<string, BookingsView>();

  function makeView(workspace: string, when: BookingsTab): BookingsView {
    let state: BookingsState = { status: 'loading' };
    let held = 0;
    let reading: Promise<void> | undefined;
    let settled: Promise<void> | undefined;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const set = (next: BookingsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<void> => {
      reading ??= deps.api
        .listAll({ workspace, when })
        .then(
          (bookings) => set({ status: 'ready', bookings }),
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
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (held === 1) {
          void read();
          release = onReturn(() => void read());
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
    };
  }

  return {
    /** One workspace's upcoming or past list. */
    view(workspace: string, when: BookingsTab): BookingsView {
      const key = `${workspace}:${when}`;
      const found = views.get(key);
      if (found !== undefined) return found;
      const made = makeView(workspace, when);
      views.set(key, made);
      return made;
    },
  };
}

/** The bookings store. */
export type BookingsStore = ReturnType<typeof createBookingsStore>;
