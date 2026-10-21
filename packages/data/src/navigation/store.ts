// `data.nav` (spec 0034): the member's own sidebar in each workspace, one
// copy per workspace for the app load. What the server answered is the base
// (`confirmed`); each change waiting for its answer is a layer applied over it
// with the same pure rule the server runs (`applyNavOp`), so a change shows at
// once (AC-937). Changes go out one at a time, in the order made. A refused
// one is dropped, the sidebar redraws without it, and the person is told with
// Retry. A read is only taken when its `version` is at least the base's, so a
// stale answer never undoes a newer change. A sidebar that couldn't be read is
// said once (the screen draws the defaults meanwhile), read again the next
// time a screen holds it, and as soon as a change of the member's lands.
//
// Live: a `nav` event naming this member reads the sidebar again (another tab
// or device of theirs changed it); one naming another member does nothing. A
// `views` or `records` event that names a starred view or record, or a
// resync, reads it again too, coarsely and at most once a second, so a
// favourite renamed, deleted, trashed or restored follows (AC-939).
//
// Plain TypeScript with no runtime imports beyond the contracts' plain model,
// so it sits in the first load and the sidebar's first paint has the
// member's order (AC-936).
import type { NavState } from '@crm/contracts';
import { applyNavOp, navKey, type NavOperation, type NavPrefs, type NavUniverse } from '@crm/contracts/navigation';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';

/** The store's own words: a refused change's toast, and the sidebar that couldn't be read. */
export const NAV_WORDS = {
  retry: 'Retry',
  /** Before the refusal's reason: what was put back. */
  notChanged: 'Your sidebar wasn’t changed.',
  unavailable: 'Couldn’t load your sidebar, so it shows the default order.',
} as const;

/**
 * Failures a screen already says in its own way, so the sidebar's notice stays quiet for them: the workspace isn't
 * there or isn't the person's ("Workspace not found"), or the session ended (sign in again).
 */
const SAID_ELSEWHERE: readonly string[] = ['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'];

/** The least time between two coarse rereads of one workspace's sidebar (a burst of favourite changes). */
export const NAV_REREAD_MS = 1000;

/** The calls the store makes, each mapped to a DataError by the layer. */
export interface NavApi {
  readonly get: (workspace: string) => Promise<NavState>;
  readonly change: (workspace: string, op: NavOperation, mutationId: string) => Promise<{ readonly version: number }>;
}

/** What a screen reads: the sidebar as it shows now (changes waiting included), or why it isn't there. */
export type NavSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly nav: NavState };

/** One workspace's sidebar as a screen holds it (`useNav`). */
export interface NavSource {
  readonly retain: () => () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => NavSnapshot;
}

/** Dependencies, passed in by the layer. */
export interface NavStoreDeps {
  readonly api: NavApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  /** Watches the workspace's live channel while a screen holds its sidebar; answers the release. */
  readonly watch: (workspace: string) => () => void;
  /** Whether an event's member ids name the person (their member id in the workspace). */
  readonly namesMe: (workspace: string, memberIds: readonly string[]) => Promise<boolean>;
  /** A refused change was put back: say why, with Retry. */
  readonly onRefused: (error: DataError, retry: () => void) => void;
  /** The sidebar couldn't be read and nothing is held: say so once, with Retry, until a read succeeds. */
  readonly onUnavailable: (error: DataError, retry: () => void) => void;
  /** Timers, for tests. */
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
}

interface Pending {
  readonly op: NavOperation;
  /** What the sidebar could show when the change was made: the same index the server reads. */
  readonly universe: NavUniverse;
}

interface Entry {
  confirmed?: NavState;
  error?: DataError;
  reading?: Promise<NavState>;
  /** Changes not yet answered, oldest first: the first is out, the rest wait their turn. */
  readonly pending: Pending[];
  sending: boolean;
  snapshot: NavSnapshot;
  readonly listeners: Set<() => void>;
  holders: number;
  release?: () => void;
  rereadDue: boolean;
  rereadAgain: boolean;
  /** The person was told the sidebar couldn't be read; not again until a read succeeds. */
  toldUnavailable: boolean;
}

/** The stored choices of a state, for the pure rule. */
const prefsOfState = (state: NavState): NavPrefs => ({
  items: state.items,
  sections: { order: state.sections.order, folded: state.sections.folded },
  rail: state.rail,
});

/** The state with `prefs` in place, favourites unstarred meanwhile left out. */
function withPrefs(state: NavState, prefs: NavPrefs): NavState {
  const starred = new Set(prefs.items.filter((item) => item.pinned === true).map(navKey));
  return {
    ...state,
    items: prefs.items.map((item) => ({ ...item })),
    sections: { order: [...prefs.sections.order], folded: [...prefs.sections.folded] },
    rail: prefs.rail,
    favourites: state.favourites.filter((favourite) => starred.has(navKey(favourite))),
  };
}

/** The member's sidebar in each workspace, with optimistic changes and live rereads. */
export function createNavStore(deps: NavStoreDeps) {
  const entries = new Map<string, Entry>();
  const schedule = deps.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));

  const entryOf = (workspace: string): Entry => {
    const found = entries.get(workspace);
    if (found !== undefined) return found;
    const made: Entry = {
      pending: [],
      sending: false,
      snapshot: { status: 'loading' },
      listeners: new Set(),
      holders: 0,
      rereadDue: false,
      rereadAgain: false,
      toldUnavailable: false,
    };
    entries.set(workspace, made);
    return made;
  };

  /** The snapshot from the base and the changes waiting, told to every screen. */
  const publish = (entry: Entry) => {
    if (entry.confirmed === undefined) {
      entry.snapshot = entry.error === undefined ? { status: 'loading' } : { status: 'error', error: entry.error };
    } else {
      const prefs = entry.pending.reduce<NavPrefs>((current, { op, universe }) => {
        const applied = applyNavOp(current, op, universe);
        return applied.ok ? applied.prefs : current;
      }, prefsOfState(entry.confirmed));
      entry.snapshot = { status: 'ready', nav: withPrefs(entry.confirmed, prefs) };
    }
    for (const listener of entry.listeners) listener();
  };

  /** Takes a read as the base unless the base is newer (a change landed after the read began). */
  const settle = (entry: Entry, state: NavState) => {
    if (entry.confirmed !== undefined && state.version < entry.confirmed.version) return;
    entry.confirmed = state;
    entry.error = undefined;
  };

  /** Reads the sidebar; one read at a time per workspace, a second ask joining it. */
  const read = (workspace: string): Promise<NavState> => {
    const entry = entryOf(workspace);
    if (entry.reading !== undefined) return entry.reading;
    const reading = deps.api.get(workspace).then(
      (state) => {
        entry.reading = undefined;
        entry.toldUnavailable = false;
        settle(entry, state);
        publish(entry);
        return entry.confirmed ?? state;
      },
      (error: unknown) => {
        entry.reading = undefined;
        const failure = toDataError(error);
        if (entry.confirmed === undefined) {
          entry.error = failure;
          publish(entry);
          if (!entry.toldUnavailable && !SAID_ELSEWHERE.includes(failure.code)) {
            entry.toldUnavailable = true;
            deps.onUnavailable(failure, () => {
              void read(workspace).catch(() => undefined);
            });
          }
        }
        throw failure;
      },
    );
    entry.reading = reading;
    return reading;
  };

  /** A coarse reread, at most once per `NAV_REREAD_MS`, the first at once. */
  const reread = (workspace: string) => {
    const entry = entries.get(workspace);
    if (entry === undefined || entry.confirmed === undefined) return;
    if (entry.rereadDue) {
      // Inside the window: one more read when it ends, however many asked.
      entry.rereadAgain = true;
      return;
    }
    entry.rereadDue = true;
    void read(workspace).catch(() => undefined);
    schedule(() => {
      entry.rereadDue = false;
      if (!entry.rereadAgain) return;
      entry.rereadAgain = false;
      reread(workspace);
    }, NAV_REREAD_MS);
  };

  /** Sends the oldest waiting change, then the next, one at a time (the server sees them in the order made). */
  const sendNext = (workspace: string, entry: Entry) => {
    const next = entry.pending[0];
    if (entry.sending || next === undefined) return;
    entry.sending = true;
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    deps.api.change(workspace, next.op, mutationId).then(
      ({ version }) => {
        // Every change stores exactly one `nav` row.
        deps.mutations.answered(mutationId, 1);
        entry.pending.shift();
        entry.sending = false;
        if (entry.confirmed !== undefined) {
          const applied = applyNavOp(prefsOfState(entry.confirmed), next.op, next.universe);
          entry.confirmed = applied.ok
            ? { ...withPrefs(entry.confirmed, applied.prefs), version: Math.max(version, entry.confirmed.version) }
            : { ...entry.confirmed, version: Math.max(version, entry.confirmed.version) };
        }
        publish(entry);
        // A new favourite's name and object come from the server, which resolves it through the door; and a sidebar
        // that couldn't be read is read now that the server answers, so the change shows.
        if (next.op.op === 'star' || entry.confirmed === undefined) void read(workspace).catch(() => undefined);
        sendNext(workspace, entry);
      },
      (error: unknown) => {
        deps.mutations.forget(mutationId);
        entry.pending.shift();
        entry.sending = false;
        publish(entry);
        deps.onRefused(toDataError(error), () => {
          change(workspace, next.op, next.universe);
        });
        sendNext(workspace, entry);
      },
    );
  };

  /**
   * Applies one change at once and sends it (AC-937). `universe` is what the
   * sidebar could show as the person made it, which a move indexes into.
   */
  const change = (workspace: string, op: NavOperation, universe: NavUniverse): void => {
    const entry = entryOf(workspace);
    entry.pending.push({ op, universe });
    publish(entry);
    sendNext(workspace, entry);
  };

  return {
    /** The sidebar, read once and then kept live while held; the route loader waits for it (AC-936). */
    load: (workspace: string): Promise<NavState> => {
      const entry = entryOf(workspace);
      if (entry.snapshot.status === 'ready') return Promise.resolve(entry.snapshot.nav);
      return read(workspace).then(() => {
        const { snapshot } = entry;
        if (snapshot.status !== 'ready') throw new Error('The sidebar read settled without a state.');
        return snapshot.nav;
      });
    },
    /** What the sidebar shows now. */
    snapshot: (workspace: string): NavSnapshot => entryOf(workspace).snapshot,
    /** Tells `listener` when the snapshot changes. Answers the unsubscribe. */
    subscribe: (workspace: string, listener: () => void): (() => void) => {
      const entry = entryOf(workspace);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    /** A screen shows the sidebar: watch the workspace live while any does. Answers the release. */
    retain: (workspace: string): (() => void) => {
      const entry = entryOf(workspace);
      entry.holders += 1;
      if (entry.holders === 1) entry.release = deps.watch(workspace);
      if (entry.confirmed === undefined && entry.reading === undefined) void read(workspace).catch(() => undefined);
      let isReleased = false;
      return () => {
        if (isReleased) return;
        isReleased = true;
        entry.holders -= 1;
        if (entry.holders === 0) {
          entry.release?.();
          entry.release = undefined;
        }
      };
    },
    change,
    /** Reads it again (Retry on an error). */
    reload: (workspace: string): Promise<NavState> => read(workspace),
    /** A `nav` event: this member's sidebar changed in another tab or device (AC-937). */
    navChanged: (workspace: string, event: LiveEventOf<'nav'>): void => {
      if (!entries.has(workspace)) return;
      void deps.namesMe(workspace, event.memberIds).then((named) => {
        if (named) void read(workspace).catch(() => undefined);
      });
    },
    /** A views or records event: read again when it may touch a favourite (AC-939). */
    favouritesMayHaveChanged: (
      workspace: string,
      ids: readonly string[],
      kind: 'view' | 'record',
      coarse: boolean,
    ): void => {
      const entry = entries.get(workspace);
      const nav = entry?.confirmed;
      if (nav === undefined) return;
      const starred = nav.items.filter((item) => item.pinned === true && item.kind === kind);
      if (starred.length === 0) return;
      if (coarse || starred.some((item) => ids.includes(item.id))) reread(workspace);
    },
    /**
     * An object was made, archived or restored (a `definitions` event): read again, coarsely, since a read leaves
     * out what the member can't see today, so an object coming back takes the place they gave it, hidden if they
     * hid it. Schema changes are rare, and a burst reads once a second at most.
     */
    objectsMayHaveChanged: (workspace: string): void => {
      reread(workspace);
    },
    /** Everything held of the workspace is read again (a resync, the person's access changed). */
    resync: (workspace: string): void => {
      if (entries.get(workspace)?.confirmed !== undefined) void read(workspace).catch(() => undefined);
    },
    /** Signed out: forget everything. */
    clear: (): void => {
      for (const entry of entries.values()) entry.release?.();
      entries.clear();
    },
  };
}

/** The member's sidebar store. */
export type NavStore = ReturnType<typeof createNavStore>;
