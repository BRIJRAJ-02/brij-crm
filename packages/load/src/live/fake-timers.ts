// A hand driven clock and timer queue for the live tests: `advance` runs
// every timer due in order, letting promises settle between them.

/** Lets every pending promise and immediate settle. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A clock that moves only when told, with the timers due on it. */
export function fakeTimers(start = 0) {
  let time = start;
  const queue: { at: number; order: number; run: () => void }[] = [];
  let order = 0;
  return {
    now: () => time,
    schedule: (ms: number, run: () => void) => {
      queue.push({ at: time + Math.max(0, ms), order: (order += 1), run });
    },
    /** Moves the clock `ms` on, running each timer due on the way at its moment. */
    advance: async (ms: number) => {
      const end = time + ms;
      await settle();
      for (;;) {
        queue.sort((left, right) => left.at - right.at || left.order - right.order);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        time = next.at;
        next.run();
        await settle();
      }
      time = end;
      await settle();
    },
  };
}
