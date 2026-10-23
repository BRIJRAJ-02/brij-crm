// Settings › History › Workspace changes (spec 0046, AC-4629, AC-4630): one paged
// read of the workspace's audit log per open History tab, newest first. Loaded
// with `import()` on first use, so it is never in the first load. It is not
// live (no change event reads it again; a visit reads it afresh) and nothing
// in it enters the record store. A 403 (the reader lost `audit.read`) is its
// own state; a failed first page and a failed later page are two, so the rows
// already shown stay. `dispose()` aborts the read still out and stops it.
import type { AuditEntryView, AuditListInput, AuditPage } from '@crm/contracts';
import { toDataError } from '../errors.ts';

/** What the log needs: the one read, which takes a signal to cancel it, and who to tell when it is held and let go. */
export interface AuditLogDeps {
  readonly list: (input: AuditListInput, signal: AbortSignal) => Promise<AuditPage>;
  /** A screen holds it (the first holder, or a holder again before it was disposed). */
  readonly onHeld?: () => void;
  /** It was disposed: nothing holds it, and nothing it reads lands. */
  readonly onDisposed?: () => void;
}

/** Where the log is: its first page loading or failed, ready, a later page loading or failed, or refused. */
export type AuditLogStatus = 'loading' | 'ready' | 'more' | 'failed' | 'more-failed' | 'forbidden';

/** The log as a screen draws it. `message` is the data layer's, for a failure. */
export interface AuditLogState {
  readonly status: AuditLogStatus;
  readonly entries: readonly AuditEntryView[];
  /** True while another page follows: Show more. */
  readonly hasMore: boolean;
  readonly message?: string;
}

/** One open log: a store a screen subscribes to, and the reader's three actions. */
export interface AuditLog {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AuditLogState;
  /** Reads the next page (Show more), from `ready` or after a later page failed. */
  readonly more: () => void;
  /** Reads the failed page again (Try again): the first one, or the one after the rows shown. */
  readonly retry: () => void;
  /**
   * Held while a screen shows it. When the last holder lets go it is disposed
   * a moment later, unless held again first (a remount keeps it).
   */
  readonly retain: () => () => void;
  /** Aborts the read still out, and stops: nothing it reads after lands. */
  readonly dispose: () => void;
}

/** Opens the log of `workspace` and starts its first page at once (the route's loader opens it). */
export function openAuditLog(deps: AuditLogDeps, workspace: string): AuditLog {
  let state: AuditLogState = { status: 'loading', entries: [], hasMore: false };
  let cursor: string | undefined;
  let reading: AbortController | undefined;
  let disposed = false;
  let holders = 0;
  let letGo: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: AuditLogState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const read = (after: string | undefined) => {
    if (disposed) return;
    reading?.abort();
    const controller = new AbortController();
    reading = controller;
    const isFirst = after === undefined;
    set(isFirst ? { status: 'loading', entries: [], hasMore: false } : { ...state, status: 'more', hasMore: true });
    deps
      .list({ workspace, ...(after === undefined ? {} : { cursor: after }) }, controller.signal)
      .then(
        (page) => {
          if (disposed || reading !== controller) return;
          cursor = page.nextCursor;
          set({
            status: 'ready',
            entries: isFirst ? page.entries : [...state.entries, ...page.entries],
            hasMore: page.nextCursor !== undefined,
          });
        },
        (error: unknown) => {
          if (disposed || reading !== controller) return;
          const failed = toDataError(error);
          if (failed.code === 'FORBIDDEN') {
            cursor = undefined;
            set({ status: 'forbidden', entries: [], hasMore: false, message: failed.message });
            return;
          }
          set(
            isFirst
              ? { status: 'failed', entries: [], hasMore: false, message: failed.message }
              : { ...state, status: 'more-failed', hasMore: true, message: failed.message },
          );
        },
      )
      .finally(() => {
        if (reading === controller) reading = undefined;
      });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (letGo !== undefined) clearTimeout(letGo);
    reading?.abort();
    reading = undefined;
    listeners.clear();
    deps.onDisposed?.();
  };

  read(undefined);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    more() {
      if ((state.status === 'ready' || state.status === 'more-failed') && cursor !== undefined) read(cursor);
    },
    retry() {
      if (state.status === 'failed') read(undefined);
      else if (state.status === 'more-failed' && cursor !== undefined) read(cursor);
    },
    retain() {
      holders += 1;
      if (holders === 1 && !disposed) deps.onHeld?.();
      if (letGo !== undefined) {
        clearTimeout(letGo);
        letGo = undefined;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) letGo = setTimeout(dispose, 0);
      };
    },
    dispose,
  };
}
