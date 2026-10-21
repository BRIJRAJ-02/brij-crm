// The sidebar's Tasks badge (spec 0034, AC-924): how many of my open tasks
// are overdue or due today, by my local date. One count per workspace and
// date, read while a screen holds it and read again when tasks change: a
// `tasks` event (spread by the layer, since it names no assignee) or this
// tab's own task write (at once, since its echo never comes back). Reads of
// one count never overlap; one asked for meanwhile runs once the first ends.
// A count that can't be read draws no badge: it is a hint, so nothing is said.
//
// Plain TypeScript with no runtime imports, so it costs the first load little.
import type { TaskTotal } from '@crm/contracts';

/** Where a Tasks badge stands. */
export type DueTasksSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly count: number; readonly atLeast: boolean }
  | { readonly status: 'error' };

/** One workspace's Tasks badge on one date, held while a screen shows it (`useDueTasks`). */
export interface DueTasksSource {
  readonly retain: () => () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => DueTasksSnapshot;
}

/** Dependencies, passed in by the layer. */
export interface DueTasksDeps {
  readonly count: (workspace: string, today: string) => Promise<TaskTotal>;
}

interface Entry {
  readonly workspace: string;
  readonly today: string;
  readonly source: DueTasksSource;
  readonly listeners: Set<() => void>;
  snapshot: DueTasksSnapshot;
  holders: number;
  isReading: boolean;
  readAgain: boolean;
}

const LOADING: DueTasksSnapshot = { status: 'loading' };

/** The Tasks badges the layer holds: a source per workspace and date, and `changed` for a task change. */
export function createDueTasks(deps: DueTasksDeps) {
  const entries = new Map<string, Entry>();

  const publish = (entry: Entry, next: DueTasksSnapshot) => {
    const was = entry.snapshot;
    if (
      was.status === next.status &&
      (next.status !== 'ready' || (was.status === 'ready' && was.count === next.count && was.atLeast === next.atLeast))
    ) {
      return;
    }
    entry.snapshot = next;
    for (const listener of entry.listeners) listener();
  };

  const read = (entry: Entry) => {
    if (entry.isReading) {
      entry.readAgain = true;
      return;
    }
    entry.isReading = true;
    deps
      .count(entry.workspace, entry.today)
      .then(
        (total) => {
          publish(entry, { status: 'ready', count: total.count, atLeast: total.atLeast });
        },
        () => {
          // A count already shown stays until the next read; one never read draws nothing.
          if (entry.snapshot.status !== 'ready') publish(entry, { status: 'error' });
        },
      )
      .finally(() => {
        entry.isReading = false;
        if (!entry.readAgain || entry.holders === 0) {
          entry.readAgain = false;
          return;
        }
        entry.readAgain = false;
        read(entry);
      });
  };

  const entryOf = (workspace: string, today: string): Entry => {
    const key = `${workspace} ${today}`;
    const found = entries.get(key);
    if (found !== undefined) return found;
    const listeners = new Set<() => void>();
    const made: Entry = {
      workspace,
      today,
      listeners,
      snapshot: LOADING,
      holders: 0,
      isReading: false,
      readAgain: false,
      source: {
        retain: () => {
          made.holders += 1;
          // Each new holder reads: the count may have moved while nobody showed it.
          read(made);
          return () => {
            made.holders -= 1;
            if (made.holders === 0 && made.listeners.size === 0) entries.delete(key);
          };
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
            if (made.holders === 0 && listeners.size === 0) entries.delete(key);
          };
        },
        getSnapshot: () => made.snapshot,
      },
    };
    entries.set(key, made);
    return made;
  };

  return {
    /** The badge of `workspace` on `today` (the browser's local date). */
    source: (workspace: string, today: string): DueTasksSource => entryOf(workspace, today).source,
    /** Whether any screen shows a badge of `workspace`, so a task change is worth a read. */
    isHeld: (workspace: string): boolean =>
      [...entries.values()].some((entry) => entry.workspace === workspace && entry.holders > 0),
    /** Tasks changed in `workspace`: every held badge of it reads again. */
    changed: (workspace: string): void => {
      for (const entry of entries.values()) {
        if (entry.workspace === workspace && entry.holders > 0) read(entry);
      }
    },
    /** Signed out: forget every count. */
    clear: (): void => {
      entries.clear();
    },
  };
}

/** The layer's Tasks badges. */
export type DueTasks = ReturnType<typeof createDueTasks>;
