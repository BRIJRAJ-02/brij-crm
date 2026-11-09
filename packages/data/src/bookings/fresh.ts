// Keeping Bookings' held reads current (owner ask A115: new meetings show up
// by themselves, with no Sync now). Bookings, its week and its list of every
// meeting have no change event of their own, and where live updates are off
// (production on Vercel Functions, spec 0045) none would come anyway. So while
// a screen holds one, it is read when first held (unless a read landed just
// before, as the route's loader's did), again whenever the person comes back
// to the page (the window's focus or the tab shown again, one read for both),
// and,
// while live updates are paused or off, every minute while the page shows:
// never while it is hidden, never while a read is out, and each wait spread by
// a random tenth either way, so a team's tabs don't read in step. A failed
// read doubles the wait, up to 10 minutes; one that lands starts the minute
// again. A screen holds one such read at a time (the week, the list, or Home's
// today), so 100 people online read about 1.7 times a second at most.

/** The wait between timed reads while they land. */
export const FRESH_EVERY_MS = 60_000;

/** The longest wait: each failed read doubles it, up to this. */
export const FRESH_MAX_MS = 10 * 60_000;

/** How far a wait is spread, either way, as a share of it. */
const SPREAD = 0.1;

/**
 * How recent a landed read may be for a first hold to skip its own: the route's loader read it a moment before the
 * screen held it, so reading it again at once only doubled every visit's request.
 */
export const FRESH_RECENT_MS = 5_000;

/** How close together the return signals count as one return: a tab shown again fires visible and focus both. */
export const RETURN_ONCE_MS = 1_000;

/**
 * The browser's return signal: the window's focus and the document becoming visible. One return fires both, so a
 * second signal within `RETURN_ONCE_MS` of the first is the same return and calls nothing.
 */
export function browserReturn(refresh: () => void, now: () => number = Date.now): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  let lastAt = Number.NEGATIVE_INFINITY;
  const once = () => {
    const at = now();
    if (at - lastAt < RETURN_ONCE_MS) return;
    lastAt = at;
    refresh();
  };
  const onFocus = () => {
    once();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') once();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Whether the page shows: the document's visibility, and always where there is no document. */
export function browserVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** What keeping a held read current needs. Every part has a browser default; tests pass their own. */
export interface FreshDeps {
  /** Calls `refresh` whenever the person comes back to the page (focus, visible again); answers how to stop. */
  readonly onReturn?: (refresh: () => void) => () => void;
  /** Whether the page shows now: a hidden page reads nothing on the timer. */
  readonly isVisible?: () => boolean;
  /**
   * Whether other people's changes arrive (`data.live`): the timer runs only while they don't (`paused`, `off`).
   * Always `live` when absent, so nothing reads on a timer.
   */
  readonly live?: {
    readonly status: () => 'live' | 'paused' | 'off';
    readonly subscribe: (listener: () => void) => () => void;
  };
  /** Runs `run` after `ms`; the answer cancels it. A timer by default. */
  readonly later?: (run: () => void, ms: number) => () => void;
  /** A number in [0, 1), to spread the waits (`Math.random`). */
  readonly random?: () => number;
  /** The clock, in epoch milliseconds (`Date.now`): how long ago the last read landed. */
  readonly now?: () => number;
}

/** What one held read says about itself when a screen first holds it. */
export interface FreshStart {
  /** When its last read landed (epoch milliseconds), if one has: within `FRESH_RECENT_MS`, the first read is skipped. */
  readonly landedAt?: number | undefined;
}

/** One held read kept current, until `stop`. */
export interface Freshness {
  /** Reads it now (unless a read is out) and starts the wait again: a change the reader expects to see. */
  readonly now: () => void;
  /** Stops reading it: no screen holds it any more. */
  readonly stop: () => void;
}

/**
 * Keeps one held read current, as the header says: `read` at once (unless `start.landedAt` is recent), on every
 * return, and on the minute timer while live updates are paused or off. `read` answers whether it landed, and never
 * overlaps another of these reads.
 */
export function keepFresh(read: () => Promise<boolean>, deps: FreshDeps = {}, start: FreshStart = {}): Freshness {
  const onReturn = deps.onReturn ?? browserReturn;
  const isVisible = deps.isVisible ?? browserVisible;
  const later =
    deps.later ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => {
        clearTimeout(timer);
      };
    });
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const isLive = () => (deps.live?.status() ?? 'live') === 'live';
  let wait = FRESH_EVERY_MS;
  let cancel: (() => void) | undefined;
  let reading = false;
  // A read asked for while one was out (a change event, B-17): that read began before the change, so one more follows.
  let again = false;
  let stopped = false;

  const clear = () => {
    cancel?.();
    cancel = undefined;
  };
  /** The next timed read, while live updates are paused or off and the page shows; none while a read is out. */
  const schedule = () => {
    clear();
    if (stopped || reading || isLive() || !isVisible()) return;
    cancel = later(tick, Math.round(wait * (1 - SPREAD + random() * 2 * SPREAD)));
  };
  const run = () => {
    if (stopped) return;
    if (reading) {
      again = true;
      return;
    }
    clear();
    reading = true;
    const settle = (landed: boolean) => {
      reading = false;
      wait = landed ? FRESH_EVERY_MS : Math.min(FRESH_MAX_MS, wait * 2);
      if (again) {
        again = false;
        run();
        return;
      }
      schedule();
    };
    read().then(settle, () => {
      settle(false);
    });
  };
  // Hidden, or live again, meanwhile: nothing is read, and the timer rests until the person comes back.
  const tick = () => {
    cancel = undefined;
    if (isLive() || !isVisible()) return;
    run();
  };
  const stopReturn = onReturn(run);
  // Live updates stopped or came back: the timer starts (keeping one already set) or stops.
  const stopLive = deps.live?.subscribe(() => {
    if (isLive()) clear();
    else if (cancel === undefined) schedule();
  });
  // Just read (the loader's read, a moment ago): its minute starts instead of a second read.
  if (start.landedAt !== undefined && now() - start.landedAt < FRESH_RECENT_MS) schedule();
  else run();
  return {
    now: run,
    stop() {
      stopped = true;
      clear();
      stopReturn();
      stopLive?.();
    },
  };
}
