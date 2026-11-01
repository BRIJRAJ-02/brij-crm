// Following a record (collaboration), loaded with the first record header that shows Follow. One copy per record,
// read when a header first holds it and shared by the page and the panel. A toggle shows at once, is sent, and goes
// back with a toast when refused; a newer toggle wins over an older answer. A follow is the member's own and no live
// event carries it: another device's toggle shows the next time a header holds the record.
import type { FollowState } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

/** A record's follow, as a header holds it. */
export type FollowSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly following: boolean };

/** One record's follow, read when first held. */
export interface FollowHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FollowSnapshot;
  readonly retain: () => () => void;
  /** Follows or unfollows at once; put back with a toast when refused. Answers whether it landed. */
  readonly toggle: (following: boolean) => Promise<boolean>;
}

/** What the store calls on the API. */
export interface FollowsApi {
  readonly get: (input: { readonly workspace: string; readonly recordId: string }) => Promise<FollowState>;
  readonly set: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly following: boolean;
    readonly mutationId: string;
  }) => Promise<FollowState>;
}

/** What the store is made with. */
export interface FollowsDeps {
  readonly api: FollowsApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
}

/** The most records whose follow the store keeps; past it the least recently held one nobody shows goes first. */
export const FOLLOWS_KEPT = 200;

/** Every record's follow the member has looked at, per workspace. */
export function createFollowsStore(deps: FollowsDeps) {
  const held = new Map<string, ReturnType<typeof make>>();

  function make(workspace: string, recordId: string) {
    let state: FollowSnapshot = { status: 'loading' };
    // Each toggle's number: an answer that isn't the newest one's changes nothing.
    let made = 0;
    let reading = false;
    const listeners = new Set<() => void>();
    const set = (next: FollowSnapshot) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      if (reading) return;
      reading = true;
      const asked = made;
      deps.api.get({ workspace, recordId }).then(
        (answer) => {
          reading = false;
          if (asked === made) set({ status: 'ready', following: answer.following });
        },
        () => {
          reading = false;
          if (state.status !== 'ready') set({ status: 'error' });
        },
      );
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      isShown: () => listeners.size > 0,
      retain() {
        // Read again each time a header holds it, so another device's toggle shows on the next visit.
        read();
        return () => undefined;
      },
      async toggle(following: boolean): Promise<boolean> {
        const before = state;
        made += 1;
        const mine = made;
        set({ status: 'ready', following });
        try {
          const answer = await deps.api.set({ workspace, recordId, following, mutationId: deps.mintId() });
          if (mine === made) set({ status: 'ready', following: answer.following });
          return true;
        } catch (error) {
          if (mine === made) set(before);
          deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
          return false;
        }
      },
    };
  }

  const of = (workspace: string, recordId: string) => {
    const key = `${workspace}:${recordId}`;
    const found = held.get(key);
    if (found !== undefined) {
      // Touched: it moves to the newest end, so the oldest is the least recently used.
      held.delete(key);
      held.set(key, found);
      return found;
    }
    // Bounded: a long session opens many records, and an old one is read again when it comes back. One a bell
    // still shows is never dropped, so its toggle always reaches the copy on screen.
    if (held.size >= FOLLOWS_KEPT) {
      const idle = [...held].find(([, entry]) => !entry.isShown());
      if (idle !== undefined) held.delete(idle[0]);
    }
    const created = make(workspace, recordId);
    held.set(key, created);
    return created;
  };

  return {
    /** A record's follow, read when a header first holds it. Read it through `useFollow`. */
    forRecord: (workspace: string, recordId: string): FollowHeld => of(workspace, recordId),
    /** Follows or unfollows at once; put back with a toast when refused. Answers whether it landed. */
    set: (workspace: string, recordId: string, following: boolean): Promise<boolean> =>
      of(workspace, recordId).toggle(following),
    /** Signed out: forgets every record's. */
    clear: (): void => {
      held.clear();
    },
  };
}

/** The follows store. */
export type FollowsStore = ReturnType<typeof createFollowsStore>;
