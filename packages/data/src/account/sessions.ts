// The signed in person's own sessions (spec 0033, Settings › Account ›
// Security): one held list, read while a screen retains it, a page at a time.
// Signing a device out leaves the list at once and comes back with a toast
// when refused. "Sign out of all other devices" leaves only this device at
// once; when the server asks for a fresh sign in first (STEP_UP_REQUIRED) the
// list comes back without a toast and the answer says so, for the screen to
// explain. Sessions are named by id only; no token ever reaches the browser.
import type { AccountSession, RevokedSessions, SessionPage } from '@crm/contracts';
import { refusalSummary, toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

/** The calls the store makes. */
export interface AccountSessionsApi {
  readonly list: (input: { readonly cursor?: string }) => Promise<SessionPage>;
  readonly revoke: (input: { readonly sessionId: string }) => Promise<{ readonly ok: true }>;
  readonly revokeOthers: () => Promise<RevokedSessions>;
}

/** What the store needs. */
export interface AccountSessionsDeps {
  readonly api: AccountSessionsApi;
  readonly notify: (notice: Notice) => void;
}

/** The person's sessions as a screen shows them: loading, failed, or the list as far as it was read. */
export type AccountSessionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly items: readonly AccountSession[];
      /** Set while more sessions wait past the last one read. */
      readonly nextCursor?: string;
      readonly loadingMore: boolean;
    };

/** How "Sign out of all other devices" went. */
export type SignOutOthersResult =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly code: 'STEP_UP_REQUIRED' | 'REFUSED'; readonly message: string };

/** The person's sessions, as screens hold them. */
export interface AccountSessionsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AccountSessionsState;
  /** Held while a screen shows it: read from the top each time it is first held. */
  readonly retain: () => () => void;
  /** Reads the next page, when there is one. */
  readonly loadMore: () => void;
  /** Reads it again from the top (Try again). */
  readonly reload: () => void;
}

/** The account sessions store: the one list, and the person's sign outs. */
export function createAccountSessionsStore(deps: AccountSessionsDeps) {
  let state: AccountSessionsState = { status: 'loading' };
  let held = 0;
  let reading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: AccountSessionsState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const readTop = (): Promise<void> => {
    reading ??= deps.api
      .list({})
      .then(
        (page) => {
          set({
            status: 'ready',
            items: page.items,
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
            loadingMore: false,
          });
        },
        (error: unknown) => {
          // A list already shown stays; only a first read shows the failure.
          if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
        },
      )
      .finally(() => {
        reading = undefined;
      });
    return reading;
  };

  const loadMore = () => {
    if (state.status !== 'ready' || state.nextCursor === undefined || state.loadingMore) return;
    const cursor = state.nextCursor;
    set({ ...state, loadingMore: true });
    deps.api.list({ cursor }).then(
      (page) => {
        if (state.status !== 'ready') return;
        const seen = new Set(state.items.map((each) => each.id));
        const { nextCursor: _old, ...rest } = state;
        set({
          ...rest,
          items: [...state.items, ...page.items.filter((each) => !seen.has(each.id))],
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          loadingMore: false,
        });
      },
      (error: unknown) => {
        if (state.status === 'ready') set({ ...state, loadingMore: false });
        deps.notify({ tone: 'danger', message: toDataError(error).message });
      },
    );
  };

  /** Shows `keep` at once; answers how to put the list back. */
  const patch = (keep: (session: AccountSession) => boolean) => {
    if (state.status !== 'ready') return () => undefined;
    const before = state;
    set({ ...state, items: state.items.filter(keep) });
    return () => {
      // Put back only the rows taken, so a read that landed meanwhile stays.
      if (state.status !== 'ready') return;
      const now = new Set(state.items.map((each) => each.id));
      const taken = before.items.filter((each) => !keep(each) && !now.has(each.id));
      const order = new Map(before.items.map((each, index) => [each.id, index]));
      set({
        ...state,
        items: [...state.items, ...taken].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
      });
    };
  };

  const view: AccountSessionsView = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain() {
      held += 1;
      if (held === 1) void readTop();
      return () => {
        held -= 1;
      };
    },
    loadMore,
    reload() {
      void readTop();
    },
  };

  return {
    view: (): AccountSessionsView => view,
    /** Signs one device out: gone at once, back with a toast if refused. Answers whether it landed. */
    async signOut(sessionId: string): Promise<boolean> {
      const undo = patch((each) => each.id !== sessionId);
      try {
        await deps.api.revoke({ sessionId });
        return true;
      } catch (error) {
        const refusal = toDataError(error);
        // Already signed out elsewhere: the row is right to be gone.
        if (refusal.code === 'NOT_FOUND') return true;
        undo();
        deps.notify({ tone: 'danger', message: refusalSummary(refusal) });
        return false;
      }
    },
    /**
     * Signs out every device but this one: only this one shows at once. When
     * the server wants a recent sign in first, the list comes back and the
     * answer carries STEP_UP_REQUIRED for the screen to explain, with no toast.
     */
    async signOutOthers(): Promise<SignOutOthersResult> {
      const undo = patch((each) => each.current);
      try {
        const answer = await deps.api.revokeOthers();
        // Pages past the first may have held more: read from the top again.
        void readTop();
        return { ok: true, count: answer.count };
      } catch (error) {
        undo();
        const refusal = toDataError(error);
        if (refusal.code === 'STEP_UP_REQUIRED') {
          return { ok: false, code: 'STEP_UP_REQUIRED', message: refusal.message };
        }
        const message = refusalSummary(refusal);
        deps.notify({ tone: 'danger', message });
        return { ok: false, code: 'REFUSED', message };
      }
    },
  };
}

/** The account sessions store. */
export type AccountSessionsStore = ReturnType<typeof createAccountSessionsStore>;
