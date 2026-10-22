// Home's held reads (spec 0041): read when first held, again when the person
// comes back, a failure shown only on a first read, nothing read while unheld.
import { describe, expect, it } from 'vitest';
import { createHomeStore } from './store.ts';

const DAY = { members: [{ memberId: '00000000-0000-4000-8000-000000000001', items: [] }] };

function harness(answers: (() => Promise<typeof DAY>)[]) {
  const calls: string[] = [];
  let comeBack: () => void = () => undefined;
  let clock = 0;
  const store = createHomeStore({
    now: () => clock,
    api: {
      teamToday: ({ from }) => {
        calls.push(`team:${from}`);
        return (answers.shift() ?? (() => Promise.resolve(DAY)))();
      },
      metrics: ({ weekStart }) => {
        calls.push(`metrics:${weekStart}`);
        return Promise.resolve({ people: { thisWeek: 1, lastWeek: 0 } });
      },
      recents: ({ workspace }) => {
        calls.push(`recents:${workspace}`);
        return Promise.resolve({ items: [] });
      },
    },
    onReturn: (refresh) => {
      comeBack = refresh;
      return () => {
        comeBack = () => undefined;
      };
    },
  });
  return {
    store,
    calls,
    comeBack: () => {
      clock += 31_000;
      comeBack();
    },
    comeBackSoon: () => {
      clock += 1_000;
      comeBack();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the home store', () => {
  it('reads Team today when held, again when the person comes back, and never once let go', async () => {
    const { store, calls, comeBack, comeBackSoon } = harness([]);
    const view = store.teamToday('acme', 'a', 'b');
    expect(store.teamToday('acme', 'a', 'b')).toBe(view);
    expect(calls).toEqual([]);
    const release = view.retain();
    await settle();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', members: DAY.members });
    comeBackSoon();
    await settle();
    expect(calls).toEqual(['team:a']);
    comeBack();
    await settle();
    expect(calls).toEqual(['team:a', 'team:a']);
    release();
    comeBack();
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('shows a first read’s failure, and keeps what is shown when a later read fails', async () => {
    const { store, comeBack } = harness([
      () => Promise.reject(new Error('down')),
      () => Promise.resolve(DAY),
      () => Promise.reject(new Error('down again')),
    ]);
    const view = store.teamToday('acme', 'a', 'b');
    view.retain();
    await settle();
    expect(view.getSnapshot().status).toBe('error');
    view.reload();
    await settle();
    expect(view.getSnapshot().status).toBe('ready');
    comeBack();
    await settle();
    expect(view.getSnapshot().status).toBe('ready');
  });

  it('holds the metrics row per workspace and week', async () => {
    const { store, calls } = harness([]);
    const view = store.metrics('acme', '2026-11-02T00:00:00.000Z');
    await view.ready();
    expect(view.getSnapshot()).toEqual({ status: 'ready', metrics: { people: { thisWeek: 1, lastWeek: 0 } } });
    expect(calls).toEqual(['metrics:2026-11-02T00:00:00.000Z']);
  });

  it('reads Recently viewed when first held after a while away, never twice for a fresh answer', async () => {
    const { store, calls, comeBack, comeBackSoon } = harness([]);
    const view = store.recents('acme');
    // The route's prewarm answers; the screen holding it right after asks nothing more.
    await view.ready();
    const release = view.retain();
    await settle();
    expect(view.getSnapshot()).toEqual({ status: 'ready', items: [] });
    comeBackSoon();
    await settle();
    expect(calls).toEqual(['recents:acme']);
    release();
    comeBack();
    view.retain();
    await settle();
    expect(calls).toEqual(['recents:acme', 'recents:acme']);
  });
});
