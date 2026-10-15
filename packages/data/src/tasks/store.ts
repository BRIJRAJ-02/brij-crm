// `data.tasks` (spec 0019, milestone 1): tasks as screens see them, loaded
// lazily with the first screen that shows one. One copy of each task per
// workspace (a `TaskView` body), every list holding ids only:
//
// - a record's lists (`forRecord`: open, by due date; done, newest done
//   first) page through `tasks.list`, 50 at a time as they scroll, with the
//   open count for the tab's label;
// - `one` serves the task dialog from the same body.
//
// Writes are optimistic (spec 0005's layering rule, per task in order): a
// create puts its body in at once and its id first, marked new, in every
// loaded open list of its linked records; a change shows at once. A refusal
// puts back what was shown before, unless something newer landed meanwhile:
// a tick or a create raises a toast with Retry, a dialog field answers the
// refusal for the screen to show under it. A list settles (reads its loaded
// pages again) 1.5 seconds after the last change in it (`SETTLE_MS`), which
// is when a ticked task leaves an open list and a moved due date takes its
// place.
//
// Live: a `tasks` event reads the named bodies held again (`tasks.get`, 100
// a call) and marks dirty every loaded list of a record it names; a coarse
// one rereads every body held and marks every list dirty, spread over up to
// 2 seconds. A `records` event naming records deleted or restored rereads
// the tasks linking them and marks their lists dirty. Nothing polls.
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

/** The tasks store: every workspace's task bodies, the lists over them, and the writes. */
export function createTasksStore(deps: TasksDeps) {
  const later = deps.later ?? defaultLater;
  const now = deps.now ?? Date.now;
  // One copy of each task, per workspace.
  const bodies = new Map<string, Map<string, TaskView>>();
  const lists = new Map<string, ReturnType<typeof makeList>>();
  const ones = new Map<string, ReturnType<typeof makeOne>>();
  // Writes in flight per task: a read landing meanwhile never replaces what the screen shows.
  const inFlight = new Map<string, number>();
  // Each task's writes go out one after another, so the server applies them in the order they were made.
  const queues = new Map<string, Promise<unknown>>();
  const fetching = new Set<string>();

  const bodiesOf = (workspace: string): Map<string, TaskView> => {
    const found = bodies.get(workspace);
    if (found !== undefined) return found;
    const made = new Map<string, TaskView>();
    bodies.set(workspace, made);
    return made;
  };
  const keyOf = (workspace: string, id: string) => `${workspace}\u0000${id}`;
  const listsOf = (workspace: string) => [...lists.values()].filter((list) => list.workspace === workspace);
  const onesOf = (workspace: string) => [...ones.values()].filter((one) => one.workspace === workspace);

  /** Tells every list and subscription of the workspace holding `ids` that their bodies changed. */
  const touched = (workspace: string, ids: readonly string[]) => {
    const named = new Set(ids);
    for (const list of listsOf(workspace)) if (list.holdsAny(named)) list.announce();
    for (const one of onesOf(workspace)) if (named.has(one.taskId)) one.announce();
  };

  /** Puts bodies a read or a write answered in the store; a read never replaces a task with a write in flight. */
  const put = (workspace: string, tasks: readonly TaskView[], fromWrite = false) => {
    const held = bodiesOf(workspace);
    const changed: string[] = [];
    for (const task of tasks) {
      if (!fromWrite && (inFlight.get(keyOf(workspace, task.id)) ?? 0) > 0) continue;
      held.set(task.id, task);
      changed.push(task.id);
    }
    touched(workspace, changed);
  };

  /** A task gone (deleted, hidden, or never made): out of the store and every list. */
  const drop = (workspace: string, ids: readonly string[]) => {
    const held = bodiesOf(workspace);
    for (const id of ids) held.delete(id);
    const named = new Set(ids);
    for (const list of listsOf(workspace)) list.forget(named);
    for (const one of onesOf(workspace)) if (named.has(one.taskId)) one.announce();
  };

  /** Lets go of bodies no list or subscription holds. */
  const sweep = (workspace: string) => {
    const kept = new Set<string>();
    for (const list of listsOf(workspace)) for (const id of list.ids()) kept.add(id);
    for (const one of onesOf(workspace)) kept.add(one.taskId);
    const held = bodiesOf(workspace);
    for (const id of [...held.keys()]) {
      if (!kept.has(id) && (inFlight.get(keyOf(workspace, id)) ?? 0) === 0) held.delete(id);
    }
  };

  /** Reads tasks again by id, 100 a call; those the answer leaves out are gone. */
  const refetch = (workspace: string, ids: readonly string[]) => {
    const wanted = ids.filter((id) => !fetching.has(keyOf(workspace, id)));
    for (let start = 0; start < wanted.length; start += TASK_GET_MAX) {
      const chunk = wanted.slice(start, start + TASK_GET_MAX);
      for (const id of chunk) fetching.add(keyOf(workspace, id));
      deps.api
        .get({ workspace, ids: chunk })
        .then(
          (found) => {
            put(workspace, found);
            const answered = new Set(found.map((task) => task.id));
            drop(
              workspace,
              chunk.filter((id) => !answered.has(id) && (inFlight.get(keyOf(workspace, id)) ?? 0) === 0),
            );
          },
          () => undefined,
        )
        .finally(() => {
          for (const id of chunk) fetching.delete(keyOf(workspace, id));
        });
    }
  };

  function makeList(workspace: string, recordId: string, status: TaskStatus) {
    let ids: string[] = [];
    let cursor: string | undefined;
    let total: TaskTotal | undefined;
    let state: TaskListState['status'] = 'loading';
    let error: DataError | undefined;
    let newIds = new Set<string>();
    let first: Promise<void> | undefined;
    let loadingMore = false;
    let retained = 0;
    let release: (() => void) | undefined;
    let cancelSettle: (() => void) | undefined;
    let cancelUnused: (() => void) | undefined;
    // A change came while nobody showed the list: it settles when shown again.
    let stale = false;
    // Each read's turn: an older answer landing after a newer one is dropped.
    let turn = 0;
    const listeners = new Set<() => void>();

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
          if (range.end >= shown.length && cursor !== undefined) void more();
        },
      };
    };
    let snapshot: TaskListState = { status: state, source: source(), newIds };
    const announce = () => {
      snapshot = {
        status: state,
        source: source(),
        newIds,
        ...(total === undefined ? {} : { total }),
        ...(error === undefined ? {} : { error }),
      };
      for (const listener of listeners) listener();
    };

    /** Reads the first `upTo` tasks again (at least one page): the list's truth from the top. */
    const readTop = (upTo: number): Promise<void> => {
      turn += 1;
      const mine = turn;
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
          if (mine !== turn) return;
          put(workspace, page.items);
          read.push(...page.items.map((task) => task.id).filter((id) => !read.includes(id)));
          counted ??= page.total;
          next = page.nextCursor;
        } while (next !== undefined && read.length < upTo);
        ids = read;
        cursor = next;
        if (counted !== undefined) total = counted;
        newIds = new Set();
        state = 'ready';
        error = undefined;
        announce();
        sweep(workspace);
      };
      return run().catch((failed: unknown) => {
        if (mine !== turn) return;
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
      const mine = turn;
      try {
        const page = await deps.api.list({ workspace, recordId, status, cursor: from });
        if (mine !== turn) return;
        put(workspace, page.items);
        const have = new Set(ids);
        ids = [...ids, ...page.items.map((task) => task.id).filter((id) => !have.has(id))];
        cursor = page.nextCursor;
        announce();
      } catch (failed) {
        deps.notify({ tone: 'danger', message: toDataError(failed).message });
      } finally {
        loadingMore = false;
      }
    };

    const settle = () => {
      cancelSettle?.();
      cancelSettle = undefined;
      if (retained === 0) {
        stale = true;
        return;
      }
      void readTop(Math.max(ids.length, TASK_PAGE));
    };

    return {
      workspace,
      recordId,
      status,
      ids: () => ids,
      announce,
      isLoaded: () => state === 'ready',
      isRetained: () => retained > 0,
      holdsAny: (named: ReadonlySet<string>) => ids.some((id) => named.has(id)),
      /** A change in the list: it settles `TASK_SETTLE_MS` after the last one. */
      dirty() {
        if (state === 'loading' && first === undefined) return;
        cancelSettle?.();
        cancelSettle = later(settle, TASK_SETTLE_MS);
      },
      /** Settles now (a resync, or a record trashed or restored). */
      settleNow: settle,
      /** A task this tab made: first, marked new, until the list settles. */
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
          if (retained === 1) {
            release = deps.watch(workspace);
            if (stale) {
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
            // Shown by nobody for a while: its ids go, and the next screen reads it afresh.
            cancelUnused = later(() => {
              lists.delete(`${workspace}\u0000${recordId}\u0000${status}`);
              sweep(workspace);
            }, UNUSED_MS);
          };
        },
        ready: () => (first ??= readTop(TASK_PAGE)),
        retry: () => {
          state = ids.length === 0 ? 'loading' : state;
          announce();
          first = readTop(Math.max(ids.length, TASK_PAGE));
        },
      } satisfies TaskList,
    };
  }

  function makeOne(workspace: string, taskId: string) {
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
            ones.delete(keyOf(workspace, taskId));
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

  /** Runs one task's write after its earlier ones, counting it in flight meanwhile. */
  const queued = <T>(workspace: string, taskId: string, write: () => Promise<T>): Promise<T> => {
    const key = keyOf(workspace, taskId);
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
    const before = queues.get(key) ?? Promise.resolve();
    const run = before.then(write, write);
    const settled = run.finally(() => {
      const left = (inFlight.get(key) ?? 1) - 1;
      if (left === 0) inFlight.delete(key);
      else inFlight.set(key, left);
      if (queues.get(key) === settled) queues.delete(key);
    });
    queues.set(
      key,
      settled.catch(() => undefined),
    );
    return run;
  };

  /** Every loaded list of these records (any status): a change in them settles them. */
  const dirtyRecords = (workspace: string, recordIds: readonly string[]) => {
    const named = new Set(recordIds);
    for (const list of listsOf(workspace)) if (named.has(list.recordId)) list.dirty();
  };

  // The person's member id per workspace, learnt when a list, a task or a write first names the workspace.
  const mine = new Map<string, string>();
  const learnMe = (workspace: string) => {
    if (mine.has(workspace) || deps.memberOf === undefined) return;
    void deps.memberOf(workspace).then(
      (id) => {
        if (id !== undefined) mine.set(workspace, id);
      },
      () => undefined,
    );
  };

  /** Sends one task change; the screen shows it at once. Answers the refusal, if any. */
  const change = async (workspace: string, taskId: string, patch: TaskChange): Promise<DataError | undefined> => {
    const held = bodiesOf(workspace);
    const before = held.get(taskId);
    const shown =
      before === undefined ? undefined : applied(before, patch, new Date(now()).toISOString(), mine.get(workspace));
    if (shown !== undefined) {
      held.set(taskId, shown);
      touched(workspace, [taskId]);
    }
    const linked = [
      ...(before?.records.map((record) => record.recordId) ?? []),
      ...(patch.addRecords?.map((record) => record.recordId) ?? []),
    ];
    // A tick moves the task out of its open list (or into it) only when the list settles.
    dirtyRecords(workspace, linked);
    const mutationId = deps.mintId();
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
      put(workspace, [answer], true);
      dirtyRecords(workspace, [...linked, ...answer.records.map((record) => record.recordId)]);
      deps.timelines(workspace, linked);
      return undefined;
    } catch (failed) {
      deps.mutations.forget(mutationId);
      const failure = toDataError(failed);
      if (failure.code === 'NOT_FOUND') {
        drop(workspace, [taskId]);
      } else if (before !== undefined && held.get(taskId) === shown) {
        held.set(taskId, before);
        touched(workspace, [taskId]);
      }
      return failure;
    }
  };

  /**
   * Creates a task (AC-432): its body at once, its id first and marked new
   * in every loaded open list of its records. A refusal takes it away again
   * and raises a toast with Retry (which sends the same id). Answers whether
   * it landed.
   */
  const create = async (workspace: string, task: NewTask): Promise<boolean> => {
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
    bodiesOf(workspace).set(task.id, body);
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
      put(workspace, [answer], true);
      dirtyRecords(workspace, recordIds);
      deps.timelines(workspace, recordIds);
      return true;
    } catch (failed) {
      deps.mutations.forget(mutationId);
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

  /**
   * Ticks or unticks a task (AC-433): shown at once, staying in its open
   * list struck through until the list settles; a refusal rolls the
   * checkbox back and raises a toast with Retry.
   */
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
    create: (workspace: string, task: NewTask): Promise<boolean> => create(workspace, task),
    /**
     * Changes a task from its dialog (AC-434): shown at once, put back on a
     * refusal, which it answers for the screen to show under the field.
     */
    update: (workspace: string, taskId: string, patch: TaskChange): Promise<DataError | undefined> =>
      change(workspace, taskId, patch),
    setDone: (workspace: string, taskId: string, isDone: boolean): Promise<boolean> =>
      setDone(workspace, taskId, isDone),
    /**
     * A live `tasks` event: the named bodies held are read again, and every
     * loaded list of a record it names settles; a coarse one rereads every
     * body held and settles every list, spread.
     */
    changed(workspace: string, event: LiveEventOf<'tasks'>) {
      if (event.coarse === true) {
        deps.spread(`tasks ${workspace}`, () => {
          refetch(workspace, [...bodiesOf(workspace).keys()]);
          for (const list of listsOf(workspace)) list.dirty();
          deps.timelines(workspace, 'all');
        });
        return;
      }
      const held = bodiesOf(workspace);
      refetch(
        workspace,
        event.taskIds.filter((id) => held.has(id)),
      );
      dirtyRecords(workspace, event.recordIds);
      deps.timelines(workspace, event.recordIds);
    },
    /**
     * A live `records` event (AC-446): records deleted or restored change
     * which links their tasks show, so the tasks held that link them are read
     * again, and those records' own lists settle (a trashed record's list
     * becomes unavailable).
     */
    recordsChanged(workspace: string, event: Extract<ChangeEvent, { kind: 'records' }>) {
      const lifecycle = [...(event.deletedIds ?? []), ...(event.restoredIds ?? [])];
      if (lifecycle.length === 0 && event.coarse !== true) return;
      const named = new Set(lifecycle);
      const held = [...bodiesOf(workspace).values()];
      const linking =
        event.coarse === true
          ? held.map((task) => task.id)
          : held.filter((task) => task.records.some((record) => named.has(record.recordId))).map((task) => task.id);
      refetch(workspace, linking);
      for (const list of listsOf(workspace)) {
        if (named.has(list.recordId) || event.coarse === true) list.dirty();
      }
    },
    /** Everything held of the workspace is read again (a resync after a gap the outbox no longer covers). */
    resync(workspace: string) {
      refetch(workspace, [...bodiesOf(workspace).keys()]);
      for (const list of listsOf(workspace)) list.settleNow();
    },
    /** Forgets everything: the session ended. */
    clear() {
      bodies.clear();
      lists.clear();
      ones.clear();
      inFlight.clear();
      queues.clear();
    },
  };
}

/** The tasks store. */
export type TasksStore = ReturnType<typeof createTasksStore>;
