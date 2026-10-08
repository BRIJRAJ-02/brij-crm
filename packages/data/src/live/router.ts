// The live router (spec 0007, Client): each store registers a handler for the
// kinds of change it holds (`on`) and its resync (`onResync`), and the live
// layer hands every event it applies, live or caught up, to them. A kind with
// no handler is ignored after its `seq` is applied. Tiny and free of
// imports, so it sits in the first load and stores register before live
// updates load.
import type { ChangeEvent } from '@crm/contracts';

/** Every kind a store can register for: each of spec 0007's kinds but the stub, which only moves the watermark. */
export const LIVE_KINDS = [
  'records',
  'entries',
  'definitions',
  'views',
  'notes',
  'tasks',
  'members',
  'access',
  'jobs',
] as const satisfies readonly ChangeEvent['kind'][];

/** A kind a store can register for. */
export type LiveKind = (typeof LIVE_KINDS)[number];

/** One kind's event. */
export type LiveEventOf<K extends LiveKind> = Extract<ChangeEvent, { kind: K }>;

/** What a store does with one event of its kind, for one workspace. */
export type LiveHandler<K extends LiveKind> = (workspace: string, event: LiveEventOf<K>) => void;

/** The router: stores register, the live layer dispatches. */
export interface LiveRouter {
  /** Registers `handler` for `kind`; the answer takes it away. */
  on<K extends LiveKind>(kind: K, handler: LiveHandler<K>): () => void;
  /** Registers a store's resync (refetch everything it holds of the workspace); the answer takes it away. */
  onResync(resync: (workspace: string) => void): () => void;
  /** Hands an event to its kind's handlers; the stub and kinds nobody registered do nothing. */
  dispatch(workspace: string, event: ChangeEvent): void;
  /** Runs every store's resync. */
  resync(workspace: string): void;
}

/** A new live router with no handlers. */
export function createLiveRouter(): LiveRouter {
  const handlers = new Map<string, Set<(workspace: string, event: ChangeEvent) => void>>();
  const resyncs = new Set<(workspace: string) => void>();
  return {
    on(kind, handler) {
      const set = handlers.get(kind) ?? new Set();
      handlers.set(kind, set);
      const entry = handler as (workspace: string, event: ChangeEvent) => void;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    onResync(resync) {
      resyncs.add(resync);
      return () => {
        resyncs.delete(resync);
      };
    },
    dispatch(workspace, event) {
      for (const handler of handlers.get(event.kind) ?? []) handler(workspace, event);
    },
    resync(workspace) {
      for (const resync of resyncs) resync(workspace);
    },
  };
}
