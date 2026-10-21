import type { TaskTotal } from '@crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createDueTasks } from './due.ts';

/** A badge store over a count answered by hand. */
function world() {
  const timers: { run: () => void; ms: number }[] = [];
  const asked: { workspace: string; today: string; answer: (total: TaskTotal) => void; fail: () => void }[] = [];
  const due = createDueTasks({
    count: (workspace, today) =>
      new Promise((resolve, reject) => {
        asked.push({ workspace, today, answer: resolve, fail: () => reject(new Error('Offline')) });
      }),
    setTimeout: (run, ms) => {
      timers.push({ run, ms });
    },
    random: () => 0.5,
  });
  return { due, asked, timers };
}

describe('the Tasks badge', () => {
  it('reads while held, by workspace and date, and again on a change, never two reads at once', async () => {
    const w = world();
    const source = w.due.source('acme', '2026-10-21');
    expect(source.getSnapshot()).toEqual({ status: 'loading' });
    const release = source.retain();
    expect(w.asked.map((ask) => [ask.workspace, ask.today])).toEqual([['acme', '2026-10-21']]);
    const seen = vi.fn();
    source.subscribe(seen);
    w.asked[0]?.answer({ count: 3, atLeast: false });
    await vi.waitFor(() => {
      expect(source.getSnapshot()).toEqual({ status: 'ready', count: 3, atLeast: false });
    });
    expect(seen).toHaveBeenCalledTimes(1);

    // Two changes while a read is out: one more read once it ends.
    w.due.changed('acme');
    w.due.changed('acme');
    w.due.changed('other');
    expect(w.asked).toHaveLength(2);
    w.asked[1]?.answer({ count: 3, atLeast: false });
    await vi.waitFor(() => {
      expect(w.asked).toHaveLength(3);
    });
    // The same count again redraws nothing.
    expect(seen).toHaveBeenCalledTimes(1);
    w.asked[2]?.answer({ count: 2, atLeast: false });
    await vi.waitFor(() => {
      expect(source.getSnapshot()).toEqual({ status: 'ready', count: 2, atLeast: false });
    });

    // A failed read keeps the count shown; nobody holding it, a change reads nothing.
    w.due.changed('acme');
    w.asked[3]?.fail();
    await Promise.resolve();
    await Promise.resolve();
    expect(source.getSnapshot()).toEqual({ status: 'ready', count: 2, atLeast: false });
    release();
    w.due.changed('acme');
    w.due.changedLater('acme');
    expect(w.asked).toHaveLength(4);
    expect(w.timers).toHaveLength(0);
  });

  it('draws nothing for a count that couldn’t be read', async () => {
    const w = world();
    const source = w.due.source('acme', '2026-10-21');
    source.retain();
    w.asked[0]?.fail();
    await vi.waitFor(() => {
      expect(source.getSnapshot()).toEqual({ status: 'error' });
    });
  });

  it('reads for other people’s changes at most once in five seconds and a random moment, however many come', async () => {
    const w = world();
    const source = w.due.source('acme', '2026-10-21');
    source.retain();
    w.asked[0]?.answer({ count: 1, atLeast: false });
    await vi.waitFor(() => {
      expect(source.getSnapshot()).toMatchObject({ status: 'ready', count: 1 });
    });
    for (let n = 0; n < 20; n += 1) w.due.changedLater('acme');
    expect(w.timers.map((timer) => timer.ms)).toEqual([6_000]);
    expect(w.asked).toHaveLength(1);
    w.timers[0]?.run();
    expect(w.asked).toHaveLength(2);
    // Signed out: a badge still shown draws nothing until it reads again.
    w.due.clear();
    expect(source.getSnapshot()).toEqual({ status: 'loading' });
  });
});
