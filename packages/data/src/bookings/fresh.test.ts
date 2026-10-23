// Keeping a held Bookings read current (owner ask A115), against a clock, a page and live updates moved by hand: read
// at once and on every return, every minute while live updates are paused or off and the page shows, never while it
// is hidden or a read is out, waiting twice as long after each failure, and nothing once stopped.
import { describe, expect, it } from 'vitest';
import { FRESH_EVERY_MS, FRESH_MAX_MS, keepFresh } from './fresh.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A clock moved by hand: `advance` runs every timer that comes due, in order. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  return {
    later: (run: () => void, ms: number) => {
      next += 1;
      const id = next;
      timers.set(id, { at: now + ms, run });
      return () => {
        timers.delete(id);
      };
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
    /** The waits set now, from now. */
    pending: () => [...timers.values()].map((timer) => timer.at - now),
  };
}

function setup(
  options: {
    readonly status?: 'live' | 'paused' | 'off';
    readonly random?: number;
    /** Whether each read lands, in turn; every read past them lands. */
    readonly answers?: readonly boolean[];
  } = {},
) {
  const clock = fakeClock();
  const page = { visible: true };
  let status = options.status ?? 'off';
  const liveListeners = new Set<() => void>();
  let comeBack: (() => void) | undefined;
  const answers = [...(options.answers ?? [])];
  let reads = 0;
  let out: ((landed: boolean) => void) | undefined;
  const gate = { held: false };
  const read = () => {
    reads += 1;
    if (gate.held) {
      return new Promise<boolean>((resolve) => {
        out = resolve;
      });
    }
    return Promise.resolve(answers.shift() ?? true);
  };
  const fresh = keepFresh(read, {
    onReturn: (refresh) => {
      comeBack = refresh;
      return () => {
        comeBack = undefined;
      };
    },
    isVisible: () => page.visible,
    live: {
      status: () => status,
      subscribe: (listener) => {
        liveListeners.add(listener);
        return () => liveListeners.delete(listener);
      },
    },
    later: clock.later,
    random: () => options.random ?? 0.5,
  });
  return {
    fresh,
    clock,
    page,
    gate,
    reads: () => reads,
    comeBack: () => comeBack?.(),
    listening: () => comeBack !== undefined || liveListeners.size > 0,
    release: (landed: boolean) => out?.(landed),
    setStatus(next: 'live' | 'paused' | 'off') {
      status = next;
      for (const listener of liveListeners) listener();
    },
  };
}

describe('keeping a held Bookings read current', () => {
  it('reads at once, then every minute while live updates are off and the page shows, and stops when let go', async () => {
    const held = setup();
    expect(held.reads()).toBe(1);
    await settle();
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
    held.clock.advance(FRESH_EVERY_MS - 1);
    expect(held.reads()).toBe(1);
    held.clock.advance(1);
    expect(held.reads()).toBe(2);
    await settle();
    held.clock.advance(FRESH_EVERY_MS);
    expect(held.reads()).toBe(3);
    await settle();
    held.fresh.stop();
    expect(held.clock.pending()).toEqual([]);
    expect(held.listening()).toBe(false);
    held.clock.advance(10 * FRESH_EVERY_MS);
    held.comeBack();
    expect(held.reads()).toBe(3);
  });

  it('spreads each wait by a tenth either way', async () => {
    const early = setup({ random: 0 });
    await settle();
    expect(early.clock.pending()).toEqual([FRESH_EVERY_MS * 0.9]);
    const late = setup({ random: 0.999_999 });
    await settle();
    expect(late.clock.pending()[0]).toBeCloseTo(FRESH_EVERY_MS * 1.1, -1);
  });

  it('reads nothing on a timer while live updates arrive, and starts and stops as they stop and come back', async () => {
    const held = setup({ status: 'live' });
    await settle();
    expect(held.clock.pending()).toEqual([]);
    held.setStatus('paused');
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
    held.clock.advance(FRESH_EVERY_MS / 2);
    // Another change that still isn't live keeps the wait already running.
    held.setStatus('off');
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS / 2]);
    held.setStatus('live');
    expect(held.clock.pending()).toEqual([]);
    held.clock.advance(10 * FRESH_EVERY_MS);
    expect(held.reads()).toBe(1);
    // Live, the person's return still reads it.
    held.comeBack();
    expect(held.reads()).toBe(2);
  });

  it('rests while the page is hidden, and reads at once when the person comes back', async () => {
    const held = setup();
    await settle();
    held.page.visible = false;
    held.clock.advance(FRESH_EVERY_MS);
    expect(held.reads()).toBe(1);
    expect(held.clock.pending()).toEqual([]);
    held.clock.advance(10 * FRESH_EVERY_MS);
    expect(held.reads()).toBe(1);
    held.page.visible = true;
    held.comeBack();
    expect(held.reads()).toBe(2);
    await settle();
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
  });

  it('never starts a read while one is out, and waits the minute from when it lands', async () => {
    const held = setup();
    await settle();
    held.gate.held = true;
    held.clock.advance(FRESH_EVERY_MS);
    expect(held.reads()).toBe(2);
    expect(held.clock.pending()).toEqual([]);
    held.comeBack();
    held.fresh.now();
    expect(held.reads()).toBe(2);
    held.clock.advance(5_000);
    held.gate.held = false;
    held.release(true);
    await settle();
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
  });

  it('waits twice as long after each failed read, at most ten minutes, and a minute again once one lands', async () => {
    const held = setup({ answers: [false, false, false, false, false, false, true] });
    await settle();
    expect(held.clock.pending()).toEqual([2 * FRESH_EVERY_MS]);
    const waits: number[] = [];
    for (let each = 0; each < 6; each += 1) {
      const [wait = 0] = held.clock.pending();
      waits.push(wait);
      held.clock.advance(wait);
      await settle();
    }
    expect(waits).toEqual([
      2 * FRESH_EVERY_MS,
      4 * FRESH_EVERY_MS,
      8 * FRESH_EVERY_MS,
      FRESH_MAX_MS,
      FRESH_MAX_MS,
      FRESH_MAX_MS,
    ]);
    expect(held.reads()).toBe(7);
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
  });

  it('reads at once when asked (Sync now ran), and starts the minute again', async () => {
    const held = setup();
    await settle();
    held.clock.advance(FRESH_EVERY_MS / 2);
    held.fresh.now();
    expect(held.reads()).toBe(2);
    await settle();
    expect(held.clock.pending()).toEqual([FRESH_EVERY_MS]);
  });
});
