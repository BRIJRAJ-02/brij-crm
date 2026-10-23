// The console's "last active" (spec 0047, AC-1624): a signed in request notes
// its person's day, at most once per person every 10 minutes in this process,
// never awaited by the request. A failure is logged and dropped: it never
// fails or slows the request.

/** How often one person's day is written from one process. */
export const ACTIVITY_EVERY_MS = 10 * 60 * 1000;

/** The most people one process remembers; past it, the longest unseen go first. */
const REMEMBERED_MAX = 10_000;

/** What noting a day needs: the write, a way to keep the process alive for it, and the log. */
export interface ActivityDeps {
  readonly note: (userId: string) => Promise<void>;
  readonly keepAlive: (work: Promise<unknown>) => void;
  readonly onError: (error: unknown) => void;
  readonly now?: () => number;
  readonly everyMs?: number;
}

/** The throttled note, one per app. */
export function createActivityNoter(deps: ActivityDeps): (userId: string) => void {
  const now = deps.now ?? Date.now;
  const every = deps.everyMs ?? ACTIVITY_EVERY_MS;
  // When each person was last written from here: one map per app (the factory's own state).
  const written = new Map<string, number>();
  return (userId) => {
    const at = now();
    const last = written.get(userId);
    if (last !== undefined && at - last < every) return;
    written.delete(userId);
    written.set(userId, at);
    if (written.size > REMEMBERED_MAX) {
      const oldest = written.keys().next();
      if (oldest.done !== true) written.delete(oldest.value);
    }
    deps.keepAlive(deps.note(userId).catch(deps.onError));
  };
}
