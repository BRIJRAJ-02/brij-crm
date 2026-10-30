// Calendar health in the browser (spec 0037, AC-1307 to AC-1309): one read per page of chips, hidden outside reach,
// read again when stale, and Ask to reconnect's toasts.
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { createCalendarHealthStore, HEALTH_FRESH_MS, type CalendarHealthApi } from './health.ts';

const id = (n: number) => `0199c0de-0000-7000-8000-${String(n).padStart(12, '0')}`;

function world(api: Partial<CalendarHealthApi> = {}) {
  const reads: (readonly string[])[] = [];
  const notices: Notice[] = [];
  const queue: (() => void)[] = [];
  let clock = 1_000;
  const store = createCalendarHealthStore({
    api: {
      read:
        api.read ??
        ((input) => {
          reads.push(input.memberIds);
          // The odd ones are in reach.
          return Promise.resolve({
            members: input.memberIds
              .filter((memberId) => Number(memberId.slice(-1)) % 2 === 1)
              .map((memberId) => ({ memberId, status: 'reconnect' as const, since: '2026-10-29T09:00:00.000Z' })),
          });
        }),
      ask: api.ask ?? (() => Promise.resolve({ askedAt: '2026-10-30T09:00:00.000Z' })),
    },
    notify: (notice) => notices.push(notice),
    now: () => clock,
    schedule: (run) => queue.push(run),
  });
  const flush = async () => {
    for (const run of queue.splice(0)) run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { store, reads, notices, flush, tick: (ms: number) => (clock += ms) };
}

describe('the calendar health store', () => {
  it('reads a page of chips in one call, and leaves out-of-reach members hidden', async () => {
    const w = world();
    const held = [1, 2, 3].map((n) => w.store.held('acme', id(n)));
    held.forEach((each) => each.retain());
    expect(held[0]?.getSnapshot()).toEqual({ status: 'loading' });
    await w.flush();
    expect(w.reads).toEqual([[id(1), id(2), id(3)]]);
    expect(held[0]?.getSnapshot()).toMatchObject({ status: 'ready', health: { status: 'reconnect' }, asked: false });
    expect(held[1]?.getSnapshot()).toEqual({ status: 'hidden' });
  });

  it('asks 50 at most a call, reads a fresh status once, and a stale one again', async () => {
    const w = world();
    const held = Array.from({ length: 120 }, (_, n) => w.store.held('acme', id(n)));
    held.forEach((each) => each.retain());
    await w.flush();
    expect(w.reads.map((each) => each.length)).toEqual([50, 50, 20]);
    held[0]?.retain();
    await w.flush();
    expect(w.reads).toHaveLength(3);
    w.tick(HEALTH_FRESH_MS);
    held[0]?.retain();
    await w.flush();
    expect(w.reads.at(-1)).toEqual([id(0)]);
  });

  it('shows a failed first read, and keeps a shown status when a later one fails', async () => {
    let fail = true;
    const w = world({
      read: (input) =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve({
              members: input.memberIds.map((memberId) => ({ memberId, status: 'connected' as const })),
            }),
    });
    const held = w.store.held('acme', id(1));
    held.retain();
    await w.flush();
    expect(held.getSnapshot()).toMatchObject({ status: 'error' });
    fail = false;
    w.store.shown();
    await w.flush();
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', health: { status: 'connected' } });
    fail = true;
    w.store.shown();
    await w.flush();
    expect(held.getSnapshot()).toMatchObject({ status: 'ready' });
  });

  it('marks a member asked on success and on a 429, with a toast either way', async () => {
    const w = world();
    const held = w.store.held('acme', id(1));
    held.retain();
    await w.flush();
    expect(await w.store.ask('acme', id(1), { asked: 'Asked Bea to reconnect' })).toBe(true);
    expect(held.getSnapshot()).toMatchObject({ asked: true });
    expect(w.notices).toEqual([{ tone: 'success', message: 'Asked Bea to reconnect' }]);
    const limited = world({
      ask: () =>
        Promise.reject(
          Object.assign(new Error('Bea was asked to reconnect in the last day. You can ask again in 5 hours.'), {
            code: 'RATE_LIMITED',
            status: 429,
          }),
        ),
    });
    const other = limited.store.held('acme', id(3));
    other.retain();
    await limited.flush();
    expect(await limited.store.ask('acme', id(3), { asked: 'Asked' })).toBe(false);
    expect(other.getSnapshot()).toMatchObject({ asked: true });
    expect(limited.notices[0]?.tone).toBe('success');
  });
});

describe('the store’s guards', () => {
  it('sends one ask however often it is pressed, and lets a refused one be pressed again', async () => {
    let sent = 0;
    const w = world({
      ask: () => {
        sent += 1;
        return sent === 1 ? Promise.reject(new Error('down')) : Promise.resolve({});
      },
    });
    const first = w.store.ask('acme', id(1), { asked: 'Asked' });
    expect(await w.store.ask('acme', id(1), { asked: 'Asked' })).toBe(false);
    expect(await first).toBe(false);
    expect(sent).toBe(1);
    expect(await w.store.ask('acme', id(1), { asked: 'Asked' })).toBe(true);
    expect(sent).toBe(2);
  });

  it('drops an answer that lands after a sign out', async () => {
    let answer: (value: { members: [] }) => void = () => undefined;
    const w = world({
      read: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    w.store.held('acme', id(1)).retain();
    await w.flush();
    w.store.clear();
    answer({ members: [] });
    await w.flush();
    expect(w.store.held('acme', id(1)).getSnapshot()).toEqual({ status: 'loading' });
  });
});
