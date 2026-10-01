// AC-11: relative times update while shown, from one shared clock that ticks
// every 30 seconds and pauses while the tab is hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK_TICK_MS, createClock, createFixedClock, type ClockVisibility } from './clock.ts';

function fakePage(): ClockVisibility & { hide(): void; show(): void } {
  const listeners = new Set<() => void>();
  const page = {
    hidden: false,
    addEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.delete(listener),
    hide() {
      page.hidden = true;
      for (const listener of listeners) listener();
    },
    show() {
      page.hidden = false;
      for (const listener of listeners) listener();
    },
  };
  return page;
}

describe('createClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one stable time between ticks and moves on each tick', () => {
    const clock = createClock();
    const listener = vi.fn();
    clock.subscribe(listener);
    const first = clock.now();
    vi.advanceTimersByTime(CLOCK_TICK_MS - 1);
    expect(clock.now()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(first + CLOCK_TICK_MS);
  });

  it('runs only while someone listens', () => {
    const clock = createClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    unsubscribe();
    vi.advanceTimersByTime(CLOCK_TICK_MS * 3);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses while the page is hidden and ticks at once when it is shown', () => {
    const page = fakePage();
    const clock = createClock({ visibility: page });
    const listener = vi.fn();
    clock.subscribe(listener);
    page.hide();
    vi.advanceTimersByTime(CLOCK_TICK_MS * 4);
    expect(listener).not.toHaveBeenCalled();
    page.show();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(1_000 + CLOCK_TICK_MS * 4);
  });
});

describe('createFixedClock', () => {
  it('never moves', () => {
    const clock = createFixedClock(42);
    const unsubscribe = clock.subscribe(() => undefined);
    expect(clock.now()).toBe(42);
    unsubscribe();
  });
});
