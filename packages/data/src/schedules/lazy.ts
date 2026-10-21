// The schedules store behind a door that loads it on first use (spec 0035): it isn't in the first load, so the
// data layer hands screens a view at once that reads loading until the store arrives, then speaks for it.
import type { SchedulesState, SchedulesStore, SchedulesView } from './store.ts';

const LOADING: SchedulesState = { status: 'loading' };

/** The store, loaded by `load` the first time anything asks; `view` answers at once. */
export function lazySchedules(load: () => Promise<SchedulesStore>) {
  let loaded: Promise<SchedulesStore> | undefined;
  let store: SchedulesStore | undefined;
  const open = () =>
    (loaded ??= load().then((made) => {
      store = made;
      return made;
    }));
  const views = new Map<string, SchedulesView>();
  /** One view per key, standing in for the store's until it loads. */
  const view = (workspace: string, memberId: string | undefined, timeZone: string): SchedulesView => {
    const key = `${workspace}:${memberId ?? 'me'}:${timeZone}`;
    const found = views.get(key);
    if (found !== undefined) return found;
    // The store's own view, asked afresh each time: after a sign out clears the store, a new one answers.
    const inner = () => store?.view(workspace, memberId, timeZone);
    const listeners = new Set<() => void>();
    const tell = () => {
      for (const listener of listeners) listener();
    };
    let holds = 0;
    let release: (() => void) | undefined;
    let heard: SchedulesView | undefined;
    let unhear: (() => void) | undefined;
    /** Listens to the store's view now in place (once per view). */
    const hear = (real: SchedulesView) => {
      if (heard === real) return;
      unhear?.();
      heard = real;
      unhear = real.subscribe(tell);
    };
    const arrived = () =>
      open().then((made) => {
        const real = made.view(workspace, memberId, timeZone);
        hear(real);
        return real;
      });
    void arrived().then((real) => {
      if (holds > 0 && release === undefined) release = real.retain();
      tell();
    });
    const made: SchedulesView = {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => inner()?.getSnapshot() ?? LOADING,
      retain() {
        holds += 1;
        const real = inner();
        if (holds === 1 && real !== undefined) {
          hear(real);
          release = real.retain();
        }
        return () => {
          holds -= 1;
          if (holds === 0) {
            release?.();
            release = undefined;
          }
        };
      },
      ready: () => arrived().then((real) => real.ready()),
      reload: () => {
        void arrived().then((real) => {
          real.reload();
        });
      },
    };
    views.set(key, made);
    return made;
  };
  return {
    view,
    /** A `schedules` event: nothing to read again until the store is loaded. */
    changed: (workspace: string) => store?.changed(workspace),
    clear: () => {
      store?.clear();
      views.clear();
    },
    create: (...args: Parameters<SchedulesStore['create']>) => open().then((made) => made.create(...args)),
    update: (...args: Parameters<SchedulesStore['update']>) => open().then((made) => made.update(...args)),
    setDefault: (...args: Parameters<SchedulesStore['setDefault']>) => open().then((made) => made.setDefault(...args)),
    duplicate: (...args: Parameters<SchedulesStore['duplicate']>) => open().then((made) => made.duplicate(...args)),
    remove: (...args: Parameters<SchedulesStore['remove']>) => open().then((made) => made.remove(...args)),
  };
}
