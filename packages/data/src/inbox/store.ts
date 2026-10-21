// `data.inbox` (spec 0038), loaded lazily with the inbox or the notification
// settings: the member's own notifications as screens see them, and their
// email settings. Two parts:
//
// - a list per tab and filter (`list`): Inbox (not done) or Done, a kind,
//   unread only; 50 at a time as it scrolls. A mark (read, unread, done, back
//   to the inbox, mark all as read) shows at once in every held list and the
//   unread count, and a refusal puts it back with a toast. A `notifications`
//   event naming the member (another tab, another device, a new one) reads the
//   held lists again, at most every 250 ms, as far as they had loaded.
// - the settings (`settings`): read while held, each switch saved at once and
//   put back with a toast on a refusal, read again on the same event.
//
// The data is the member's own only: the server answers nothing else, and the
// notifications it leaves out (hidden from them now) are simply absent.
import type {
  ChangeEvent,
  NotificationKind,
  NotificationPage,
  NotificationSettings,
  NotificationStatus,
  NotificationView,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';

/** How long a burst of events waits before the held lists read again. */
export const INBOX_REREAD_MS = 250;

/** How long a list nobody shows keeps its rows before it lets go. */
const UNUSED_MS = 30_000;

/** The words the store raises itself. */
export const INBOX_WORDS = {
  markFailed: 'That change to your inbox wasn’t saved.',
  settingsFailed: 'Your notification settings weren’t saved.',
} as const;

/** The calls the inbox makes, each mapped to a DataError by the layer. */
export interface InboxApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly status: NotificationStatus;
    readonly kind?: NotificationKind;
    readonly unreadOnly?: boolean;
    readonly cursor?: string;
  }) => Promise<NotificationPage>;
  readonly mark: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
    readonly read?: boolean;
    readonly done?: boolean;
    readonly mutationId: string;
  }) => Promise<{ readonly changed: number }>;
  readonly markAllRead: (input: {
    readonly workspace: string;
    readonly status: NotificationStatus;
    readonly kind?: NotificationKind;
    readonly mutationId: string;
  }) => Promise<{ readonly changed: number }>;
  readonly settings: (input: { readonly workspace: string }) => Promise<NotificationSettings>;
  readonly setSettings: (
    input: { readonly workspace: string; readonly mutationId: string } & NotificationSettingsChange,
  ) => Promise<NotificationSettings>;
}

/** Some of the email switches, and the browser's time zone with the digest. */
export interface NotificationSettingsChange {
  readonly emailMentions?: boolean;
  readonly emailReplies?: boolean;
  readonly emailAssignments?: boolean;
  readonly digest?: boolean;
  readonly timeZone?: string;
}

/** What the inbox needs from the layer. */
export interface InboxDeps {
  readonly api: InboxApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events while a list is shown; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** The unread count: moved at once by a mark, read again after it. */
  readonly unread: {
    readonly adjust: (workspace: string, delta: number) => void;
    readonly refresh: (workspace: string) => void;
  };
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
}

/** Which notifications a list shows. */
export interface InboxFilter {
  readonly status: NotificationStatus;
  readonly kind?: NotificationKind;
  readonly unreadOnly?: boolean;
}

/** What an inbox list shows now. */
export interface InboxListState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly items: readonly NotificationView[];
  /** More past the last item: the screen asks for them as it nears the end. */
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly error?: DataError;
}

/** One tab and filter of the inbox, as a screen holds it. */
export interface InboxList {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => InboxListState;
  /** Holds the list (and listens to the workspace) while a screen shows it; the answer lets go. */
  readonly retain: () => () => void;
  /** Loads the next 50 (as the screen nears the end). */
  readonly loadMore: () => void;
  /** Reads it again from the top (Try again). */
  readonly retry: () => void;
}

/** The member's settings, as the settings page holds them. */
export interface InboxSettingsState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly settings?: NotificationSettings;
  readonly error?: DataError;
}

/** The settings source a page reads. */
export interface InboxSettings {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => InboxSettingsState;
  readonly retain: () => () => void;
  readonly retry: () => void;
}

/** A mark of some notifications. */
export interface InboxMark {
  readonly read?: boolean;
  readonly done?: boolean;
}

/** The inbox's store. */
export interface InboxStore {
  readonly list: (workspace: string, filter: InboxFilter) => InboxList;
  /** Marks notifications at once everywhere they show; answers the refusal, if any (already put back). */
  readonly mark: (workspace: string, ids: readonly string[], mark: InboxMark) => Promise<DataError | undefined>;
  /** Marks every unread one of a tab (and kind) read. */
  readonly markAllRead: (
    workspace: string,
    status: NotificationStatus,
    kind?: NotificationKind,
  ) => Promise<DataError | undefined>;
  readonly settings: (workspace: string) => InboxSettings;
  /** Saves some switches at once; answers the refusal, if any (already put back, with a toast). */
  readonly setSettings: (workspace: string, change: NotificationSettingsChange) => Promise<DataError | undefined>;
  /** A live `notifications` event that names the member: everything held of the workspace reads again. */
  readonly changed: (workspace: string, event: Extract<ChangeEvent, { kind: 'notifications' }>) => void;
  /** Reads everything held of the workspace again (a resync, records trashed or restored). */
  readonly resync: (workspace: string) => void;
  /** Forgets everything (signed out). */
  readonly clear: () => void;
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** The key a filter's list is held under. */
const keyOf = (workspace: string, filter: InboxFilter) =>
  `${workspace} ${filter.status} ${filter.kind ?? 'all'} ${filter.unreadOnly === true ? 'unread' : 'any'}`;

interface HeldList {
  readonly workspace: string;
  readonly filter: InboxFilter;
  readonly list: InboxList;
  state: InboxListState;
  cursor?: string;
  holders: number;
  /** A read under way: its generation, so a later reread wins. */
  generation: number;
  stale: boolean;
  stopWatch?: () => void;
  cancelDrop?: () => void;
  readonly listeners: Set<() => void>;
}

interface HeldSettings {
  readonly workspace: string;
  readonly source: InboxSettings;
  state: InboxSettingsState;
  holders: number;
  generation: number;
  /** Writes out: a reread waits, so it never shows a switch going back. */
  writing: number;
  stopWatch?: () => void;
  readonly listeners: Set<() => void>;
}

/** Whether a notification belongs in a list's filter. */
function matches(item: NotificationView, filter: InboxFilter): boolean {
  if ((filter.status === 'done') !== (item.doneAt !== undefined)) return false;
  if (filter.kind !== undefined && item.kind !== filter.kind) return false;
  if (filter.unreadOnly === true && item.readAt !== undefined) return false;
  return true;
}

/** A notification with a mark applied, as the server will store it. */
function applied(item: NotificationView, mark: InboxMark, at: string): NotificationView {
  const { readAt: _readAt, doneAt: _doneAt, ...rest } = item;
  const read = mark.done === true ? true : (mark.read ?? item.readAt !== undefined);
  const done = mark.done ?? item.doneAt !== undefined;
  return {
    ...rest,
    ...(read ? { readAt: item.readAt ?? at } : {}),
    ...(done ? { doneAt: item.doneAt ?? at } : {}),
  };
}

/** A new inbox store. */
export function createInboxStore(deps: InboxDeps): InboxStore {
  const later = deps.later ?? defaultLater;
  let lists = new Map<string, HeldList>();
  let settings = new Map<string, HeldSettings>();
  const pendingReread = new Map<string, () => void>();

  const announce = (held: { readonly listeners: Set<() => void> }) => {
    for (const listener of held.listeners) listener();
  };

  const listsOf = (workspace: string) => [...lists.values()].filter((held) => held.workspace === workspace);

  /** Reads a list from the top, as far as it had loaded (at least one page). */
  const read = (held: HeldList, from: 'top' | 'more') => {
    held.generation += 1;
    const generation = held.generation;
    const wanted = from === 'top' ? Math.max(held.state.items.length, 1) : 0;
    const items: NotificationView[] = from === 'more' ? [...held.state.items] : [];
    let cursor = from === 'more' ? held.cursor : undefined;
    if (from === 'more') {
      held.state = { ...held.state, isLoadingMore: true };
      announce(held);
    }
    const step = (): Promise<void> =>
      deps.api
        .list({
          workspace: held.workspace,
          status: held.filter.status,
          ...(held.filter.kind === undefined ? {} : { kind: held.filter.kind }),
          ...(held.filter.unreadOnly === true ? { unreadOnly: true } : {}),
          ...(cursor === undefined ? {} : { cursor }),
        })
        .then((page) => {
          if (held.generation !== generation) return;
          items.push(...page.items);
          cursor = page.nextCursor;
          if (from === 'top' && cursor !== undefined && items.length < wanted) return step();
          return undefined;
        });
    step().then(
      () => {
        if (held.generation !== generation) return;
        held.cursor = cursor;
        held.stale = false;
        held.state = { status: 'ready', items, hasMore: cursor !== undefined, isLoadingMore: false };
        announce(held);
      },
      (failed: unknown) => {
        if (held.generation !== generation) return;
        const error = toDataError(failed);
        // A failed next page keeps what shows; a failed first read shows the error state.
        held.state =
          held.state.status === 'ready'
            ? { ...held.state, isLoadingMore: false }
            : { status: 'error', items: [], hasMore: false, isLoadingMore: false, error };
        announce(held);
      },
    );
  };

  const listOf = (workspace: string, filter: InboxFilter): HeldList => {
    const key = keyOf(workspace, filter);
    const existing = lists.get(key);
    if (existing !== undefined) return existing;
    const listeners = new Set<() => void>();
    const held: HeldList = {
      workspace,
      filter,
      holders: 0,
      generation: 0,
      stale: true,
      listeners,
      state: { status: 'loading', items: [], hasMore: false, isLoadingMore: false },
      list: {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => held.state,
        retain() {
          held.holders += 1;
          held.cancelDrop?.();
          held.cancelDrop = undefined;
          if (held.holders === 1) {
            held.stopWatch = deps.watch(workspace);
            // Shown again after a while away: the rows show at once and are read again behind them.
            if (held.stale || held.state.status !== 'ready') read(held, 'top');
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            held.holders -= 1;
            if (held.holders > 0) return;
            held.stopWatch?.();
            held.stopWatch = undefined;
            held.stale = true;
            held.cancelDrop = later(() => {
              if (held.holders === 0 && lists.get(key) === held) lists.delete(key);
            }, UNUSED_MS);
          };
        },
        loadMore() {
          if (held.state.status !== 'ready' || !held.state.hasMore || held.state.isLoadingMore) return;
          read(held, 'more');
        },
        retry() {
          held.state = { status: 'loading', items: [], hasMore: false, isLoadingMore: false };
          announce(held);
          read(held, 'top');
        },
      },
    };
    lists.set(key, held);
    return held;
  };

  /** Every held list of the workspace reads again soon; one nobody shows is marked stale. */
  const reread = (workspace: string) => {
    if (pendingReread.has(workspace)) return;
    const cancel = later(() => {
      pendingReread.delete(workspace);
      for (const held of listsOf(workspace)) {
        if (held.holders > 0) read(held, 'top');
        else held.stale = true;
      }
      for (const held of settings.values()) {
        if (held.workspace === workspace && held.holders > 0 && held.writing === 0) readSettings(held);
      }
    }, INBOX_REREAD_MS);
    pendingReread.set(workspace, cancel);
  };

  /** Shows a change to some notifications in every held list of the workspace: kept, moved or left out. */
  const show = (workspace: string, change: (item: NotificationView) => NotificationView | undefined) => {
    for (const held of listsOf(workspace)) {
      if (held.state.status !== 'ready') continue;
      const before = held.state.items;
      const items = before.flatMap((item) => {
        const next = change(item);
        if (next === undefined || next === item) return [item];
        return matches(next, held.filter) ? [next] : [];
      });
      // One that now belongs in a list it wasn't in (back to the inbox, unread again) comes with the reread.
      if (items.length !== before.length || items.some((item, index) => item !== before[index])) {
        held.state = { ...held.state, items };
        announce(held);
      }
    }
  };

  /** What every held list of the workspace shows now, to put back on a refusal. */
  const snapshot = (workspace: string) => {
    const taken = listsOf(workspace).map((held) => ({ held, state: held.state }));
    return () => {
      for (const { held, state } of taken) {
        held.state = state;
        announce(held);
      }
    };
  };

  /** Every held item of the workspace with one of these ids, by id. */
  const heldItems = (workspace: string, ids: ReadonlySet<string>) => {
    const found = new Map<string, NotificationView>();
    for (const held of listsOf(workspace)) {
      for (const item of held.state.items) if (ids.has(item.id)) found.set(item.id, item);
    }
    return found;
  };

  const readSettings = (held: HeldSettings) => {
    held.generation += 1;
    const generation = held.generation;
    deps.api.settings({ workspace: held.workspace }).then(
      (answer) => {
        if (held.generation !== generation) return;
        held.state = { status: 'ready', settings: answer };
        announce(held);
      },
      (failed: unknown) => {
        if (held.generation !== generation) return;
        held.state = held.state.settings === undefined ? { status: 'error', error: toDataError(failed) } : held.state;
        announce(held);
      },
    );
  };

  const settingsOf = (workspace: string): HeldSettings => {
    const existing = settings.get(workspace);
    if (existing !== undefined) return existing;
    const listeners = new Set<() => void>();
    const held: HeldSettings = {
      workspace,
      holders: 0,
      generation: 0,
      writing: 0,
      listeners,
      state: { status: 'loading' },
      source: {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => held.state,
        retain() {
          held.holders += 1;
          if (held.holders === 1) {
            held.stopWatch = deps.watch(workspace);
            readSettings(held);
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            held.holders -= 1;
            if (held.holders > 0) return;
            held.stopWatch?.();
            held.stopWatch = undefined;
          };
        },
        retry() {
          held.state = { status: 'loading' };
          announce(held);
          readSettings(held);
        },
      },
    };
    settings.set(workspace, held);
    return held;
  };

  return {
    list: (workspace, filter) => listOf(workspace, filter).list,

    async mark(workspace, ids, mark) {
      if (ids.length === 0) return undefined;
      const wanted = new Set(ids);
      const before = heldItems(workspace, wanted);
      const at = new Date().toISOString();
      // The unread count moves by the shown ones that change read state.
      let delta = 0;
      for (const item of before.values()) {
        const next = applied(item, mark, at);
        const wasUnread = item.readAt === undefined && item.doneAt === undefined;
        const isUnread = next.readAt === undefined && next.doneAt === undefined;
        if (wasUnread !== isUnread) delta += isUnread ? 1 : -1;
      }
      const putBack = snapshot(workspace);
      show(workspace, (item) => (wanted.has(item.id) ? applied(item, mark, at) : item));
      deps.unread.adjust(workspace, delta);
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const answer = await deps.api.mark({ workspace, ids: [...wanted], ...mark, mutationId });
        deps.mutations.answered(mutationId, answer.changed > 0 ? 1 : 0);
        // A list it now belongs in (Done after Mark done, the inbox after Move to inbox) reads it in.
        if (mark.done !== undefined || mark.read === false) reread(workspace);
        deps.unread.refresh(workspace);
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        const error = toDataError(failed);
        putBack();
        deps.unread.adjust(workspace, -delta);
        reread(workspace);
        deps.unread.refresh(workspace);
        deps.notify({ tone: 'danger', message: `${INBOX_WORDS.markFailed} ${error.message}` });
        return error;
      }
    },

    async markAllRead(workspace, status, kind) {
      const at = new Date().toISOString();
      const touched = new Map<string, NotificationView>();
      for (const held of listsOf(workspace)) {
        for (const item of held.state.items) {
          const inScope =
            (status === 'done') === (item.doneAt !== undefined) && (kind === undefined || item.kind === kind);
          if (inScope && item.readAt === undefined) touched.set(item.id, item);
        }
      }
      const putBack = snapshot(workspace);
      show(workspace, (item) => (touched.has(item.id) ? applied(item, { read: true }, at) : item));
      const delta = status === 'inbox' ? -touched.size : 0;
      deps.unread.adjust(workspace, delta);
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const answer = await deps.api.markAllRead({
          workspace,
          status,
          ...(kind === undefined ? {} : { kind }),
          mutationId,
        });
        deps.mutations.answered(mutationId, answer.changed > 0 ? 1 : 0);
        reread(workspace);
        deps.unread.refresh(workspace);
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        const error = toDataError(failed);
        putBack();
        deps.unread.adjust(workspace, -delta);
        reread(workspace);
        deps.unread.refresh(workspace);
        deps.notify({ tone: 'danger', message: `${INBOX_WORDS.markFailed} ${error.message}` });
        return error;
      }
    },

    settings: (workspace) => settingsOf(workspace).source,

    async setSettings(workspace, change) {
      const held = settingsOf(workspace);
      const before = held.state.settings;
      if (before !== undefined) {
        const { timeZone: _zone, ...switches } = change;
        held.state = {
          status: 'ready',
          settings: { ...before, ...switches, ...(change.timeZone === undefined ? {} : { timeZone: change.timeZone }) },
        };
        announce(held);
      }
      held.writing += 1;
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const answer = await deps.api.setSettings({ workspace, mutationId, ...change });
        deps.mutations.answered(mutationId, 1);
        held.writing -= 1;
        // Each answer is the whole row: the newest one shows once no other write is out.
        if (held.writing === 0) {
          held.generation += 1;
          held.state = { status: 'ready', settings: answer };
          announce(held);
        }
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        held.writing -= 1;
        const error = toDataError(failed);
        if (before !== undefined) {
          held.state = { status: 'ready', settings: before };
          announce(held);
        }
        if (held.holders > 0) readSettings(held);
        deps.notify({ tone: 'danger', message: `${INBOX_WORDS.settingsFailed} ${error.message}` });
        return error;
      }
    },

    changed(workspace) {
      reread(workspace);
    },

    resync(workspace) {
      reread(workspace);
    },

    clear() {
      for (const cancel of pendingReread.values()) cancel();
      pendingReread.clear();
      for (const held of lists.values()) {
        held.cancelDrop?.();
        held.stopWatch?.();
      }
      for (const held of settings.values()) held.stopWatch?.();
      lists = new Map();
      settings = new Map();
    },
  };
}
