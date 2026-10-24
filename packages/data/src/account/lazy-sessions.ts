// The person's sessions (spec 0033) behind a door that loads their store on first use: only Settings › Sign in and
// devices shows them, so the store and its calls never ride in the app's first load. The view answers at once,
// loading until the store arrives, then speaks for the store's own.
import type {
  AccountSessionsState,
  AccountSessionsStore,
  AccountSessionsView,
  SignOutOthersResult,
} from './sessions.ts';

const LOADING: AccountSessionsState = { status: 'loading' };

/** The store, loaded by `load` the first time anything asks; `view` answers at once. */
export function lazyAccountSessions(load: () => Promise<AccountSessionsStore>) {
  let loaded: Promise<AccountSessionsStore> | undefined;
  let store: AccountSessionsStore | undefined;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  let holds = 0;
  let release: (() => void) | undefined;
  const open = (): Promise<AccountSessionsStore> =>
    (loaded ??= load().then((made) => {
      store = made;
      made.view().subscribe(tell);
      if (holds > 0) release = made.view().retain();
      tell();
      return made;
    }));
  const view: AccountSessionsView = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => store?.view().getSnapshot() ?? LOADING,
    retain() {
      holds += 1;
      if (store === undefined) void open();
      else if (holds === 1) release = store.view().retain();
      return () => {
        holds -= 1;
        if (holds === 0) {
          release?.();
          release = undefined;
        }
      };
    },
    loadMore: () => store?.view().loadMore(),
    reload: () => {
      // Nothing read yet: nothing to read again.
      store?.view().reload();
    },
  };
  return {
    view: (): AccountSessionsView => view,
    signOut: (sessionId: string): Promise<boolean> => open().then((made) => made.signOut(sessionId)),
    signOutOthers: (): Promise<SignOutOthersResult> => open().then((made) => made.signOutOthers()),
  };
}
