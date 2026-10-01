// The shared clock behind every relative time ("3 hours ago"). One clock per
// app, made by a factory and handed to UiProvider, so nothing at module level
// ticks and stories can freeze time.

/** How often relative times render again. */
export const CLOCK_TICK_MS = 30_000;

/** A clock that ticks for its subscribers. `now()` is stable between ticks, so React can read it as a snapshot. */
export interface Clock {
  /** Milliseconds since the epoch, as of the last tick. */
  readonly now: () => number;
  /** Calls `listener` on every tick and returns the unsubscribe. The clock only runs while someone listens. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** What the clock needs from the page: whether it is hidden, and word when that changes. */
export interface ClockVisibility {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Options for `createClock`. */
export interface ClockOptions {
  /** Reads the real time. Defaults to `Date.now`. */
  readonly read?: () => number;
  /** Milliseconds between ticks. Defaults to `CLOCK_TICK_MS`. */
  readonly tickMs?: number;
  /** The page (usually `document`). While it is hidden the clock stops, and it ticks at once when shown again. */
  readonly visibility?: ClockVisibility;
}

/** Makes the app's clock: it ticks every 30 seconds while anything subscribes, and pauses while the tab is hidden. */
export function createClock(options: ClockOptions = {}): Clock {
  const read = options.read ?? Date.now;
  const tickMs = options.tickMs ?? CLOCK_TICK_MS;
  const { visibility } = options;
  const listeners = new Set<() => void>();
  let current = read();
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    current = read();
    for (const listener of listeners) listener();
  };
  const start = () => {
    if (timer === undefined && !(visibility?.hidden ?? false)) timer = setInterval(tick, tickMs);
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const onVisibility = () => {
    if (visibility?.hidden ?? false) {
      stop();
      return;
    }
    tick();
    start();
  };

  return {
    now: () => current,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        current = read();
        visibility?.addEventListener('visibilitychange', onVisibility);
        start();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stop();
        visibility?.removeEventListener('visibilitychange', onVisibility);
      };
    },
  };
}

/** A clock frozen at `at` (milliseconds since the epoch), for stories and screenshots. */
export function createFixedClock(at: number): Clock {
  return { now: () => at, subscribe: () => () => undefined };
}
