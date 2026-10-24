// The operator console's store (spec 0047) behind a door that loads it on first use: only a super admin opens the
// console, so its store and calls never ride in the app's first load. Each read answers a stand in at once, the same
// one for the same question, which speaks for the store's own held read once the store has arrived.
import type { OperatorPeriod } from '@crm/contracts';
import type { OperatorHeld, OperatorState, OperatorStore, OperatorUsersHeld, OperatorUsersState } from './store.ts';

/** The store, loaded by `load` the first time anything asks; reads answer at once. */
export function lazyOperator(load: () => Promise<OperatorStore>) {
  let loaded: Promise<OperatorStore> | undefined;
  let store: OperatorStore | undefined;
  const open = (): Promise<OperatorStore> =>
    (loaded ??= load().then((made) => {
      store = made;
      return made;
    }));
  const stands = new Map<string, OperatorUsersHeld>();

  /** One stand in per question: loading until the store arrives, then the store's own read. */
  function stand<T>(key: string, real: (made: OperatorStore) => OperatorHeld<T>, loading: T): OperatorUsersHeld {
    const found = stands.get(key);
    if (found !== undefined) return found;
    const listeners = new Set<() => void>();
    let heard = false;
    const arrived = () =>
      open().then((made) => {
        const inner = real(made);
        if (!heard) {
          heard = true;
          inner.subscribe(() => {
            for (const listener of listeners) listener();
          });
          for (const listener of listeners) listener();
        }
        return inner;
      });
    void arrived();
    const made = {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => (store === undefined ? loading : real(store).getSnapshot()),
      ready: () => arrived().then((inner) => inner.ready()),
      retry: () => {
        void arrived().then((inner) => {
          inner.retry();
        });
      },
      more: () => {
        void arrived().then((inner) => {
          if ('more' in inner && typeof inner.more === 'function') (inner as OperatorUsersHeld).more();
        });
      },
    } as unknown as OperatorUsersHeld;
    stands.set(key, made);
    return made;
  }

  const plain = <T>(key: string, real: (made: OperatorStore) => OperatorHeld<OperatorState<T>>) =>
    stand<OperatorState<T>>(key, real, { status: 'loading' }) as unknown as OperatorHeld<OperatorState<T>>;

  return {
    overview: (period: OperatorPeriod) => plain(`overview:${period}`, (made) => made.overview(period)),
    users: (period: OperatorPeriod, q: string): OperatorUsersHeld =>
      stand<OperatorUsersState>(`users:${period}:${q}`, (made) => made.users(period, q), {
        status: 'loading',
        users: [],
        total: 0,
        hasMore: false,
        isLoadingMore: false,
        period,
      }),
    user: (userId: string, period: OperatorPeriod) =>
      plain(`user:${userId}:${period}`, (made) => made.user(userId, period)),
    pages: (period: OperatorPeriod) => plain(`pages:${period}`, (made) => made.pages(period)),
    page: (workspaceId: string, pageId: string, period: OperatorPeriod) =>
      plain(`page:${workspaceId}:${pageId}:${period}`, (made) => made.page(workspaceId, pageId, period)),
    site: (period: OperatorPeriod) => plain(`site:${period}`, (made) => made.site(period)),
  };
}
