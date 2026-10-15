// The worker's lifecycle (spec 0008, Letting the database sleep; AC-111,
// AC-117), driven by a clock the tests move: it sleeps only after an idle
// spell with no task in flight and nothing waiting, closes the runners before
// the relay, wakes on a wake call or at its wake time, keeps a wake that
// arrives while it closes, retries a failed wake with backoff without ever
// throwing, and reconnects when a runner stops on its own.
import type { SleepCheck } from '@crm/db';
import { describe, expect, it } from 'vitest';
import {
  createLifecycle,
  CRON_LEAD_MS,
  MAX_SLEEP_MS,
  nextDailyCron,
  wakeTime,
  type AwakeWorker,
  type LifecycleClock,
  type LifecycleRelay,
} from './lifecycle.ts';

/** A clock the tests move; due timers run as it passes them. */
function manualClock(start = Date.parse('2026-10-15T10:00:00Z')) {
  let at = start;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: LifecycleClock = {
    now: () => at,
    setTimeout: (run, ms) => {
      next += 1;
      timers.set(next, { at: at + ms, run });
      return next;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  /** Lets every pending promise settle. */
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    clock,
    /** Moves the clock on by `ms`, running each timer that falls due, in order. */
    async advance(ms: number) {
      const until = at + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        at = Math.max(at, due[1].at);
        due[1].run();
        await settle();
      }
      at = until;
      await settle();
    },
    settle,
    /** When the one pending timer fires, or undefined. */
    pending: () => [...timers.values()].map((timer) => timer.at),
  };
}

/** What the queue says: nothing waiting, by default. */
function quietCheck(now: number, changes: Partial<SleepCheck> = {}): SleepCheck {
  return { locked: false, nextRunAt: undefined, unpublished: false, now: new Date(now), ...changes };
}

/** A fake worker side: each open hands out a new awake worker, recording what happens. */
function fakeWorld(clock: ReturnType<typeof manualClock>) {
  const events: string[] = [];
  let busy = 0;
  let check: (now: number) => SleepCheck = (now) => quietCheck(now);
  let failOpens = 0;
  let hooks: { onActivity: () => void; onFailed: (error: unknown) => void } | undefined;
  let relayMode: 'active' | 'dormant' | 'stopped' = 'active';
  const relay: LifecycleRelay = {
    wake: () => {
      events.push('relay.wake');
      relayMode = 'active';
    },
    sleep: () => {
      events.push('relay.sleep');
      relayMode = 'dormant';
      return Promise.resolve();
    },
    mode: () => relayMode,
  };
  const open = (given: { onActivity: () => void; onFailed: (error: unknown) => void }): Promise<AwakeWorker> => {
    if (failOpens > 0) {
      failOpens -= 1;
      events.push('open.failed');
      return Promise.reject(new Error('The database is unreachable.'));
    }
    events.push('open');
    hooks = given;
    return Promise.resolve({
      busy: () => busy,
      check: () => {
        events.push('check');
        return Promise.resolve(check(clock.clock.now()));
      },
      close: () => {
        events.push('close');
        return Promise.resolve();
      },
    });
  };
  const lines: string[] = [];
  const log = {
    info: (message: string) => lines.push(message),
    warn: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
  };
  return {
    events,
    lines,
    relay,
    open,
    log,
    setBusy: (n: number) => (busy = n),
    setCheck: (next: (now: number) => SleepCheck) => (check = next),
    failNextOpens: (n: number) => (failOpens = n),
    hooks: () => hooks,
  };
}

function lifecycleIn(idleSleepMs = 2_000) {
  const time = manualClock();
  const world = fakeWorld(time);
  const lifecycle = createLifecycle({
    open: world.open,
    relay: world.relay,
    idleSleepMs,
    log: world.log,
    clock: time.clock,
  });
  return { time, world, lifecycle };
}

describe('the wake time', () => {
  it('is the next due row, the cron less 30 seconds, or a day, whichever comes first', () => {
    const now = Date.parse('2026-10-15T10:00:00Z');
    expect(nextDailyCron(now)).toBe(Date.parse('2026-10-16T03:00:00Z'));
    expect(nextDailyCron(Date.parse('2026-10-15T02:59:59Z'))).toBe(Date.parse('2026-10-15T03:00:00Z'));
    expect(nextDailyCron(Date.parse('2026-10-15T03:00:00Z'))).toBe(Date.parse('2026-10-16T03:00:00Z'));
    expect(wakeTime(quietCheck(now), now)).toBe(Date.parse('2026-10-16T03:00:00Z') - CRON_LEAD_MS);
    const row = new Date(now + 5 * 60_000);
    expect(wakeTime(quietCheck(now, { nextRunAt: row }), now)).toBe(row.getTime());
    // The database's clock 2 seconds ahead: the row's time moves onto this one.
    expect(wakeTime({ ...quietCheck(now + 2_000), nextRunAt: row }, now)).toBe(row.getTime() - 2_000);
    // Never more than a day, whatever the cron says.
    expect(wakeTime(quietCheck(now), now)).toBeLessThanOrEqual(now + MAX_SLEEP_MS);
  });
});

describe('the worker lifecycle', () => {
  it('sleeps after an idle spell with nothing waiting: the runners close before the relay, and the timer is set', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    await lifecycle.start();
    expect(lifecycle.state()).toBe('awake');
    expect(world.events).toEqual(['open', 'relay.wake']);
    await time.advance(1_999);
    expect(lifecycle.state()).toBe('awake');
    await time.advance(1);
    expect(lifecycle.state()).toBe('asleep');
    expect(world.events).toEqual(['open', 'relay.wake', 'check', 'close', 'relay.sleep']);
    expect(world.lines).toContain('Worker asleep');
    // Its timer: the next cron, less 30 seconds.
    expect(time.pending()).toEqual([Date.parse('2026-10-16T03:00:00Z') - CRON_LEAD_MS]);
  });

  it('stays awake while a task runs, a row or queue is locked, an outbox row waits, or a row is due within 30 seconds', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    await lifecycle.start();
    world.setBusy(1);
    await time.advance(5_000);
    expect(lifecycle.state()).toBe('awake');
    world.setBusy(0);
    for (const waiting of [
      (now: number) => quietCheck(now, { locked: true }),
      (now: number) => quietCheck(now, { unpublished: true }),
      (now: number) => quietCheck(now, { nextRunAt: new Date(now + 30_000) }),
    ]) {
      world.setCheck(waiting);
      await time.advance(2_000);
      expect(lifecycle.state()).toBe('awake');
    }
    // A row due in 40 seconds: it sleeps till then.
    let checkedAt = 0;
    world.setCheck((now) => {
      checkedAt = now;
      return quietCheck(now, { nextRunAt: new Date(now + 40_000) });
    });
    await time.advance(2_000);
    expect(lifecycle.state()).toBe('asleep');
    expect(time.pending()).toEqual([checkedAt + 40_000]);
  });

  it('restarts its idle clock on every sign of work', async () => {
    const { time, lifecycle } = lifecycleIn();
    await lifecycle.start();
    for (let i = 0; i < 5; i += 1) {
      await time.advance(1_500);
      lifecycle.touch();
    }
    expect(lifecycle.state()).toBe('awake');
    // A wake call on an awake worker only restarts the clock.
    await time.advance(1_500);
    lifecycle.wake();
    await time.advance(1_500);
    expect(lifecycle.state()).toBe('awake');
    await time.advance(500);
    expect(lifecycle.state()).toBe('asleep');
  });

  it('counts a task call start and end, through the hooks it opened with, as work', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    await lifecycle.start();
    await time.advance(1_500);
    world.hooks()?.onActivity();
    await time.advance(1_500);
    expect(lifecycle.state()).toBe('awake');
    await time.advance(500);
    expect(lifecycle.state()).toBe('asleep');
  });

  it('wakes on a wake call, and at its wake time', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    await lifecycle.start();
    await time.advance(2_000);
    expect(lifecycle.state()).toBe('asleep');
    lifecycle.wake();
    await time.settle();
    expect(lifecycle.state()).toBe('awake');
    expect(world.events.slice(-2)).toEqual(['open', 'relay.wake']);
    expect(world.lines).toContain('Worker awake');
    // Asleep again, then the timer (a row due in 2 minutes) wakes it.
    world.setCheck((now) => quietCheck(now, { nextRunAt: new Date(now + 120_000) }));
    await time.advance(2_000);
    expect(lifecycle.state()).toBe('asleep');
    await time.advance(119_999);
    expect(lifecycle.state()).toBe('asleep');
    await time.advance(1);
    expect(lifecycle.state()).toBe('awake');
  });

  it('keeps a wake that arrives while it closes, and wakes straight after', async () => {
    const time = manualClock();
    const world = fakeWorld(time);
    let release = (): void => undefined;
    const lifecycle = createLifecycle({
      open: async (hooks) => {
        const worker = await world.open(hooks);
        return {
          ...worker,
          close: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        };
      },
      relay: world.relay,
      idleSleepMs: 2_000,
      log: world.log,
      clock: time.clock,
    });
    await lifecycle.start();
    await time.advance(2_000);
    // Closing: a wake call lands.
    expect(lifecycle.state()).toBe('waking');
    lifecycle.wake();
    release();
    await time.settle();
    expect(lifecycle.state()).toBe('awake');
    expect(world.events.filter((event) => event === 'open')).toHaveLength(2);
  });

  it('retries a failed wake with growing waits and never throws, and a stop ends the wait', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    world.failNextOpens(3);
    const started = lifecycle.start();
    await time.settle();
    expect(lifecycle.state()).toBe('waking');
    await time.advance(1_000);
    await time.advance(2_000);
    await time.advance(4_000);
    await started;
    expect(lifecycle.state()).toBe('awake');
    expect(world.events.slice(0, 4)).toEqual(['open.failed', 'open.failed', 'open.failed', 'open']);
    expect(world.lines.filter((line) => line === 'Worker could not wake; trying again')).toHaveLength(3);
    // A stop while a retry waits returns at once.
    await time.advance(2_000);
    world.failNextOpens(10);
    lifecycle.wake();
    await time.settle();
    await lifecycle.stop();
    expect(lifecycle.state()).toBe('stopped');
  });

  it('goes back through waking when a runner stops on its own, and ignores an old runner’s failure', async () => {
    const { time, world, lifecycle } = lifecycleIn();
    await lifecycle.start();
    const first = world.hooks();
    first?.onFailed(new Error('Connection terminated.'));
    await time.settle();
    expect(lifecycle.state()).toBe('awake');
    expect(world.events).toEqual(['open', 'relay.wake', 'close', 'open', 'relay.wake']);
    expect(world.lines).toContain('Worker lost its connection; waking again');
    // The first open's runners are gone: their late failure changes nothing.
    first?.onFailed(new Error('Late.'));
    await time.settle();
    expect(world.events.filter((event) => event === 'open')).toHaveLength(2);
  });

  it('treats a runner that fails while the other still starts as a failed wake, and tries again', async () => {
    const time = manualClock();
    const world = fakeWorld(time);
    let opens = 0;
    const lifecycle = createLifecycle({
      open: async (hooks) => {
        opens += 1;
        const worker = await world.open(hooks);
        // The first open's heavy runner dies before the open returns.
        if (opens === 1) hooks.onFailed(new Error('Connection terminated.'));
        return worker;
      },
      relay: world.relay,
      idleSleepMs: 2_000,
      log: world.log,
      clock: time.clock,
    });
    const started = lifecycle.start();
    await time.settle();
    expect(lifecycle.state()).toBe('waking');
    expect(world.events).toEqual(['open', 'close']);
    await time.advance(1_000);
    await started;
    expect(lifecycle.state()).toBe('awake');
    expect(opens).toBe(2);
  });

  it('wakes straight back when a task ran while it closed for sleep', async () => {
    const time = manualClock();
    const world = fakeWorld(time);
    let release = (): void => undefined;
    const lifecycle = createLifecycle({
      open: async (hooks) => {
        const worker = await world.open(hooks);
        return {
          ...worker,
          close: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        };
      },
      relay: world.relay,
      idleSleepMs: 2_000,
      log: world.log,
      clock: time.clock,
    });
    await lifecycle.start();
    const hooks = world.hooks();
    await time.advance(2_000);
    expect(lifecycle.state()).toBe('waking');
    // A slice Graphile took just after the check runs while the runners stop.
    hooks?.onActivity();
    release();
    await time.settle();
    expect(lifecycle.state()).toBe('awake');
    expect(world.events.filter((event) => event === 'open')).toHaveLength(2);
  });

  it('never sleeps with an idle time of 0', async () => {
    const { time, world, lifecycle } = lifecycleIn(0);
    await lifecycle.start();
    await time.advance(24 * 60 * 60_000);
    expect(lifecycle.state()).toBe('awake');
    expect(world.events).not.toContain('check');
    await lifecycle.stop();
    expect(world.events.at(-1)).toBe('close');
  });
});
