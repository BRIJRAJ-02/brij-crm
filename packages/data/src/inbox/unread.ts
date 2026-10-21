// The inbox's unread count (spec 0038, AC-1174), in the first load: tiny and
// free of runtime imports, so the sidebar's badge shows on every page without
// loading the inbox. One count per workspace, read when a screen first holds
// it (the sidebar, the inbox) and again on each `notifications` event naming
// the signed in member (coalesced to one read per 250 ms), on a resync, and
// after the inbox marks something. While held it watches the workspace, so the
// count is live on every page. The value is the server's count of unread
// notifications the member may see, with 100 standing for "more than 99":
// `undefined` until the first answer (and after a failed one).

/** How long a burst of events waits before one read of the count. */
export const UNREAD_COALESCE_MS = 250;

/** The value the count holds past 99: the badge reads "99+". */
export const UNREAD_PAST_CAP = 100;

/** How long a count nobody holds keeps its value before it lets go. */
const UNUSED_MS = 30_000;

/** The unread count of one workspace, as the sidebar and the inbox read it (`useInboxUnread`). */
export interface UnreadSource {
  readonly subscribe: (listener: () => void) => () => void;
  /** The count, 100 for more than 99, or undefined before the first answer. */
  readonly getSnapshot: () => number | undefined;
  /** Holds the count (and watches the workspace) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
}

/** What the count needs from the layer. */
export interface UnreadDeps {
  /** `notifications.count` for the workspace. */
  readonly read: (workspace: string) => Promise<{ readonly count: number; readonly atLeast: boolean }>;
  /** Listens to the workspace's change events while held; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
}

/** The counts of every workspace, and what the layer tells them. */
export interface UnreadCounts {
  /** The workspace's count (the same source each time while it is held or remembered). */
  readonly unread: (workspace: string) => UnreadSource;
  /** Reads the count again soon (an event naming me, a mark, a resync, records trashed or restored). */
  readonly refresh: (workspace: string) => void;
  /** Moves the shown count at once (an optimistic mark); the read that follows settles it. */
  readonly adjust: (workspace: string, delta: number) => void;
  /** Forgets every count (signed out). */
  readonly clear: () => void;
}

interface Entry {
  readonly source: UnreadSource;
  value: number | undefined;
  holders: number;
  reading: boolean;
  again: boolean;
  stopWatch?: () => void;
  cancelRead?: () => void;
  cancelDrop?: () => void;
  readonly listeners: Set<() => void>;
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** A new set of unread counts. */
export function createUnreadCounts(deps: UnreadDeps): UnreadCounts {
  const later = deps.later ?? defaultLater;
  let entries = new Map<string, Entry>();

  const announce = (entry: Entry) => {
    for (const listener of entry.listeners) listener();
  };

  const read = (workspace: string, entry: Entry) => {
    if (entry.reading) {
      entry.again = true;
      return;
    }
    entry.reading = true;
    entry.again = false;
    deps.read(workspace).then(
      (answer) => {
        entry.reading = false;
        if (entries.get(workspace) !== entry) return;
        const next = answer.atLeast ? UNREAD_PAST_CAP : Math.min(answer.count, UNREAD_PAST_CAP);
        if (next !== entry.value) {
          entry.value = next;
          announce(entry);
        }
        if (entry.again) read(workspace, entry);
      },
      () => {
        entry.reading = false;
        if (entry.again && entries.get(workspace) === entry) read(workspace, entry);
      },
    );
  };

  const soon = (workspace: string, entry: Entry) => {
    if (entry.cancelRead !== undefined) return;
    entry.cancelRead = later(() => {
      entry.cancelRead = undefined;
      read(workspace, entry);
    }, UNREAD_COALESCE_MS);
  };

  const entryOf = (workspace: string): Entry => {
    const held = entries.get(workspace);
    if (held !== undefined) return held;
    const listeners = new Set<() => void>();
    const entry: Entry = {
      value: undefined,
      holders: 0,
      reading: false,
      again: false,
      listeners,
      source: {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => entry.value,
        retain() {
          entry.holders += 1;
          entry.cancelDrop?.();
          entry.cancelDrop = undefined;
          if (entry.holders === 1) {
            entry.stopWatch = deps.watch(workspace);
            read(workspace, entry);
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            entry.holders -= 1;
            if (entry.holders > 0) return;
            entry.stopWatch?.();
            entry.stopWatch = undefined;
            entry.cancelDrop = later(() => {
              if (entry.holders === 0 && entries.get(workspace) === entry) {
                entry.cancelRead?.();
                entries.delete(workspace);
              }
            }, UNUSED_MS);
          };
        },
      },
    };
    entries.set(workspace, entry);
    return entry;
  };

  return {
    unread: (workspace) => entryOf(workspace).source,
    refresh(workspace) {
      const entry = entries.get(workspace);
      if (entry === undefined || entry.holders === 0) return;
      soon(workspace, entry);
    },
    adjust(workspace, delta) {
      const entry = entries.get(workspace);
      if (entry?.value === undefined || entry.value >= UNREAD_PAST_CAP) return;
      const next = Math.max(0, entry.value + delta);
      if (next === entry.value) return;
      entry.value = next;
      announce(entry);
    },
    clear() {
      for (const entry of entries.values()) {
        entry.cancelRead?.();
        entry.cancelDrop?.();
        entry.stopWatch?.();
        entry.value = undefined;
        announce(entry);
      }
      entries = new Map();
    },
  };
}
