// The sidebar's Tasks badge (spec 0034, AC-924): how many of my open tasks
// are overdue or due today, by my local date. One count per workspace and
// date, read while a screen holds it and read again when tasks change: a
// `tasks` event or a resync (`changedLater`: the event names no assignee, so
// every badge in the workspace hears it; it reads at most once per
// `DUE_EVENT_MS` and a random moment more, so a busy team costs each member a
// read every few seconds at most) or this tab's own task write (`changed`, at
// once, since its echo never comes back). Reads of
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
  /** Defaults to the browser's; tests pass their own. */
  readonly setTimeout?: (run: () => void, ms: number) => void;
  readonly random?: () => number;
}

/** The least time between two reads of a badge for other people's task changes. */
export const DUE_EVENT_MS = 5_000;
/** The most a read for other people's task changes waits on top, at random, so a team doesn't read in step. */
export const DUE_SPREAD_MS = 2_000;

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
  const schedule = deps.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const random = deps.random ?? Math.random;
  /** Workspaces with a read for other people's changes waiting. */
  const waiting = new Set<string>();

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
          // Each new holder reads: the count may have moved while nobody showed it. A read already out is that
          // read (two badges taking a new day at once ask once).
          if (!made.isReading) read(made);
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

  const isHeld = (workspace: string): boolean =>
    [...entries.values()].some((entry) => entry.workspace === workspace && entry.holders > 0);
  const readHeld = (workspace: string) => {
    for (const entry of entries.values()) {
      if (entry.workspace === workspace && entry.holders > 0) read(entry);
    }
  };

  return {
    /** The badge of `workspace` on `today` (the browser's local date). */
    source: (workspace: string, today: string): DueTasksSource => entryOf(workspace, today).source,

    /** This tab changed tasks in `workspace`: every held badge of it reads again at once. */
    changed: (workspace: string): void => {
      readHeld(workspace);
    },
    /** Someone changed tasks in `workspace` (or it resynced): its held badges read again, coalesced and spread. */
    changedLater: (workspace: string): void => {
      if (waiting.has(workspace) || !isHeld(workspace)) return;
      waiting.add(workspace);
      schedule(
        () => {
          waiting.delete(workspace);
          readHeld(workspace);
        },
        DUE_EVENT_MS + Math.round(random() * DUE_SPREAD_MS),
      );
    },
    /** Signed out: forget every count; a badge still on screen shows nothing until it reads again. */
    clear: (): void => {
      waiting.clear();
      for (const [key, entry] of entries) {
        if (entry.holders === 0) entries.delete(key);
        else publish(entry, LOADING);
      }
    },
  };
}

/** The layer's Tasks badges. */
export type DueTasks = ReturnType<typeof createDueTasks>;
