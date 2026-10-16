// `data.tasks` (spec 0019, milestone 1): tasks as screens see them, loaded
// lazily with the first screen that shows one. One copy of each task per
// workspace (a `TaskView` body), every list holding ids only:
//
// - a record's lists (`forRecord`: open, by due date; done, newest done
//   first) page through `tasks.list`, 50 at a time as they scroll, with the
//   open count for the tab's label;
// - `one` serves the task dialog from the same body.
//
// Writes are optimistic (spec 0005's layering rule, per task in order): each
// task keeps its confirmed base and its pending changes on top, so an answer
// replaces the base and drops its own layer (later ones stay), and a refusal
// drops only its layer. A create puts its body in at once and its id first,
// marked new, in every loaded open list of its linked records, kept there
// through a settle until it lands. A tick or a create refused raises a toast
// with Retry; a dialog field answers the refusal for the screen to show under
// it. A list settles (reads its loaded pages again) 1.5 seconds after the
// last change in it (`TASK_SETTLE_MS`), at most 5 seconds after the first,
// which is when a ticked task leaves an open list and a moved due date takes
// its place.
//
// Live: a `tasks` event reads the named bodies held again (gathered for a
// moment, `tasks.get` 100 a call; one named while its read is out is read
// again after it) and settles every loaded list of a record it names a random
// 0 to 2 seconds later; a coarse one rereads every body held and settles
// every list, spread. A `records` event rereads the tasks held that link a
// record it names (a rename, a trash, a restore) and settles the lists of
// records it names deleted or restored. Nothing polls.
import { TASK_GET_MAX, TASK_PAGE, TASK_PAGE_MAX } from '@crm/contracts/task-limits';
import type { ChangeEvent, RecordRefDisplay, TaskPage, TaskStatus, TaskTotal, TaskView } from '@crm/contracts';
import { refusalSummary, toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { LiveEventOf } from '../live/router.ts';
import type { Notice } from '../notice.ts';

/** How long a list waits after the last change in it before it reads its pages again (spec 0006's settle). */
export const TASK_SETTLE_MS = 1_500;

/** How long a list nobody shows keeps its ids before it lets them go. */
const UNUSED_MS = 30_000;

/** The words the store raises itself. */
export const TASK_WORDS = {
  retry: 'Retry',
  notTicked: 'The task wasn’t updated.',
  notCreated: 'The task wasn’t created.',
} as const;

/** The calls the tasks store makes, each mapped to a DataError by the layer. */
export interface TasksApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly status: TaskStatus;
    readonly cursor?: string;
    readonly limit?: number;
  }) => Promise<TaskPage>;
  readonly get: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
  }) => Promise<readonly TaskView[]>;
  readonly create: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly title: string;
    readonly dueOn?: string;
    readonly assigneeMemberId?: string;
    readonly recordIds?: readonly string[];
    readonly mutationId: string;
  }) => Promise<TaskView>;
  readonly update: (input: {
    readonly workspace: string;
    readonly taskId: string;
    readonly title?: string;
    readonly dueOn?: string | null;
    readonly assigneeMemberId?: string | null;
    readonly isDone?: boolean;
    readonly addRecordIds?: readonly string[];
    readonly removeRecordIds?: readonly string[];
    readonly mutationId: string;
  }) => Promise<TaskView>;
}

/** What the tasks store needs from the layer. */
export interface TasksDeps {
  readonly api: TasksApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events while a list or task is shown; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** Runs `work` once after a random 0 to 2 seconds, however often it is asked meanwhile (per `key`). */
  readonly spread: (key: string, work: () => void) => void;
  /**
   * A task changed on these records (a live event, or this tab's own write):
   * their open timelines read their first page again (spec 0017's feeds).
   */
  readonly timelines: (workspace: string, recordIds: readonly string[] | 'all') => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
  /** The clock, for an optimistic body's times. */
  readonly now?: () => number;
  /** The person's member id in the workspace, for an optimistic body's maker and who ticked it. */
  readonly memberOf?: (workspace: string) => Promise<string | undefined>;
  /** 0 to 1, for the spread of a settle a live event asked for (tests pass their own). */
  readonly random?: () => number;
}

/** What a task list shows now. */
export interface TaskListState {
  /** `loading` before the first page, `error` when it failed, `unavailable` for a record missing or hidden. */
  readonly status: 'loading' | 'ready' | 'error' | 'unavailable';
  /** The tasks in order, through the library's ListSource shape (rows past the loaded ones draw as skeletons). */
  readonly source: {
    readonly count: number;
    readonly getItem: (index: number) => TaskView | undefined;
    readonly getKey: (task: TaskView) => string;
    readonly onRangeChange: (range: { readonly start: number; readonly end: number }) => void;
  };
  /** How many the list holds in all (counted up to 10,000, `atLeast` past it), once the first page is in. */
  readonly total?: TaskTotal;
  /** Tasks this tab just made, shown first with the "New" badge until the list settles. */
  readonly newIds: ReadonlySet<string>;
  /** More pages wait past the loaded ones. */
  readonly hasMore: boolean;
  /** How many tasks are loaded (the rest of `source.count` draws as skeletons). */
  readonly loaded: number;
  readonly error?: DataError;
}

/** One list of tasks, as a screen holds it. */
export interface TaskList {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TaskListState;
  /** Holds the list (and listens to the workspace) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
  /** Settles once the first page is in (or failed). */
  readonly ready: () => Promise<void>;
  /** Reads it again from the top (Try again). */
  readonly retry: () => void;
  /** Reads the next page now (a list drawn in place pages by a button, not by scrolling). */
  readonly more: () => Promise<void>;
}

/** One task, as the task dialog holds it. */
export interface TaskSubscriptionState {
  /** `missing` when it doesn't exist, was deleted, or the reader can't see it. */
  readonly status: 'loading' | 'ready' | 'missing' | 'error';
  readonly task?: TaskView;
  readonly error?: DataError;
}

/** One task, subscribed. */
export interface TaskSubscription {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TaskSubscriptionState;
  readonly retain: () => () => void;
  readonly retry: () => void;
}

/** A new task, as a screen sends it: the id from `newId`, and the displays of its records and its maker. */
export interface NewTask {
  readonly id: string;
  readonly title: string;
  readonly dueOn?: string;
  readonly assigneeMemberId?: string;
  /** The records it links, in order, as they show (the page's record first). */
  readonly records?: readonly RecordRefDisplay[];
  /** The member making it, shown as its creator until the server answers. */
  readonly createdBy?: string;
}

/** A change to one task: only the fields given; `null` clears. Links by adding and removing. */
export interface TaskChange {
  readonly title?: string;
  readonly dueOn?: string | null;
  readonly assigneeMemberId?: string | null;
  readonly isDone?: boolean;
  readonly addRecords?: readonly RecordRefDisplay[];
  readonly removeRecordIds?: readonly string[];
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** The body a change shows at once. */
function applied(task: TaskView, change: TaskChange, now: string, me: string | undefined): TaskView {
  const removed = new Set(change.removeRecordIds ?? []);
  const kept = task.records.filter((record) => !removed.has(record.recordId));
  const held = new Set(kept.map((record) => record.recordId));
  const records = [...kept, ...(change.addRecords ?? []).filter((record) => !held.has(record.recordId))];
  const { dueOn: _due, assigneeMemberId: _assignee, doneAt: _doneAt, doneBy: _doneBy, ...rest } = task;
  const dueOn = change.dueOn === undefined ? task.dueOn : (change.dueOn ?? undefined);
  const assignee =
    change.assigneeMemberId === undefined ? task.assigneeMemberId : (change.assigneeMemberId ?? undefined);
  const isDone = change.isDone ?? task.isDone;
  const done = !isDone
    ? {}
    : task.isDone && task.doneAt !== undefined
      ? { doneAt: task.doneAt, ...(task.doneBy === undefined ? {} : { doneBy: task.doneBy }) }
      : { doneAt: now, ...(me === undefined ? {} : { doneBy: { type: 'member' as const, id: me } }) };
  return {
    ...rest,
    title: change.title ?? task.title,
    isDone,
    ...done,
    ...(dueOn === undefined ? {} : { dueOn }),
    ...(assignee === undefined ? {} : { assigneeMemberId: assignee }),
    records,
    recordCount: records.length,
    updatedAt: now,
  };
}

/** A pending change, layered over the task's confirmed body until its answer lands. */
interface Patch {
  readonly mutationId: string;
  readonly change: TaskChange;
  readonly at: string;
}

/** The longest a busy list waits to settle after its first change (spec 0006's `SETTLE_MAX_MS`). */
const SETTLE_MAX_MS = 5_000;

/** The most a list waits on top for a change someone else made, so a whole team doesn't read in step. */
const SETTLE_SPREAD_MS = 2_000;

/** How many times in a row a failed next page is tried again before it waits for a scroll or Retry. */
const MORE_TRIES = 5;

/** Whether two bodies say the same (bodies are plain JSON from the API or from `applied`). */
const sameBody = (a: TaskView | undefined, b: TaskView): boolean =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** The tasks store: every workspace's task bodies, the lists over them, and the writes. */
export function createTasksStore(deps: TasksDeps) {
  const later = deps.later ?? defaultLater;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  // Each task's confirmed body (the server's, or a create's own until it lands), per workspace.
  const bases = new Map<string, Map<string, TaskView>>();
  // What screens show: the base with the pending changes on top, one object per task while it says the same.
  const bodies = new Map<string, Map<string, TaskView>>();
  // The pending changes per task, in the order they were made.
  const patches = new Map<string, Patch[]>();
  // Tasks this tab is creating, per workspace: a settle keeps them in their lists until they land.
  const creating = new Map<string, Set<string>>();
  const lists = new Map<string, ReturnType<typeof makeList>>();
  const ones = new Map<string, ReturnType<typeof makeOne>>();
  // Each task's writes go out one after another, so the server applies them in the order they were made.
  const queues = new Map<string, Promise<unknown>>();
  // Reads by id: asked for this frame, out now, and asked again while out (read again when the read lands).
  const wanted = new Map<string, Set<string>>();
  const fetching = new Set<string>();
  const again = new Set<string>();
  // The person's member id per workspace, learnt when a list, a task or a write first names the workspace.
  const mine = new Map<string, string>();

  const mapOf = <V>(maps: Map<string, Map<string, V>>, workspace: string): Map<string, V> => {
    const found = maps.get(workspace);
    if (found !== undefined) return found;
    const made = new Map<string, V>();
    maps.set(workspace, made);
    return made;
  };
  const bodiesOf = (workspace: string) => mapOf(bodies, workspace);
  const basesOf = (workspace: string) => mapOf(bases, workspace);
  const creatingIn = (workspace: string): Set<string> => {
    const found = creating.get(workspace);
    if (found !== undefined) return found;
    const made = new Set<string>();
    creating.set(workspace, made);
    return made;
  };
  const keyOf = (workspace: string, id: string) => `${workspace}\u0000${id}`;
  const listsOf = (workspace: string) => [...lists.values()].filter((list) => list.workspace === workspace);
  const onesOf = (workspace: string) => [...ones.values()].filter((one) => one.workspace === workspace);
  const isBusy = (workspace: string, id: string) =>
    (patches.get(keyOf(workspace, id))?.length ?? 0) > 0 || creatingIn(workspace).has(id);

  const learnMe = (workspace: string) => {
    if (mine.has(workspace) || deps.memberOf === undefined) return;
    void deps.memberOf(workspace).then(
      (id) => {
        if (id !== undefined) mine.set(workspace, id);
      },
      () => undefined,
    );
  };

  /** Tells every list and subscription of the workspace holding `ids` that their bodies changed. */
  const touched = (workspace: string, ids: readonly string[]) => {
    if (ids.length === 0) return;
    const named = new Set(ids);
    for (const list of listsOf(workspace)) if (list.holdsAny(named)) list.announce();
    for (const one of onesOf(workspace)) if (named.has(one.taskId)) one.announce();
  };

  /** What a task shows: its base with its pending changes on top; the same object while it says the same. */
  const compose = (workspace: string, id: string): boolean => {
    const base = basesOf(workspace).get(id);
    const shown = bodiesOf(workspace);
    if (base === undefined) return shown.delete(id);
    const layered = (patches.get(keyOf(workspace, id)) ?? []).reduce(
      (body, patch) => applied(body, patch.change, patch.at, mine.get(workspace)),
      base,
    );
    if (sameBody(shown.get(id), layered)) return false;
    shown.set(id, layered);
    return true;
  };

  /** Puts bodies a read or a write answered in the store, as each task's confirmed base; pending changes stay on top. */
  const put = (workspace: string, tasks: readonly TaskView[]) => {
    const held = basesOf(workspace);
    const changed: string[] = [];
    for (const task of tasks) {
      if (!sameBody(held.get(task.id), task)) held.set(task.id, task);
      if (compose(workspace, task.id)) changed.push(task.id);
    }
    touched(workspace, changed);
  };

  /** A task gone (deleted, hidden, or never made): out of the store and every list. */
  const drop = (workspace: string, ids: readonly string[]) => {
    if (ids.length === 0) return;
    for (const id of ids) {
      basesOf(workspace).delete(id);
      bodiesOf(workspace).delete(id);
      patches.delete(keyOf(workspace, id));
    }
    const named = new Set(ids);
    for (const list of listsOf(workspace)) list.forget(named);
    for (const one of onesOf(workspace)) if (named.has(one.taskId)) one.announce();
  };

  /** Lets go of bodies no list or subscription holds and no write waits on. */
  const sweep = (workspace: string) => {
    const kept = new Set<string>();
    for (const list of listsOf(workspace)) for (const id of list.ids()) kept.add(id);
    for (const one of onesOf(workspace)) kept.add(one.taskId);
    for (const id of [...basesOf(workspace).keys()]) {
      if (kept.has(id) || isBusy(workspace, id)) continue;
      basesOf(workspace).delete(id);
      bodiesOf(workspace).delete(id);
    }
  };

  /** Reads what `refetch` gathered for the workspace, 100 a call; those the answer leaves out are gone. */
  const flush = (workspace: string) => {
    const asked = [...(wanted.get(workspace) ?? [])];
    wanted.delete(workspace);
    const ids: string[] = [];
    for (const id of asked) {
      const key = keyOf(workspace, id);
      // Out already: read again when that read lands, so an event during it is never lost.
      if (fetching.has(key)) again.add(key);
      else ids.push(id);
    }
    for (let start = 0; start < ids.length; start += TASK_GET_MAX) {
      const chunk = ids.slice(start, start + TASK_GET_MAX);
      for (const id of chunk) fetching.add(keyOf(workspace, id));
      deps.api
        .get({ workspace, ids: chunk })
        .then(
          (found) => {
            put(workspace, found);
            const answered = new Set(found.map((task) => task.id));
            drop(
              workspace,
              chunk.filter((id) => !answered.has(id) && !isBusy(workspace, id)),
            );
          },
          () => undefined,
        )
        .finally(() => {
          const more: string[] = [];
          for (const id of chunk) {
            const key = keyOf(workspace, id);
            fetching.delete(key);
            if (again.delete(key)) more.push(id);
          }
          if (more.length > 0) refetch(workspace, more);
        });
    }
  };

  /** Reads tasks again by id: a burst of events in one moment costs one call per 100 tasks. */
  const refetch = (workspace: string, ids: readonly string[]) => {
    if (ids.length === 0) return;
    const queued = wanted.get(workspace);
    if (queued !== undefined) {
      for (const id of ids) queued.add(id);
      return;
    }
    wanted.set(workspace, new Set(ids));
    later(() => {
      flush(workspace);
    }, 0);
  };

  function makeList(workspace: string, recordId: string, status: TaskStatus) {
    const key = `${workspace}\u0000${recordId}\u0000${status}`;
    let ids: string[] = [];
    let cursor: string | undefined;
    let total: TaskTotal | undefined;
    let state: TaskListState['status'] = 'loading';
    let error: DataError | undefined;
    let newIds: ReadonlySet<string> = new Set<string>();
    let first: Promise<void> | undefined;
    let loadingMore = false;
    let moreFailures = 0;
    let retained = 0;
    let release: (() => void) | undefined;
    let cancelSettle: (() => void) | undefined;
    let cancelUnused: (() => void) | undefined;
    // When the first change since the last settle came, so a busy list still settles within `SETTLE_MAX_MS`.
    let dirtySince: number | undefined;
    // A change came while nobody showed the list, or its ids were let go: it reads again when shown.
    let stale = false;
    // Each read's turn: an older answer landing after a newer one is dropped.
    let turn = 0;
    const listeners = new Set<() => void>();

    const sameTotal = (next: TaskTotal | undefined) =>
      next === undefined || (total !== undefined && total.count === next.count && total.atLeast === next.atLeast);

    const source = (): TaskListState['source'] => {
      const held = bodiesOf(workspace);
      const shown = ids;
      const count =
        cursor === undefined
          ? shown.length
          : Math.max(shown.length + 1, Math.min(total?.count ?? 0, shown.length + TASK_PAGE));
      return {
        count,
        getItem: (index) => {
          const id = shown[index];
          return id === undefined ? undefined : held.get(id);
        },
        getKey: (task) => task.id,
        onRangeChange: (range) => {
          if (range.end >= shown.length && cursor !== undefined && moreFailures < MORE_TRIES) void more();
        },
      };
    };
    let snapshot: TaskListState = {
      status: state,
      source: source(),
      newIds,
      hasMore: false,
      loaded: 0,
    };
    const announce = () => {
      snapshot = {
        status: state,
        source: source(),
        newIds,
        hasMore: cursor !== undefined,
        loaded: ids.length,
        ...(total === undefined ? {} : { total }),
        ...(error === undefined ? {} : { error }),
      };
      for (const listener of listeners) listener();
    };

    /** Reads the first `upTo` tasks again (at least one page): the list's truth from the top. */
    const readTop = (upTo: number): Promise<void> => {
      turn += 1;
      const mineTurn = turn;
      const run = async () => {
        const read: string[] = [];
        let next: string | undefined;
        let counted: TaskTotal | undefined;
        do {
          const limit = Math.min(TASK_PAGE_MAX, Math.max(TASK_PAGE, upTo - read.length));
          const page = await deps.api.list({
            workspace,
            recordId,
            status,
            limit,
            ...(next === undefined ? {} : { cursor: next }),
          });
          if (mineTurn !== turn) return;
          put(workspace, page.items);
          read.push(...page.items.map((task) => task.id).filter((id) => !read.includes(id)));
          counted ??= page.total;
          next = page.nextCursor;
        } while (next !== undefined && read.length < upTo);
        // Tasks this tab is still creating aren't in the answer yet: they stay first, still new, until they land.
        const pending = ids.filter((id) => creatingIn(workspace).has(id) && !read.includes(id));
        ids = [...pending, ...read];
        cursor = next;
        if (!sameTotal(counted) && counted !== undefined) {
          total = pending.length === 0 ? counted : { ...counted, count: counted.count + pending.length };
        }
        newIds = pending.length === 0 && newIds.size === 0 ? newIds : new Set(pending);
        state = 'ready';
        error = undefined;
        moreFailures = 0;
        announce();
        sweep(workspace);
      };
      return run().catch((failed: unknown) => {
        if (mineTurn !== turn) return;
        const failure = toDataError(failed);
        // A record missing, trashed or hidden: its tasks are absent.
        if (failure.code === 'NOT_FOUND') {
          state = 'unavailable';
          ids = [];
          cursor = undefined;
        } else if (state !== 'ready') {
          state = 'error';
        }
        error = failure;
        announce();
      });
    };

    const more = async () => {
      if (cursor === undefined || loadingMore || state !== 'ready') return;
      loadingMore = true;
      const from = cursor;
      const mineTurn = turn;
      try {
        const page = await deps.api.list({ workspace, recordId, status, cursor: from });
        if (mineTurn !== turn) return;
        put(workspace, page.items);
        const have = new Set(ids);
        ids = [...ids, ...page.items.map((task) => task.id).filter((id) => !have.has(id))];
        cursor = page.nextCursor;
        moreFailures = 0;
        announce();
      } catch (failed) {
        moreFailures += 1;
        // Said once; tried again on the next scroll, after a wait that doubles, at most `MORE_TRIES` times in a row.
        if (moreFailures === 1) deps.notify({ tone: 'danger', message: toDataError(failed).message });
      } finally {
        later(
          () => {
            loadingMore = false;
          },
          moreFailures === 0 ? 0 : Math.min(30_000, 1_000 * 2 ** (moreFailures - 1)),
        );
      }
    };

    const settle = () => {
      cancelSettle?.();
      cancelSettle = undefined;
      dirtySince = undefined;
      if (retained === 0) {
        stale = true;
        return;
      }
      void readTop(Math.max(ids.length, TASK_PAGE));
    };

    const list = {
      workspace,
      recordId,
      status,
      ids: () => ids,
      announce,
      holdsAny: (named: ReadonlySet<string>) => ids.some((id) => named.has(id)),
      /**
       * A change in the list: it settles `TASK_SETTLE_MS` after the last one,
       * at most `SETTLE_MAX_MS` after the first; a change someone else made
       * waits a random moment more, so a whole team doesn't read in step.
       */
      dirty(fromElsewhere = false) {
        if (first === undefined) return;
        const at = now();
        dirtySince ??= at;
        const quiet = Math.max(0, Math.min(TASK_SETTLE_MS, dirtySince + SETTLE_MAX_MS - at));
        cancelSettle?.();
        cancelSettle = later(settle, quiet + (fromElsewhere ? Math.round(random() * SETTLE_SPREAD_MS) : 0));
      },
      /** Settles now (a resync). */
      settleNow: settle,
      /** A task this tab made: first, marked new, until the list settles after it lands. */
      prepend(taskId: string) {
        if (state !== 'ready' || ids.includes(taskId)) return;
        ids = [taskId, ...ids];
        newIds = new Set([...newIds, taskId]);
        if (total !== undefined) total = { ...total, count: total.count + 1 };
        announce();
      },
      forget(named: ReadonlySet<string>) {
        if (!ids.some((id) => named.has(id))) return;
        const before = ids.length;
        ids = ids.filter((id) => !named.has(id));
        if (total !== undefined) total = { ...total, count: Math.max(0, total.count - (before - ids.length)) };
        announce();
      },
      api: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        retain() {
          retained += 1;
          cancelUnused?.();
          cancelUnused = undefined;
          // Let go of while a screen still held its handle (Back to a page whose loader ran again): back in the map.
          if (lists.get(key) !== list) lists.set(key, list);
          if (retained === 1) {
            release = deps.watch(workspace);
            // A screen showing it is reason enough to read it: its first page, or the pages it let go of.
            if (first === undefined) {
              first = readTop(TASK_PAGE);
            } else if (stale) {
              stale = false;
              void readTop(Math.max(ids.length, TASK_PAGE));
            }
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            retained -= 1;
            if (retained > 0) return;
            release?.();
            release = undefined;
            // Shown by nobody for a while: its ids go, and it reads afresh if a screen shows it again.
            cancelUnused = later(() => {
              if (lists.get(key) === list) lists.delete(key);
              stale = true;
              sweep(workspace);
            }, UNUSED_MS);
          };
        },
        ready: () => (first ??= readTop(TASK_PAGE)),
        more: () => {
          moreFailures = 0;
          return more();
        },
        retry: () => {
          state = ids.length === 0 ? 'loading' : state;
          announce();
          first = readTop(Math.max(ids.length, TASK_PAGE));
        },
      } satisfies TaskList,
    };
    return list;
  }

  function makeOne(workspace: string, taskId: string) {
    const key = keyOf(workspace, taskId);
    let state: TaskSubscriptionState['status'] = 'loading';
    let error: DataError | undefined;
    let retained = 0;
    let release: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const current = (): TaskSubscriptionState => {
      const task = bodiesOf(workspace).get(taskId);
      if (task !== undefined) return { status: 'ready', task };
      if (state === 'ready') return { status: 'missing' };
      return { status: state, ...(error === undefined ? {} : { error }) };
    };
    let snapshot = current();
    const read = () => {
      deps.api.get({ workspace, ids: [taskId] }).then(
        (found) => {
          put(workspace, found);
          state = found.length === 0 ? 'missing' : 'ready';
          error = undefined;
          one.announce();
        },
        (failed: unknown) => {
          state = 'error';
          error = toDataError(failed);
          one.announce();
        },
      );
    };
    const one = {
      workspace,
      taskId,
      announce() {
        const next = current();
        if (next.status === snapshot.status && next.task === snapshot.task && next.error === snapshot.error) return;
        snapshot = next;
        for (const listener of listeners) listener();
      },
      api: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        retain() {
          retained += 1;
          // Let go of by an earlier release (React's StrictMode retains, releases and retains again): back in the map.
          if (ones.get(key) !== one) ones.set(key, one);
          if (retained === 1) {
            release = deps.watch(workspace);
            if (bodiesOf(workspace).has(taskId)) state = 'ready';
            else read();
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            retained -= 1;
            if (retained > 0) return;
            release?.();
            release = undefined;
            if (ones.get(key) === one) ones.delete(key);
            sweep(workspace);
          };
        },
        retry: () => {
          state = 'loading';
          one.announce();
          read();
        },
      } satisfies TaskSubscription,
    };
    return one;
  }

  /** Runs one task's write after its earlier ones. */
  const queued = <T>(workspace: string, taskId: string, write: () => Promise<T>): Promise<T> => {
    const key = keyOf(workspace, taskId);
    const before = queues.get(key) ?? Promise.resolve();
    const run = before.then(write, write);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  };

  /** Every loaded list of these records (any status): a change in them settles them. */
  const dirtyRecords = (workspace: string, recordIds: readonly string[], fromElsewhere = false) => {
    const named = new Set(recordIds);
    for (const list of listsOf(workspace)) if (named.has(list.recordId)) list.dirty(fromElsewhere);
  };

  /** Sends one task change, layered over the task at once. Answers the refusal, if any. */
  const change = async (workspace: string, taskId: string, patch: TaskChange): Promise<DataError | undefined> => {
    learnMe(workspace);
    const key = keyOf(workspace, taskId);
    const before = bodiesOf(workspace).get(taskId);
    const mutationId = deps.mintId();
    patches.set(key, [...(patches.get(key) ?? []), { mutationId, change: patch, at: new Date(now()).toISOString() }]);
    if (compose(workspace, taskId)) touched(workspace, [taskId]);
    const settleOff = () => {
      const left = (patches.get(key) ?? []).filter((each) => each.mutationId !== mutationId);
      if (left.length === 0) patches.delete(key);
      else patches.set(key, left);
    };
    const linked = [
      ...(before?.records.map((record) => record.recordId) ?? []),
      ...(patch.addRecords?.map((record) => record.recordId) ?? []),
    ];
    // A tick moves the task out of its open list (or into it) only when the list settles.
    dirtyRecords(workspace, linked);
    try {
      const answer = await queued(workspace, taskId, () => {
        deps.mutations.sent(mutationId);
        return deps.api.update({
          workspace,
          taskId,
          mutationId,
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.dueOn === undefined ? {} : { dueOn: patch.dueOn }),
          ...(patch.assigneeMemberId === undefined ? {} : { assigneeMemberId: patch.assigneeMemberId }),
          ...(patch.isDone === undefined ? {} : { isDone: patch.isDone }),
          ...(patch.addRecords === undefined
            ? {}
            : { addRecordIds: patch.addRecords.map((record) => record.recordId) }),
          ...(patch.removeRecordIds === undefined ? {} : { removeRecordIds: patch.removeRecordIds }),
        });
      });
      deps.mutations.answered(mutationId, 1);
      // The answer is the base now, and this change's layer goes; later ones stay on top.
      settleOff();
      put(workspace, [answer]);
      dirtyRecords(workspace, [...linked, ...answer.records.map((record) => record.recordId)]);
      deps.timelines(workspace, linked);
      return undefined;
    } catch (failed) {
      deps.mutations.forget(mutationId);
      const failure = toDataError(failed);
      settleOff();
      if (failure.code === 'NOT_FOUND') drop(workspace, [taskId]);
      else if (compose(workspace, taskId)) touched(workspace, [taskId]);
      return failure;
    }
  };

  const create = async (workspace: string, task: NewTask): Promise<boolean> => {
    learnMe(workspace);
    const at = new Date(now()).toISOString();
    const records = task.records ?? [];
    const body: TaskView = {
      id: task.id,
      title: task.title.trim(),
      isDone: false,
      ...(task.dueOn === undefined ? {} : { dueOn: task.dueOn }),
      ...(task.assigneeMemberId === undefined ? {} : { assigneeMemberId: task.assigneeMemberId }),
      records: [...records],
      recordCount: records.length,
      canChange: true,
      createdAt: at,
      createdBy: { type: 'member', id: task.createdBy ?? mine.get(workspace) ?? null },
      updatedAt: at,
    };
    creatingIn(workspace).add(task.id);
    basesOf(workspace).set(task.id, body);
    compose(workspace, task.id);
    const recordIds = records.map((record) => record.recordId);
    for (const list of listsOf(workspace)) {
      if (list.status === 'open' && recordIds.includes(list.recordId)) list.prepend(task.id);
    }
    const mutationId = deps.mintId();
    try {
      const answer = await queued(workspace, task.id, () => {
        deps.mutations.sent(mutationId);
        return deps.api.create({
          workspace,
          id: task.id,
          title: task.title,
          mutationId,
          ...(task.dueOn === undefined ? {} : { dueOn: task.dueOn }),
          ...(task.assigneeMemberId === undefined ? {} : { assigneeMemberId: task.assigneeMemberId }),
          ...(recordIds.length === 0 ? {} : { recordIds }),
        });
      });
      deps.mutations.answered(mutationId, 1);
      creatingIn(workspace).delete(task.id);
      put(workspace, [answer]);
      dirtyRecords(workspace, recordIds);
      deps.timelines(workspace, recordIds);
      return true;
    } catch (failed) {
      deps.mutations.forget(mutationId);
      creatingIn(workspace).delete(task.id);
      drop(workspace, [task.id]);
      deps.notify({
        tone: 'danger',
        message: `${TASK_WORDS.notCreated} ${refusalSummary(toDataError(failed))}`,
        action: {
          label: TASK_WORDS.retry,
          onAction: () => {
            void create(workspace, task);
          },
        },
      });
      return false;
    }
  };

  const setDone = async (workspace: string, taskId: string, isDone: boolean): Promise<boolean> => {
    const failure = await change(workspace, taskId, { isDone });
    if (failure === undefined) return true;
    deps.notify({
      tone: 'danger',
      message: `${TASK_WORDS.notTicked} ${refusalSummary(failure)}`,
      action: {
        label: TASK_WORDS.retry,
        onAction: () => {
          void setDone(workspace, taskId, isDone);
        },
      },
    });
    return false;
  };

  return {
    /** A record's open or done tasks, the same list for every screen that asks. */
    forRecord(workspace: string, recordId: string, status: TaskStatus): TaskList {
      learnMe(workspace);
      const key = `${workspace}\u0000${recordId}\u0000${status}`;
      const found = lists.get(key);
      if (found !== undefined) return found.api;
      const made = makeList(workspace, recordId, status);
      lists.set(key, made);
      return made.api;
    },
    /** One task (the dialog), served from the store's body, read when the store doesn't hold it. */
    one(workspace: string, taskId: string): TaskSubscription {
      learnMe(workspace);
      const key = keyOf(workspace, taskId);
      const found = ones.get(key);
      if (found !== undefined) return found.api;
      const made = makeOne(workspace, taskId);
      ones.set(key, made);
      return made.api;
    },
    /** A new task id: mint it once when the dialog or quick add opens, and send the same one on a retry. */
    newId: () => deps.mintId(),
    /**
     * Creates a task (AC-432): its body at once, its id first and marked new
     * in every loaded open list of its records (kept there through a settle
     * until it lands). A refusal takes it away again and raises a toast with
     * Retry, which sends the same id. Answers whether it landed.
     */
    create: (workspace: string, task: NewTask): Promise<boolean> => create(workspace, task),
    /**
     * Changes a task from its dialog (AC-434): layered over the task at once,
     * the layer gone when its answer lands or is refused (which it answers,
     * for the screen to show under the field).
     */
    update: (workspace: string, taskId: string, patch: TaskChange): Promise<DataError | undefined> =>
      change(workspace, taskId, patch),
    /**
     * Ticks or unticks a task (AC-433): shown at once, staying in its open
     * list struck through until the list settles; a refusal rolls the
     * checkbox back and raises a toast with Retry.
     */
    setDone: (workspace: string, taskId: string, isDone: boolean): Promise<boolean> =>
      setDone(workspace, taskId, isDone),
    /**
     * A live `tasks` event: the named bodies held are read again (gathered,
     * one call per 100), and every loaded list of a record it names settles
     * a random moment later; a coarse one rereads every body held and settles
     * every list, spread.
     */
    changed(workspace: string, event: LiveEventOf<'tasks'>) {
      if (event.coarse === true) {
        deps.spread(`tasks ${workspace}`, () => {
          refetch(workspace, [...basesOf(workspace).keys()]);
          for (const list of listsOf(workspace)) list.dirty(true);
          deps.timelines(workspace, 'all');
        });
        return;
      }
      const held = basesOf(workspace);
      refetch(
        workspace,
        event.taskIds.filter((id) => held.has(id)),
      );
      dirtyRecords(workspace, event.recordIds, true);
      deps.timelines(workspace, event.recordIds);
    },
    /**
     * A live `records` event: the tasks held that link a record it names are
     * read again (a rename shows in their chips; a record trashed or restored
     * changes which links they show, AC-446), and the lists of records it
     * names as deleted or restored settle (a trashed record's list becomes
     * unavailable). A coarse one waits a random moment first, once.
     */
    recordsChanged(workspace: string, event: Extract<ChangeEvent, { kind: 'records' }>) {
      if (event.coarse === true) {
        deps.spread(`tasks records ${workspace}`, () => {
          refetch(workspace, [...basesOf(workspace).keys()]);
          for (const list of listsOf(workspace)) list.dirty(true);
        });
        return;
      }
      const named = new Set(event.recordIds);
      const linking = [...basesOf(workspace).values()]
        .filter((task) => task.records.some((record) => named.has(record.recordId)))
        .map((task) => task.id);
      refetch(workspace, linking);
      dirtyRecords(workspace, [...(event.deletedIds ?? []), ...(event.restoredIds ?? [])], true);
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      refetch(workspace, [...basesOf(workspace).keys()]);
      for (const list of listsOf(workspace)) list.settleNow();
    },
    /** Forgets everything: the session ended. */
    clear() {
      bases.clear();
      bodies.clear();
      patches.clear();
      creating.clear();
      lists.clear();
      ones.clear();
      queues.clear();
      wanted.clear();
      again.clear();
    },
  };
}

/** The tasks store. */
export type TasksStore = ReturnType<typeof createTasksStore>;
