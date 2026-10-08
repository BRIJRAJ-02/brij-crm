// This tab's writes still waiting for their echo (spec 0005, live patches):
// a change event carrying one of these mutation ids is this tab's own write
// coming back, which its answer already showed, so nothing is fetched again.
// Kept in the first load (it is tiny), so a write sent before the live client
// has loaded is still known when its echo arrives.

/** How long a write's id waits for its echo before it is forgotten: the channel's history, 5 minutes. */
export const ECHO_WAIT_MS = 5 * 60_000;

/** This tab's mutation ids in flight, each forgotten after its echo, its refusal, or 5 minutes. */
export interface MutationLog {
  /** A write is about to go out with `mutationId`. */
  readonly sent: (mutationId: string) => void;
  /** The write was refused (or never arrived): no event will carry it. */
  readonly forget: (mutationId: string) => void;
  /** Whether an event's `mutationId` is one of this tab's writes; it is forgotten once it has echoed. */
  readonly echoed: (mutationId: string | undefined) => boolean;
  readonly clear: () => void;
}

/** A log of this tab's writes; `now` (unix ms) is the clock, for tests. */
export function createMutationLog(now: () => number = () => Date.now()): MutationLog {
  const sentAt = new Map<string, number>();
  return {
    sent: (mutationId) => {
      const time = now();
      // An echo that never came (a write that changed nothing stores no event): let it go.
      for (const [id, at] of sentAt) if (time - at > ECHO_WAIT_MS) sentAt.delete(id);
      sentAt.set(mutationId, time);
    },
    forget: (mutationId) => {
      sentAt.delete(mutationId);
    },
    echoed: (mutationId) => mutationId !== undefined && sentAt.delete(mutationId),
    clear: () => {
      sentAt.clear();
    },
  };
}
