// A record `records.one` found missing, looked up in the trash (spec 0017):
// one source per workspace and record, read on its first subscriber, held
// here only (never in the record store, so no table shows a trashed record),
// and forgotten with the person's session. Small and dependency free, so it
// sits in the first load with the layer's surface.
import type { TrashedRecord } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/**
 * Where the lookup stands: still asking, in the trash and visible to the
 * reader (its page opens read only), unavailable (missing or hidden, one
 * answer), or failed (with Retry).
 */
export type TrashedState =
  | { readonly status: 'checking' }
  | ({ readonly status: 'trashed' } & TrashedRecord)
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly error: DataError };

/** A trash lookup, as a screen subscribes to it (`useTrashed` in `@crm/data/react`). */
export interface TrashedSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TrashedState;
  /** Asks again after a failure. */
  readonly retry: () => void;
  /** Settles once the lookup answered or failed. */
  readonly ready: () => Promise<void>;
}

const CHECKING: TrashedState = { status: 'checking' };

/** The trash lookups of one data layer. `read` is `records.getTrashed`. */
export function createTrashedLookups(read: (workspace: string, recordId: string) => Promise<TrashedRecord>) {
  const sources = new Map<string, TrashedSource>();

  function open(workspace: string, recordId: string): TrashedSource {
    const listeners = new Set<() => void>();
    let state: TrashedState = CHECKING;
    let asking: Promise<void> | undefined;
    const set = (next: TrashedState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const ask = (): Promise<void> => {
      if (state.status === 'failed') set(CHECKING);
      asking = read(workspace, recordId).then(
        (found) => {
          set({ status: 'trashed', ...found });
        },
        (failure: unknown) => {
          const error = toDataError(failure);
          set(error.code === 'NOT_FOUND' ? { status: 'unavailable' } : { status: 'failed', error });
        },
      );
      return asking;
    };
    return {
      subscribe: (listener) => {
        listeners.add(listener);
        if (asking === undefined) void ask();
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => state,
      retry: () => {
        void ask();
      },
      ready: () => asking ?? ask(),
    };
  }

  return {
    /** The lookup for a record, asked on its first subscriber, the same source for every screen. */
    lookup: (workspace: string, recordId: string): TrashedSource => {
      const key = `${workspace}\u0000${recordId}`;
      const found = sources.get(key);
      if (found !== undefined) return found;
      const made = open(workspace, recordId);
      sources.set(key, made);
      return made;
    },
    /** Forgets every lookup (sign out, or the record was restored elsewhere). */
    clear: (): void => {
      sources.clear();
    },
  };
}
