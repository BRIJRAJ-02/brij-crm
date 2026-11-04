// Bookings live (B-17, bookings QA, 4 Nov 2026): a `bookings` change event (a booking made on a public page or in
// chat, moved, cancelled or answered, in any tab) reads Bookings' held reads again in place. The event names
// nothing, so every tab of the workspace hears it; each tab reads only what a screen holds, once for a burst, after a
// random 0 to 2 seconds (the house spread for an event naming nothing), and at most once every `BOOKINGS_EVENT_GAP_MS`
// per workspace, the events between joining one trailing read. A hidden tab reads nothing: its return to view reads
// the held ones anyway (`fresh.ts`). So steady bookings traffic costs a tab one read of its held views every few
// seconds at most, not one per event. First load, tiny, no runtime imports.
import type { LiveRouter } from '../live/router.ts';
import { browserVisible } from './fresh.ts';

/** The random wait between a `bookings` event and the read it starts, in ms: spread so a team never reads in step. */
export const BOOKINGS_EVENT_SPREAD_MS = 2_000;

/** The least time between two reads one workspace's events start in a tab, in ms. */
export const BOOKINGS_EVENT_GAP_MS = 4_000;

/** What following bookings events needs: the clock, the spread and visibility, with browser defaults; tests pass their own. */
export interface FollowBookingsDeps {
  /** Runs `run` after `ms`. A timer by default. */
  readonly later?: (run: () => void, ms: number) => void;
  /** A number in [0, 1), to spread the wait (`Math.random`). */
  readonly random?: () => number;
  /** Now, in ms (`Date.now`). */
  readonly now?: () => number;
  /** Whether the page shows: a hidden tab reads on its return instead. */
  readonly isVisible?: () => boolean;
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
  const now = deps.now ?? Date.now;
  const isVisible = deps.isVisible ?? browserVisible;
  const due = new Set<string>();
  const lastRead = new Map<string, number>();
  return router.on('bookings', (workspace) => {
    if (due.has(workspace)) return;
    due.add(workspace);
    const spread = Math.round(random() * BOOKINGS_EVENT_SPREAD_MS);
    const gap = (lastRead.get(workspace) ?? Number.NEGATIVE_INFINITY) + BOOKINGS_EVENT_GAP_MS - now();
    later(
      () => {
        due.delete(workspace);
        if (!isVisible()) return;
        lastRead.set(workspace, now());
        refresh(workspace);
      },
      Math.max(spread, gap),
    );
  });
}
