// Bookings live (B-17, bookings QA, 4 Nov 2026): a `bookings` change event (a booking made on a public page or in
// chat, moved, cancelled or answered, in any tab) reads Bookings' held reads again in place. The event names
// nothing, so every tab of the workspace hears it; each tab reads only what a screen holds, once for a burst, after
// 100 ms to a second spread at random, so a team's tabs never read in step. First load, tiny, no runtime imports.
import type { LiveRouter } from '../live/router.ts';

/** The least and most wait between a `bookings` event and the read it starts, in ms. */
export const BOOKINGS_EVENT_WAIT_MS = { least: 100, most: 1_000 } as const;

/** What following bookings events needs: the clock and the spread, both with browser defaults; tests pass their own. */
export interface FollowBookingsDeps {
  /** Runs `run` after `ms`. A timer by default. */
  readonly later?: (run: () => void, ms: number) => void;
  /** A number in [0, 1), to spread the wait (`Math.random`). */
  readonly random?: () => number;
}

/**
 * Calls `refresh(workspace)` once for each burst of `bookings` events on a workspace (`refreshBookings` in the data
 * layer: the held lists, weeks, Team days, the list of every meeting and Home's Team today, each read in place);
 * answers how to stop.
 */
export function followBookings(
  router: Pick<LiveRouter, 'on'>,
  refresh: (workspace: string) => void,
  deps: FollowBookingsDeps = {},
): () => void {
  const later =
    deps.later ??
    ((run: () => void, ms: number) => {
      setTimeout(run, ms);
    });
  const random = deps.random ?? Math.random;
  const due = new Set<string>();
  return router.on('bookings', (workspace) => {
    if (due.has(workspace)) return;
    due.add(workspace);
    const { least, most } = BOOKINGS_EVENT_WAIT_MS;
    later(
      () => {
        due.delete(workspace);
        refresh(workspace);
      },
      least + Math.round(random() * (most - least)),
    );
  });
}
