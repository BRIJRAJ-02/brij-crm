// How many heavy reads one workspace may have in flight in this API process
// (spec 0005): records.query and records.count together. A workspace that
// opens more (a runaway client, a script) gets 429 at once, rather than
// queueing on the shared database pool and slowing every other workspace.
import { apiError } from './errors.ts';

/** The most `records.query` and `records.count` calls one workspace runs at once, per API process. */
export const READS_PER_WORKSPACE = 6;

/** The sentence a refused read answers with. */
export const TOO_MANY_READS = 'Too many requests at once. Try again in a moment.';

/** A gate that admits at most a set number of reads per workspace at once. */
export interface ReadGate {
  /**
   * Runs `work` when the workspace has room, and frees its place when the
   * work settles, however it settles (an abort included). With no room,
   * refuses 429 `TOO_MANY_REQUESTS` without running it.
   */
  run<T>(workspaceId: string, work: () => Promise<T>): Promise<T>;
  /** How many reads a workspace has in flight, for tests. */
  inFlight(workspaceId: string): number;
}

/** A gate for one API process. Its counts live in the gate, so each app (and each test app) has its own. */
export function createReadGate(perWorkspace: number = READS_PER_WORKSPACE): ReadGate {
  const counts = new Map<string, number>();
  const inFlight = (workspaceId: string) => counts.get(workspaceId) ?? 0;
  return {
    inFlight,
    async run(workspaceId, work) {
      const running = inFlight(workspaceId);
      if (running >= perWorkspace) throw apiError('TOO_MANY_REQUESTS', TOO_MANY_READS);
      counts.set(workspaceId, running + 1);
      try {
        return await work();
      } finally {
        const left = inFlight(workspaceId) - 1;
        if (left > 0) counts.set(workspaceId, left);
        else counts.delete(workspaceId);
      }
    },
  };
}
