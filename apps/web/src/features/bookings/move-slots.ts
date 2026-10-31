// Where a booking may be dragged to on the week, from the times its page offers (spec 0025, AC-640): the pure
// part of the drag, so the rules are tested without a screen. A booking can land where the page offers its
// start for the length it would have; asking the server for each place the pointer passes would be a read per
// pixel, so the screen reads the page's times once and these answer from them.

/** A booking as the drag sees it: when it starts and how long it runs. */
export interface BookingShape {
  readonly startMs: number;
  readonly minutes: number;
}

/**
 * Whether a booking may land at `to`, from the starts the page offers for that length (`offered`, in milliseconds,
 * undefined until read). Where it began, or at the same start and no longer, it always may: that is its own time.
 * undefined while the page's times aren't known yet, so the drop is left to the server.
 */
export function mayLand(
  own: BookingShape,
  to: BookingShape,
  offered: ReadonlySet<number> | undefined,
): boolean | undefined {
  if (to.startMs === own.startMs && to.minutes <= own.minutes) return true;
  return offered === undefined ? undefined : offered.has(to.startMs);
}

/**
 * The step a page's times keep, in minutes: the shortest gap between two of them. A page that offers a time every
 * half hour gives 30; one with no step offers one every meeting length. undefined for fewer than two times.
 */
export function stepOfStarts(starts: readonly number[]): number | undefined {
  const sorted = [...new Set(starts)].toSorted((a, b) => a - b);
  let least: number | undefined;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = ((sorted[index] ?? 0) - (sorted[index - 1] ?? 0)) / 60_000;
    if (gap > 0 && (least === undefined || gap < least)) least = gap;
  }
  return least === undefined ? undefined : Math.round(least);
}

/** A week's block is `<booking id>:<day>`: the booking's id is everything before the last colon. */
export function bookingIdOfBlock(blockId: string): string {
  const cut = blockId.lastIndexOf(':');
  return cut === -1 ? blockId : blockId.slice(0, cut);
}

/** How many times a booking may move (the server's `MAX_RESCHEDULES`): the card hides Reschedule at this many. */
export const MOVES_MOST = 5;

/** Whether one more move can be taken back with another: Undo asks the server for a sixth otherwise. */
export const canUndoMove = (reschedules: number): boolean => reschedules + 2 <= MOVES_MOST;
