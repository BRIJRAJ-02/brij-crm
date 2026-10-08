// This tab's writes whose echoes are still due (spec 0006, AC-60): a change
// event carrying one of these mutation ids is this tab's own write coming
// back, which its answer already showed, so nothing is fetched again. Kept in
// the first load (it is tiny), so a write sent before the live client has
// loaded is still known when its echo arrives.
//
// An id is kept from the moment its write is sent until its answer, then
// until as many echoes as the answer's `echoes` (one per object the write
// touched) have arrived, or 60 seconds after the answer, whichever is first.

/** How long an answered write's id waits for the rest of its echoes: 60 seconds (`ECHO_TTL_MS`). */
export const ECHO_TTL_MS = 60_000;

/** How long a write with no answer yet keeps its id: a call that never settles shouldn't hold it for the session. */
export const UNANSWERED_MS = 5 * 60_000;

/** This tab's mutation ids whose echoes are due. */
export interface MutationLog {
  /** A write is about to go out with `mutationId`: its echoes are due from now. */
  readonly sent: (mutationId: string) => void;
  /** The write's answer came: `echoes` events carry its id (0 for a write that changed nothing). */
  readonly answered: (mutationId: string, echoes: number) => void;
  /** The write was refused (or never arrived): no event will carry it. */
  readonly forget: (mutationId: string) => void;
  /**
   * Whether an event (its `seq`) with this `mutationId` is one of this tab's
   * writes coming back while its echoes are due. A repeat of a `seq` counts
   * once; the id goes once every echo the answer named has come.
   */
  readonly echoed: (mutationId: string | undefined, seq?: number) => boolean;
  /** How many ids are kept now (for tests). */
  readonly size: () => number;
  readonly clear: () => void;
}

interface Due {
  readonly sentAt: number;
  answeredAt?: number;
  expected?: number;
  readonly seen: Set<number>;
}

/** A log of this tab's writes; `now` (unix ms) is the clock, for tests. */
export function createMutationLog(now: () => number = () => Date.now()): MutationLog {
  const due = new Map<string, Due>();
  /** Lets go of ids whose time is up: 60 seconds after their answer, or 5 minutes with none. */
  const prune = () => {
    const time = now();
    for (const [id, entry] of due) {
      const over =
        entry.answeredAt === undefined ? time - entry.sentAt > UNANSWERED_MS : time - entry.answeredAt > ECHO_TTL_MS;
      if (over) due.delete(id);
    }
  };
  const settleIfDone = (id: string, entry: Due) => {
    if (entry.expected !== undefined && entry.seen.size >= entry.expected) due.delete(id);
  };
  return {
    sent: (mutationId) => {
      prune();
      due.set(mutationId, { sentAt: now(), seen: new Set() });
    },
    answered: (mutationId, echoes) => {
      prune();
      const entry = due.get(mutationId);
      if (entry === undefined) return;
      entry.answeredAt = now();
      entry.expected = echoes;
      settleIfDone(mutationId, entry);
    },
    forget: (mutationId) => {
      due.delete(mutationId);
    },
    echoed: (mutationId, seq) => {
      if (mutationId === undefined) return false;
      prune();
      const entry = due.get(mutationId);
      if (entry === undefined) return false;
      // An event with no seq (a test, say) counts as one more echo.
      entry.seen.add(seq ?? -entry.seen.size - 1);
      settleIfDone(mutationId, entry);
      return true;
    },
    size: () => due.size,
    clear: () => {
      due.clear();
    },
  };
}
