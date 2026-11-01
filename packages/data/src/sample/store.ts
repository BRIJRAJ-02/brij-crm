// A workspace's sample data state (one button on an empty workspace), loaded with the first screen that offers it:
// one copy per workspace shared by the empty tables and Settings › General, read when held and again whenever the
// layer adds, removes or brings it back, and when its job ends, so no button is left busy or saying the wrong thing.
import type { SampleDataState } from '@crm/contracts';

/** A workspace's sample data, as a screen holds it. */
export type SampleSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly state: SampleDataState };

/** One workspace's sample data, read when first held. */
export interface SampleHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SampleSnapshot;
  readonly retain: () => () => void;
}

/** What the store is made with. */
export interface SampleDeps {
  readonly get: (workspace: string) => Promise<SampleDataState>;
}

/** Every workspace's sample data state the member has looked at. */
export function createSampleStore(deps: SampleDeps) {
  const held = new Map<string, ReturnType<typeof make>>();

  function make(workspace: string) {
    let state: SampleSnapshot = { status: 'loading' };
    // Each read's number: only the newest one's answer lands.
    let asked = 0;
    const listeners = new Set<() => void>();
    const set = (next: SampleSnapshot) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      asked += 1;
      const mine = asked;
      deps.get(workspace).then(
        (answer) => {
          if (mine === asked) set({ status: 'ready', state: answer });
        },
        () => {
          if (mine === asked && state.status !== 'ready') set({ status: 'error' });
        },
      );
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        read();
        return () => undefined;
      },
      read,
    };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const created = make(workspace);
    held.set(workspace, created);
    return created;
  };

  return {
    /** A workspace's sample data, read when a screen first holds it. Read it through `useSampleData`. */
    of: (workspace: string): SampleHeld => of(workspace),
    /** Reads it again, for a screen holding it: after an add, a remove, its Undo, or the job's end. */
    refresh: (workspace: string): void => {
      held.get(workspace)?.read();
    },
    /** Signed out: forgets every workspace's. */
    clear: (): void => {
      held.clear();
    },
  };
}

/** The sample data store. */
export type SampleStore = ReturnType<typeof createSampleStore>;
