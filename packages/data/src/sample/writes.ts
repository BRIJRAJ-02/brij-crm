// Sample data's four calls (the sample lane), kept out of the first load. Only Settings › General and an empty
// People, Companies or Deals table offer them, and both screens load on use, so these load with them: `index.ts`
// reaches this with an `import()` rather than carrying the reads, the writes and their held copy into every first
// visit (`apps/web/.size-limit.js`).
import { createSampleStore, type SampleHeld, type SampleStore } from './store.ts';

/** What the calls need from the layer: the four requests, an id, and what each write makes stale. */
export interface SampleDeps {
  readonly api: {
    readonly get: (workspace: string) => Promise<{ readonly present: boolean; readonly canManage: boolean }>;
    readonly add: (workspace: string, mutationId: string) => Promise<{ readonly jobId: string }>;
    readonly remove: (workspace: string, batchId: string, mutationId: string) => Promise<{ readonly records: number }>;
    readonly undoRemove: (workspace: string, batchId: string, mutationId: string) => Promise<unknown>;
  };
  readonly mintId: () => string;
  /** Follows the add's job, so the tables read again and `onJobFinished` hears its end. */
  readonly followJob: (workspace: string, jobId: string) => void;
  /** The records a remove or its undo moved: the table reads them again. */
  readonly reloadRecords: (workspace: string) => void;
  /** The trash a remove filled, and its undo emptied. */
  readonly trashMoved: (workspace: string) => void;
}

/** Sample data as the layer offers it: the held state, and the three writes that move it. */
export interface SampleCalls {
  readonly view: (workspace: string) => Promise<SampleHeld>;
  readonly add: (workspace: string) => Promise<void>;
  readonly remove: (workspace: string) => Promise<{ readonly batchId: string; readonly records: number }>;
  readonly undoRemove: (workspace: string, batchId: string) => Promise<void>;
  /** Reads the state again: the add's job ended (`onJobFinished`). */
  readonly refresh: (workspace: string) => void;
  /** Forgets what is held: the session ended. */
  readonly clear: () => void;
}

/** Builds them over `deps`, with one held store for every screen that shows the state. */
export function createSampleCalls(deps: SampleDeps): SampleCalls {
  let store: SampleStore | undefined;
  const held = (): SampleStore => (store ??= createSampleStore({ get: deps.api.get }));
  /** Sample data's held state reads again, for every screen showing it. */
  const moved = (workspace: string): void => {
    store?.refresh(workspace);
  };
  return {
    view: (workspace) => Promise.resolve(held().of(workspace)),
    add: async (workspace) => {
      const { jobId } = await deps.api.add(workspace, deps.mintId());
      moved(workspace);
      deps.followJob(workspace, jobId);
    },
    remove: async (workspace) => {
      const batchId = deps.mintId();
      const moveds = await deps.api.remove(workspace, batchId, deps.mintId());
      deps.reloadRecords(workspace);
      deps.trashMoved(workspace);
      moved(workspace);
      return { batchId, records: moveds.records };
    },
    refresh: moved,
    clear: () => {
      store?.clear();
    },
    undoRemove: async (workspace, batchId) => {
      await deps.api.undoRemove(workspace, batchId, deps.mintId());
      deps.reloadRecords(workspace);
      deps.trashMoved(workspace);
      moved(workspace);
    },
  };
}
