// The follows store: one read per record shared by every holder, a toggle shown at once and put back with a toast
// when refused, and an older answer never undoing a newer toggle.
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { createFollowsStore, FOLLOWS_KEPT } from './store.ts';

/** An API each call of which waits until the test settles it. */
function setup() {
  const calls: { kind: 'get' | 'set'; settle: (ok: boolean, following?: boolean) => void }[] = [];
  const pending = (kind: 'get' | 'set') =>
    new Promise<{ following: boolean }>((resolve, reject) => {
      calls.push({
        kind,
        settle: (ok, following) => {
          if (ok) resolve({ following: following ?? false });
          else reject(Object.assign(new Error('No.'), { code: 'NOT_FOUND', message: 'That record does not exist.' }));
        },
      });
    });
  const notices: Notice[] = [];
  const store = createFollowsStore({
    api: { get: () => pending('get'), set: () => pending('set') },
    mintId: () => 'm',
    notify: (notice) => notices.push(notice),
  });
  return { calls, notices, store };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the follows store', () => {
  it('reads once for the page and the panel, and shows the answer', async () => {
    const { calls, store } = setup();
    const page = store.forRecord('acme', 'r1');
    expect(store.forRecord('acme', 'r1')).toBe(page);
    page.retain();
    expect(page.getSnapshot()).toEqual({ status: 'loading' });
    calls[0]?.settle(true, true);
    await tick();
    expect(page.getSnapshot()).toEqual({ status: 'ready', following: true });
  });

  it('shows a toggle at once, and puts it back with a toast when refused', async () => {
    const { calls, notices, store } = setup();
    const held = store.forRecord('acme', 'r1');
    held.retain();
    calls[0]?.settle(true, false);
    await tick();
    const landed = store.set('acme', 'r1', true);
    expect(held.getSnapshot()).toEqual({ status: 'ready', following: true });
    calls[1]?.settle(false);
    expect(await landed).toBe(false);
    expect(held.getSnapshot()).toEqual({ status: 'ready', following: false });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.tone).toBe('danger');
  });

  it('keeps the newest toggle over an older answer', async () => {
    const { calls, store } = setup();
    const held = store.forRecord('acme', 'r1');
    held.retain();
    calls[0]?.settle(true, false);
    await tick();
    void store.set('acme', 'r1', true);
    void store.set('acme', 'r1', false);
    calls[1]?.settle(true, true);
    await tick();
    expect(held.getSnapshot()).toEqual({ status: 'ready', following: false });
    calls[2]?.settle(true, false);
    await tick();
    expect(held.getSnapshot()).toEqual({ status: 'ready', following: false });
  });

  it('keeps at most a bounded number of records', () => {
    const { store } = setup();
    const first = store.forRecord('acme', 'r0');
    for (let index = 1; index <= FOLLOWS_KEPT; index += 1) store.forRecord('acme', `r${String(index)}`);
    expect(store.forRecord('acme', 'r0')).not.toBe(first);
  });
});
