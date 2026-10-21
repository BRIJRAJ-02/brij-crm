// `data.comments` (spec 0038), loaded lazily with the first Comments tab: a
// record's threads as screens see them. One held entry per workspace and
// record: its open threads oldest first (the newest 20 first, "Show earlier
// threads" 20 more), its resolved threads once the disclosure opens, and the
// counts for the tab's label. Every write shows at once: a new comment or
// reply marked sending, an edit, a delete (a placeholder while the thread has
// other live comments), resolve and reopen, reactions. A refusal puts it back;
// a new comment's refusal comes back to the composer, which puts the text
// back, and the others raise a toast. Live: a `comments` event naming a held
// record reads the named threads again (`comments.get`, gathered for 100 ms),
// putting each in place, moving it between open and resolved, or taking it
// away when it no longer reads; a coarse one (a record rule) reads every held
// record of the workspace from the top after a random 0 to 2 seconds. A
// record let go of keeps its threads 30 seconds.
import { THREAD_GET_MAX } from '@crm/contracts/mentions';
import type { ChangeEvent, CommentEmoji, CommentVersion, CommentView, ThreadPage, ThreadView } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';

/** How long named threads gather before they are read again. */
export const COMMENTS_GATHER_MS = 100;

/** The longest spread before a coarse event's reread, in ms. */
const SPREAD_MS = 2_000;

/** How long a record nobody shows keeps its threads. */
const UNUSED_MS = 30_000;

/** The words the store raises itself. */
export const COMMENT_WORDS = {
  editFailed: 'Your edit wasn’t saved.',
  deleteFailed: 'The comment wasn’t deleted.',
  resolveFailed: 'The thread wasn’t changed.',
  reactFailed: 'Your reaction wasn’t saved.',
} as const;

/** The calls the comments store makes, each mapped to a DataError by the layer. */
export interface CommentsApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly resolved?: boolean;
    readonly cursor?: string;
  }) => Promise<ThreadPage>;
  readonly get: (input: {
    readonly workspace: string;
    readonly threadIds: readonly string[];
    readonly whole?: boolean;
  }) => Promise<readonly ThreadView[]>;
  readonly create: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly recordId: string;
    readonly threadId?: string;
    readonly body: string;
    readonly mutationId: string;
  }) => Promise<ThreadView>;
  readonly update: (input: {
    readonly workspace: string;
    readonly commentId: string;
    readonly body: string;
    readonly mutationId: string;
  }) => Promise<ThreadView>;
  readonly delete: (input: {
    readonly workspace: string;
    readonly commentId: string;
    readonly mutationId: string;
  }) => Promise<{ readonly threadId: string }>;
  readonly resolve: (input: {
    readonly workspace: string;
    readonly threadId: string;
    readonly resolved: boolean;
    readonly mutationId: string;
  }) => Promise<ThreadView>;
  readonly react: (input: {
    readonly workspace: string;
    readonly commentId: string;
    readonly emoji: CommentEmoji;
    readonly on: boolean;
    readonly mutationId: string;
  }) => Promise<ThreadView>;
  readonly versions: (input: {
    readonly workspace: string;
    readonly commentId: string;
  }) => Promise<readonly CommentVersion[]>;
}

/** What the comments store needs from the layer. */
export interface CommentsDeps {
  readonly api: CommentsApi;
  readonly mintId: () => string;
  readonly mutations: MutationLog;
  readonly notify: (notice: Notice) => void;
  /** Listens to a workspace's change events while a record's threads are shown; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
  /** 0 to 1, for the coarse spread; tests pass their own. */
  readonly random?: () => number;
  /** The clock, for a sending comment's time. */
  readonly now?: () => Date;
}

/** A comment as a screen shows it: the server's, or one of this tab's still sending. */
export type ShownComment = CommentView & { readonly isSending?: boolean };

/** A thread as a screen shows it. */
export type ShownThread = Omit<ThreadView, 'comments'> & { readonly comments: readonly ShownComment[] };

/** What a record's Comments tab shows now. */
export interface CommentsState {
  /** `unavailable` for a record missing, trashed or hidden. */
  readonly status: 'loading' | 'ready' | 'error' | 'unavailable';
  /** Open threads, oldest first. */
  readonly open: readonly ShownThread[];
  /** Resolved threads, oldest first: undefined until the disclosure asks. */
  readonly resolved?: readonly ShownThread[];
  readonly resolvedStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly openCount: number;
  readonly resolvedCount: number;
  /** Older open threads past the first shown: "Show earlier threads". */
  readonly hasEarlier: boolean;
  readonly isLoadingEarlier: boolean;
  /** Older resolved threads past the ones shown. */
  readonly hasEarlierResolved: boolean;
  readonly error?: DataError;
}

/** One record's threads, as a screen holds them. */
export interface RecordComments {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CommentsState;
  /** Holds the threads (and listens to the workspace) while a screen shows them; the answer lets go. */
  readonly retain: () => () => void;
  /** Loads 20 older open threads. */
  readonly loadEarlier: () => void;
  /** Loads the resolved threads (the disclosure opened), or 20 older ones. */
  readonly loadResolved: () => void;
  /** Reads it again from the top (Try again). */
  readonly retry: () => void;
  /**
   * Shows a thread a link names (AC-1161): loads earlier open threads, or the
   * resolved ones, until it holds it. Answers whether it is there and resolved.
   */
  readonly reveal: (threadId: string) => Promise<'open' | 'resolved' | 'missing'>;
  /** Reads every reply of a busy thread ("Show earlier replies"). */
  readonly loadWholeThread: (threadId: string) => Promise<DataError | undefined>;
}

/** A new comment from the composer. */
export interface NewComment {
  readonly body: string;
  /** Absent: a new thread. */
  readonly threadId?: string;
  /** The writer's member id, shown on the sending comment. */
  readonly authorId: string;
}

/** The comments store. */
export interface CommentsStore {
  readonly forRecord: (workspace: string, recordId: string) => RecordComments;
  /** Sends a comment, shown at once as sending; answers the refusal (the composer puts the text back). */
  readonly create: (workspace: string, recordId: string, comment: NewComment) => Promise<DataError | undefined>;
  readonly edit: (
    workspace: string,
    recordId: string,
    commentId: string,
    body: string,
  ) => Promise<DataError | undefined>;
  readonly remove: (workspace: string, recordId: string, commentId: string) => Promise<DataError | undefined>;
  readonly resolve: (
    workspace: string,
    recordId: string,
    threadId: string,
    resolved: boolean,
  ) => Promise<DataError | undefined>;
  readonly react: (
    workspace: string,
    recordId: string,
    commentId: string,
    emoji: CommentEmoji,
    on: boolean,
    memberId: string,
  ) => Promise<DataError | undefined>;
  readonly versions: (workspace: string, commentId: string) => Promise<readonly CommentVersion[]>;
  /** A live `comments` event. */
  readonly changed: (workspace: string, event: Extract<ChangeEvent, { kind: 'comments' }>) => void;
  /** Reads every held record of the workspace again. */
  readonly resync: (workspace: string) => void;
  /** Records trashed or restored: a held one reads again (and shows unavailable while in the trash). */
  readonly records: (workspace: string, recordIds: readonly string[]) => void;
  readonly clear: () => void;
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

const EMPTY: CommentsState = {
  status: 'loading',
  open: [],
  resolvedStatus: 'idle',
  openCount: 0,
  resolvedCount: 0,
  hasEarlier: false,
  isLoadingEarlier: false,
  hasEarlierResolved: false,
};

interface Held {
  readonly workspace: string;
  readonly recordId: string;
  readonly handle: RecordComments;
  state: CommentsState;
  cursor?: string;
  resolvedCursor?: string;
  holders: number;
  generation: number;
  /** Threads known to be resolved, shown or not: the resolved count moves once per thread. */
  readonly knownResolved: Set<string>;
  stopWatch?: () => void;
  cancelDrop?: () => void;
  readonly listeners: Set<() => void>;
}

/** The thread with the live comment's reactions as one member toggles one. */
function toggled(comment: ShownComment, emoji: CommentEmoji, on: boolean, memberId: string): ShownComment {
  const existing = comment.reactions.find((reaction) => reaction.emoji === emoji);
  if (on) {
    if (existing?.mine === true) return comment;
    const reactions =
      existing === undefined
        ? [...comment.reactions, { emoji, count: 1, mine: true, memberIds: [memberId] }]
        : comment.reactions.map((reaction) =>
            reaction.emoji === emoji
              ? {
                  ...reaction,
                  count: reaction.count + 1,
                  mine: true,
                  memberIds: [...reaction.memberIds, memberId].slice(0, 10),
                }
              : reaction,
          );
    return { ...comment, reactions };
  }
  if (existing?.mine !== true) return comment;
  const reactions = comment.reactions.flatMap((reaction) => {
    if (reaction.emoji !== emoji) return [reaction];
    if (reaction.count <= 1) return [];
    return [
      {
        ...reaction,
        count: reaction.count - 1,
        mine: false,
        memberIds: reaction.memberIds.filter((id) => id !== memberId),
      },
    ];
  });
  return { ...comment, reactions };
}

/** A server thread with this tab's sending comments of it kept at the end. */
function withSending(server: ThreadView, shown: ShownThread | undefined): ShownThread {
  if (shown === undefined) return server;
  const ids = new Set(server.comments.map((comment) => comment.id));
  const sending = shown.comments.filter((comment) => comment.isSending === true && !ids.has(comment.id));
  return sending.length === 0 ? server : { ...server, comments: [...server.comments, ...sending] };
}

/** A new comments store. */
export function createCommentsStore(deps: CommentsDeps): CommentsStore {
  const later = deps.later ?? defaultLater;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => new Date());
  let held = new Map<string, Held>();
  // Threads named by events, gathered per workspace until their read.
  let gathering = new Map<string, { readonly threadIds: Set<string>; readonly recordIds: Set<string> }>();
  const spreading = new Set<string>();

  const keyOf = (workspace: string, recordId: string) => `${workspace} ${recordId}`;
  const announce = (entry: Held) => {
    for (const listener of entry.listeners) listener();
  };
  const set = (entry: Held, state: CommentsState) => {
    entry.state = state;
    announce(entry);
  };
  const ofWorkspace = (workspace: string) => [...held.values()].filter((entry) => entry.workspace === workspace);

  /** Reads a record's open threads from the top (and its resolved ones, when shown). */
  const readTop = (entry: Held) => {
    entry.generation += 1;
    const generation = entry.generation;
    const wantResolved = entry.state.resolved !== undefined;
    deps.api.list({ workspace: entry.workspace, recordId: entry.recordId }).then(
      async (page) => {
        if (entry.generation !== generation) return;
        let resolved: readonly ShownThread[] | undefined;
        let resolvedCursor: string | undefined;
        if (wantResolved) {
          const done = await deps.api
            .list({ workspace: entry.workspace, recordId: entry.recordId, resolved: true })
            .catch(() => undefined);
          if (entry.generation !== generation) return;
          if (done !== undefined) {
            resolved = [...done.threads].reverse();
            resolvedCursor = done.nextCursor;
          }
        }
        entry.cursor = page.nextCursor;
        entry.resolvedCursor = resolvedCursor;
        entry.knownResolved.clear();
        for (const done of resolved ?? []) entry.knownResolved.add(done.id);
        const shownById = new Map(entry.state.open.map((thread) => [thread.id, thread]));
        set(entry, {
          status: 'ready',
          open: [...page.threads].reverse().map((thread) => withSending(thread, shownById.get(thread.id))),
          ...(resolved === undefined ? {} : { resolved }),
          resolvedStatus: resolved === undefined ? 'idle' : 'ready',
          openCount: page.counts?.open ?? page.threads.length,
          resolvedCount: page.counts?.resolved ?? 0,
          hasEarlier: page.nextCursor !== undefined,
          isLoadingEarlier: false,
          hasEarlierResolved: resolvedCursor !== undefined,
        });
      },
      (failed: unknown) => {
        if (entry.generation !== generation) return;
        const error = toDataError(failed);
        set(entry, {
          ...EMPTY,
          status: error.code === 'NOT_FOUND' ? 'unavailable' : 'error',
          error,
        });
      },
    );
  };

  const loadEarlier = (entry: Held): Promise<void> => {
    const { state } = entry;
    if (state.status !== 'ready' || !state.hasEarlier || state.isLoadingEarlier || entry.cursor === undefined) {
      return Promise.resolve();
    }
    const generation = entry.generation;
    set(entry, { ...state, isLoadingEarlier: true });
    return deps.api.list({ workspace: entry.workspace, recordId: entry.recordId, cursor: entry.cursor }).then(
      (page) => {
        if (entry.generation !== generation) return;
        entry.cursor = page.nextCursor;
        const shown = new Set(entry.state.open.map((thread) => thread.id));
        const older = [...page.threads].reverse().filter((thread) => !shown.has(thread.id));
        set(entry, {
          ...entry.state,
          open: [...older, ...entry.state.open],
          hasEarlier: page.nextCursor !== undefined,
          isLoadingEarlier: false,
        });
      },
      () => {
        if (entry.generation !== generation) return;
        set(entry, { ...entry.state, isLoadingEarlier: false });
      },
    );
  };

  const loadResolved = (entry: Held): Promise<void> => {
    const { state } = entry;
    if (state.status !== 'ready' || state.resolvedStatus === 'loading') return Promise.resolve();
    if (state.resolved !== undefined && !state.hasEarlierResolved) return Promise.resolve();
    const generation = entry.generation;
    const cursor = state.resolved === undefined ? undefined : entry.resolvedCursor;
    set(entry, { ...state, resolvedStatus: 'loading' });
    return deps.api
      .list({
        workspace: entry.workspace,
        recordId: entry.recordId,
        resolved: true,
        ...(cursor === undefined ? {} : { cursor }),
      })
      .then(
        (page) => {
          if (entry.generation !== generation) return;
          entry.resolvedCursor = page.nextCursor;
          const before = entry.state.resolved ?? [];
          const shown = new Set(before.map((thread) => thread.id));
          const older = [...page.threads].reverse().filter((thread) => !shown.has(thread.id));
          for (const done of older) entry.knownResolved.add(done.id);
          set(entry, {
            ...entry.state,
            resolved: [...older, ...before],
            resolvedStatus: 'ready',
            hasEarlierResolved: page.nextCursor !== undefined,
          });
        },
        () => {
          if (entry.generation !== generation) return;
          set(entry, { ...entry.state, resolvedStatus: 'error' });
        },
      );
  };

  const entryOf = (workspace: string, recordId: string): Held => {
    const key = keyOf(workspace, recordId);
    const existing = held.get(key);
    if (existing !== undefined) return existing;
    const listeners = new Set<() => void>();
    const entry: Held = {
      workspace,
      recordId,
      holders: 0,
      generation: 0,
      knownResolved: new Set(),
      listeners,
      state: EMPTY,
      handle: {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => entry.state,
        retain() {
          entry.holders += 1;
          entry.cancelDrop?.();
          entry.cancelDrop = undefined;
          if (entry.holders === 1) {
            entry.stopWatch = deps.watch(workspace);
            readTop(entry);
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
              if (entry.holders === 0 && held.get(key) === entry) held.delete(key);
            }, UNUSED_MS);
          };
        },
        loadEarlier: () => {
          void loadEarlier(entry);
        },
        loadResolved: () => {
          void loadResolved(entry);
        },
        retry() {
          set(entry, EMPTY);
          readTop(entry);
        },
        async reveal(threadId) {
          const waitReady = () =>
            new Promise<void>((resolve) => {
              if (entry.state.status !== 'loading') {
                resolve();
                return;
              }
              const stop = entry.handle.subscribe(() => {
                if (entry.state.status !== 'loading') {
                  stop();
                  resolve();
                }
              });
            });
          await waitReady();
          for (;;) {
            if (entry.state.status !== 'ready') return 'missing';
            if (entry.state.open.some((thread) => thread.id === threadId)) return 'open';
            if (entry.state.resolved?.some((thread) => thread.id === threadId) === true) return 'resolved';
            if (entry.state.hasEarlier) {
              await loadEarlier(entry);
              if (entry.state.isLoadingEarlier) return 'missing';
              continue;
            }
            if (entry.state.resolved === undefined || entry.state.hasEarlierResolved) {
              const before = entry.state.resolved?.length ?? -1;
              await loadResolved(entry);
              if ((entry.state.resolved?.length ?? -1) === before && !entry.state.hasEarlierResolved) return 'missing';
              if (entry.state.resolvedStatus === 'error') return 'missing';
              continue;
            }
            return 'missing';
          }
        },
        async loadWholeThread(threadId) {
          try {
            const [thread] = await deps.api.get({ workspace, threadIds: [threadId], whole: true });
            if (thread === undefined) {
              place(entry, threadId, undefined);
              return undefined;
            }
            place(entry, threadId, withSending(thread, findThread(entry, threadId)));
            return undefined;
          } catch (failed) {
            return toDataError(failed);
          }
        },
      },
    };
    held.set(key, entry);
    // One nobody holds yet (a route preloaded on hover, a write) goes after a while too, unless a screen holds it.
    entry.cancelDrop = later(() => {
      if (entry.holders === 0 && held.get(key) === entry) held.delete(key);
    }, UNUSED_MS);
    return entry;
  };

  /** Where a thread shows in a held record, if anywhere. */
  const findThread = (entry: Held, threadId: string): ShownThread | undefined =>
    entry.state.open.find((thread) => thread.id === threadId) ??
    entry.state.resolved?.find((thread) => thread.id === threadId);

  /**
   * Puts a thread in place in a record's lists: the server's version (or a
   * shown one), moved between open and resolved, or taken away (undefined).
   * A thread not shown yet joins the end of its list (it is the newest).
   * Counts follow.
   */
  const place = (entry: Held, threadId: string, thread: ShownThread | undefined) => {
    const { state } = entry;
    if (state.status !== 'ready') return;
    const wasOpen = state.open.findIndex((shown) => shown.id === threadId);
    const wasResolved = state.resolved?.findIndex((shown) => shown.id === threadId) ?? -1;
    const wasKnownResolved = wasResolved >= 0 || entry.knownResolved.has(threadId);
    const next = thread;
    const goesResolved = next?.resolvedAt !== undefined;
    let open = state.open;
    let resolved = state.resolved;
    let { openCount, resolvedCount } = state;
    if (wasOpen >= 0) {
      if (next !== undefined && !goesResolved) open = open.map((shown, index) => (index === wasOpen ? next : shown));
      else {
        open = open.filter((_, index) => index !== wasOpen);
        openCount = Math.max(0, openCount - 1);
      }
    } else if (next !== undefined && !goesResolved && wasResolved < 0) {
      open = [...open, next];
      openCount += 1;
    }
    if (wasKnownResolved) {
      if (next !== undefined && goesResolved) {
        if (resolved !== undefined && wasResolved >= 0) {
          resolved = resolved.map((shown, index) => (index === wasResolved ? next : shown));
        } else if (resolved !== undefined) resolved = [...resolved, next];
      } else {
        if (resolved !== undefined) resolved = resolved.filter((_, index) => index !== wasResolved);
        resolvedCount = Math.max(0, resolvedCount - 1);
        entry.knownResolved.delete(threadId);
      }
    } else if (next !== undefined && goesResolved) {
      resolvedCount += 1;
      entry.knownResolved.add(threadId);
      if (resolved !== undefined) resolved = [...resolved, next];
    }
    if (next !== undefined && !goesResolved && wasKnownResolved && wasOpen < 0) {
      // Reopened: back among the open threads, in the order they were started.
      open = [...open, next].sort((a, b) =>
        (a.comments[0]?.createdAt ?? '').localeCompare(b.comments[0]?.createdAt ?? ''),
      );
      openCount += 1;
    }
    set(entry, { ...state, open, ...(resolved === undefined ? {} : { resolved }), openCount, resolvedCount });
  };

  /** Changes one comment wherever it shows in a record; answers the thread as it was, for a rollback. */
  const changeComment = (
    entry: Held,
    commentId: string,
    change: (comment: ShownComment, thread: ShownThread) => ShownThread | undefined,
  ): { readonly before: ShownThread } | undefined => {
    for (const thread of [...entry.state.open, ...(entry.state.resolved ?? [])]) {
      const comment = thread.comments.find((shown) => shown.id === commentId);
      if (comment === undefined) continue;
      place(entry, thread.id, change(comment, thread));
      return { before: thread };
    }
    return undefined;
  };

  /** Sends one write: answered with the thread, or put back with a toast. */
  const send = async <T>(
    run: (mutationId: string) => Promise<T>,
    rollback: () => void,
    words: string,
  ): Promise<{ readonly answer?: T; readonly error?: DataError }> => {
    const mutationId = deps.mintId();
    deps.mutations.sent(mutationId);
    try {
      const answer = await run(mutationId);
      deps.mutations.answered(mutationId, 1);
      return { answer };
    } catch (failed) {
      deps.mutations.forget(mutationId);
      const error = toDataError(failed);
      rollback();
      deps.notify({ tone: 'danger', message: `${words} ${error.message}` });
      return { error };
    }
  };

  /** Reads the named threads of held records again, gathered per workspace. */
  const gather = (workspace: string, recordIds: readonly string[], threadIds: readonly string[]) => {
    const existing = gathering.get(workspace);
    if (existing !== undefined) {
      for (const id of threadIds) existing.threadIds.add(id);
      for (const id of recordIds) existing.recordIds.add(id);
      return;
    }
    const batch = { threadIds: new Set(threadIds), recordIds: new Set(recordIds) };
    gathering.set(workspace, batch);
    later(() => {
      gathering.delete(workspace);
      const entries = ofWorkspace(workspace).filter((entry) => batch.recordIds.has(entry.recordId));
      if (entries.length === 0) return;
      const ids = [...batch.threadIds];
      const chunks: string[][] = [];
      for (let start = 0; start < ids.length; start += THREAD_GET_MAX)
        chunks.push(ids.slice(start, start + THREAD_GET_MAX));
      for (const chunk of chunks) {
        deps.api.get({ workspace, threadIds: chunk }).then(
          (threads) => {
            const byId = new Map(threads.map((thread) => [thread.id, thread]));
            for (const entry of entries) {
              if (entry.state.status !== 'ready') continue;
              for (const threadId of chunk) {
                const thread = byId.get(threadId);
                if (thread === undefined) {
                  if (findThread(entry, threadId) !== undefined) place(entry, threadId, undefined);
                } else if (thread.recordId === entry.recordId) {
                  place(entry, threadId, withSending(thread, findThread(entry, threadId)));
                }
              }
            }
          },
          () => {
            // Unreadable now: the next event or a resync reads again.
          },
        );
      }
    }, COMMENTS_GATHER_MS);
  };

  const rereadWorkspace = (workspace: string) => {
    if (spreading.has(workspace)) return;
    spreading.add(workspace);
    later(
      () => {
        spreading.delete(workspace);
        for (const entry of ofWorkspace(workspace)) if (entry.holders > 0) readTop(entry);
      },
      Math.round(random() * SPREAD_MS),
    );
  };

  return {
    forRecord: (workspace, recordId) => entryOf(workspace, recordId).handle,

    async create(workspace, recordId, comment) {
      const entry = entryOf(workspace, recordId);
      const id = deps.mintId();
      const at = now().toISOString();
      const shown: ShownComment = {
        id,
        threadId: comment.threadId ?? id,
        isDeleted: false,
        body: comment.body.trim(),
        createdBy: { type: 'member', id: comment.authorId },
        createdAt: at,
        version: 1,
        reactions: [],
        canEdit: false,
        canDelete: false,
        isSending: true,
      };
      const threadBefore = comment.threadId === undefined ? undefined : findThread(entry, comment.threadId);
      if (comment.threadId === undefined) {
        place(entry, id, { id, recordId, earlierCount: 0, comments: [shown] });
      } else if (threadBefore !== undefined) {
        // A reply to a resolved thread reopens it (AC-1157).
        const { resolvedAt: _at, resolvedBy: _by, ...open } = threadBefore;
        place(entry, threadBefore.id, { ...open, comments: [...threadBefore.comments, shown] });
      }
      const mutationId = deps.mintId();
      deps.mutations.sent(mutationId);
      try {
        const thread = await deps.api.create({
          workspace,
          id,
          recordId,
          ...(comment.threadId === undefined ? {} : { threadId: comment.threadId }),
          body: comment.body,
          mutationId,
        });
        deps.mutations.answered(mutationId, 1);
        const current = findThread(entry, thread.id);
        const others = (current?.comments ?? []).filter(
          (shownComment) => shownComment.isSending === true && shownComment.id !== id,
        );
        const ids = new Set(thread.comments.map((serverComment) => serverComment.id));
        place(entry, thread.id, {
          ...thread,
          comments: [...thread.comments, ...others.filter((other) => !ids.has(other.id))],
        });
        return undefined;
      } catch (failed) {
        deps.mutations.forget(mutationId);
        if (comment.threadId === undefined) place(entry, id, undefined);
        else if (threadBefore !== undefined) {
          place(entry, threadBefore.id, threadBefore);
          gather(workspace, [recordId], [threadBefore.id]);
        }
        return toDataError(failed);
      }
    },

    async edit(workspace, recordId, commentId, body) {
      const entry = entryOf(workspace, recordId);
      const at = now().toISOString();
      const changed = changeComment(entry, commentId, (comment, thread) => ({
        ...thread,
        comments: thread.comments.map((shown) =>
          shown.id === comment.id ? { ...shown, body: body.trim(), editedAt: at, version: shown.version + 1 } : shown,
        ),
      }));
      const { answer, error } = await send(
        (mutationId) => deps.api.update({ workspace, commentId, body, mutationId }),
        () => {
          if (changed === undefined) return;
          place(entry, changed.before.id, changed.before);
          // The thread as it stood before may miss what arrived live meanwhile: read it again.
          gather(workspace, [recordId], [changed.before.id]);
        },
        COMMENT_WORDS.editFailed,
      );
      if (answer !== undefined) place(entry, answer.id, withSending(answer, findThread(entry, answer.id)));
      return error;
    },

    async remove(workspace, recordId, commentId) {
      const entry = entryOf(workspace, recordId);
      const changed = changeComment(entry, commentId, (comment, thread) => {
        const othersLive = thread.comments.some((shown) => shown.id !== comment.id && !shown.isDeleted);
        if (!othersLive) return undefined;
        return {
          ...thread,
          comments: thread.comments.map((shown) => {
            if (shown.id !== comment.id) return shown;
            const { createdBy: _by, editedAt: _edited, ...rest } = shown;
            return { ...rest, isDeleted: true, body: '', reactions: [], canEdit: false, canDelete: false };
          }),
        };
      });
      const { error } = await send(
        (mutationId) => deps.api.delete({ workspace, commentId, mutationId }),
        () => {
          if (changed === undefined) return;
          place(entry, changed.before.id, changed.before);
          gather(workspace, [recordId], [changed.before.id]);
        },
        COMMENT_WORDS.deleteFailed,
      );
      return error;
    },

    async resolve(workspace, recordId, threadId, resolved) {
      const entry = entryOf(workspace, recordId);
      const before = findThread(entry, threadId);
      if (before !== undefined) {
        const { resolvedAt: _at, resolvedBy: _by, ...open } = before;
        place(
          entry,
          threadId,
          resolved
            ? {
                ...open,
                resolvedAt: now().toISOString(),
                resolvedBy: before.comments[0]?.createdBy ?? { type: 'system', id: null },
              }
            : open,
        );
      }
      const { answer, error } = await send(
        (mutationId) => deps.api.resolve({ workspace, threadId, resolved, mutationId }),
        () => {
          if (before === undefined) return;
          place(entry, threadId, before);
          gather(workspace, [recordId], [threadId]);
        },
        COMMENT_WORDS.resolveFailed,
      );
      if (answer !== undefined) place(entry, answer.id, withSending(answer, findThread(entry, answer.id)));
      return error;
    },

    async react(workspace, recordId, commentId, emoji, on, memberId) {
      const entry = entryOf(workspace, recordId);
      const changed = changeComment(entry, commentId, (comment, thread) => ({
        ...thread,
        comments: thread.comments.map((shown) =>
          shown.id === comment.id ? toggled(shown, emoji, on, memberId) : shown,
        ),
      }));
      const { answer, error } = await send(
        (mutationId) => deps.api.react({ workspace, commentId, emoji, on, mutationId }),
        () => {
          if (changed === undefined) return;
          place(entry, changed.before.id, changed.before);
          gather(workspace, [recordId], [changed.before.id]);
        },
        COMMENT_WORDS.reactFailed,
      );
      if (answer !== undefined) place(entry, answer.id, withSending(answer, findThread(entry, answer.id)));
      return error;
    },

    versions: (workspace, commentId) => deps.api.versions({ workspace, commentId }),

    changed(workspace, event) {
      if (event.coarse === true) {
        rereadWorkspace(workspace);
        return;
      }
      const recordIds = event.recordIds.filter((recordId) => held.has(keyOf(workspace, recordId)));
      if (recordIds.length === 0) return;
      gather(workspace, recordIds, event.threadIds);
    },

    resync(workspace) {
      rereadWorkspace(workspace);
    },

    records(workspace, recordIds) {
      for (const recordId of recordIds) {
        const entry = held.get(keyOf(workspace, recordId));
        if (entry !== undefined && entry.holders > 0) readTop(entry);
      }
    },

    clear() {
      for (const entry of held.values()) {
        entry.cancelDrop?.();
        entry.stopWatch?.();
      }
      held = new Map();
      gathering = new Map();
      spreading.clear();
    },
  };
}
