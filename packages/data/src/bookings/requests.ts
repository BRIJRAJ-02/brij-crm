// Meetings › Requests (the Bookings redesign, 9 November 2026): every booking waiting for its host's Accept, across the
// pages, one held list per workspace, read in one call (`bookingFlow.waiting`). While a screen holds it, it is kept
// current as the other Bookings reads are (`fresh.ts`: on the person's return, and every minute while live updates are
// paused or off), and a `bookings` change event (a request made on a public page, answered in another tab, or declined
// by itself when its wait ran out) reads it again in place through `refreshHeld`, as the lists are. Accept and Decline
// take the row away at once (`hide`) and put it back on a refusal; the read that follows the answer agrees.
import type { WaitingRequestView } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { keepFresh, type FreshDeps, type Freshness } from './fresh.ts';

/** The call the store makes. */
export interface RequestsApi {
  readonly waiting: (workspace: string) => Promise<readonly WaitingRequestView[]>;
}

/** What the store needs: the call, and what keeps a held list current (`fresh.ts`). */
export interface RequestsDeps extends FreshDeps {
  readonly api: RequestsApi;
}

/** The requests as read: waiting, failed, or ready (soonest first). */
export type RequestsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly WaitingRequestView[] };

/** One workspace's requests, as a screen retains them. */
export interface RequestsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => RequestsState;
  /** Holds the list: read now (unless just read) and kept current until the answer is called. */
  readonly retain: () => () => void;
  /** Reads it again from nothing shown (Try again). */
  readonly reload: () => void;
  /** Takes one request away at once (answered here); answers how to put it back on a refusal. */
  readonly hide: (bookingId: string) => () => void;
}

/** The requests store: one held list per workspace. */
export function createRequestsStore(deps: RequestsDeps) {
  type Made = RequestsHeld & { readonly refresh: () => void };
  const lists = new Map<string, Made>();

  function make(workspace: string): Made {
    // What the server last answered, and the requests answered here whose answer it may not have read yet.
    let read: RequestsState = { status: 'loading' };
    let hidden: ReadonlySet<string> = new Set();
    let shown: RequestsState = read;
    let held = 0;
    let fresh: Freshness | undefined;
    let landedAt: number | undefined;
    // Each read counts; one that lands after a newer one began is dropped.
    let generation = 0;
    const listeners = new Set<() => void>();
    const show = () => {
      shown =
        read.status === 'ready' && hidden.size > 0
          ? { status: 'ready', items: read.items.filter((item) => !hidden.has(item.bookingId)) }
          : read;
      for (const listener of listeners) listener();
    };
    const readNow = (): Promise<boolean> => {
      generation += 1;
      const mine = generation;
      return deps.api.waiting(workspace).then(
        (items) => {
          if (mine !== generation) return true;
          landedAt = (deps.now ?? Date.now)();
          // A request answered here and gone from the answer is answered for good: nothing left to hide.
          const present = new Set(items.map((item) => item.bookingId));
          hidden = new Set([...hidden].filter((id) => present.has(id)));
          read = { status: 'ready', items };
          show();
          return true;
        },
        (error: unknown) => {
          if (mine !== generation) return true;
          // A failed read keeps what is shown; only a first read shows the failure.
          if (read.status !== 'ready') {
            read = { status: 'error', message: toDataError(error).message };
            show();
          }
          return false;
        },
      );
    };
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => shown,
      retain() {
        held += 1;
        if (held === 1) fresh = keepFresh(readNow, deps, { landedAt });
        return () => {
          held -= 1;
          if (held === 0) {
            fresh?.stop();
            fresh = undefined;
          }
        };
      },
      reload() {
        read = { status: 'loading' };
        show();
        void readNow();
      },
      hide(bookingId) {
        hidden = new Set([...hidden, bookingId]);
        show();
        return () => {
          if (!hidden.has(bookingId)) return;
          hidden = new Set([...hidden].filter((id) => id !== bookingId));
          show();
        };
      },
      refresh() {
        // Held: read now. Unheld: the next hold reads rather than trusting a read from before the change.
        if (fresh === undefined) landedAt = undefined;
        else fresh.now();
      },
    };
  }

  return {
    /** One workspace's requests: the same held list each time. */
    view(workspace: string): RequestsHeld {
      const found = lists.get(workspace);
      if (found !== undefined) return found;
      const made = make(workspace);
      lists.set(workspace, made);
      return made;
    },
    /** Reads a workspace's held requests again in place (a `bookings` event, an answer); unheld, the next hold reads. */
    refreshHeld(workspace: string): void {
      lists.get(workspace)?.refresh();
    },
    /** Forgets every list (signed out). */
    clear(): void {
      lists.clear();
    },
  };
}

/** The requests store. */
export type RequestsStore = ReturnType<typeof createRequestsStore>;
