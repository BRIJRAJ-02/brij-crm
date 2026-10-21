// The account sessions store against a fake API answered by hand (spec 0033):
// the list read when held and paged, a sign out gone at once and back with a
// toast when refused, and "Sign out of all other devices" leaving only this
// device at once, coming back quietly on STEP_UP_REQUIRED.
import type { AccountSession, SessionPage } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createAccountSessionsStore, type AccountSessionsApi } from './sessions.ts';

const ID = (n: number) => `0199a6f2-0000-7000-8000-00000000000${String(n)}`;
const session = (n: number, current = false): AccountSession => ({
  id: ID(n),
  deviceLabel: 'Chrome on macOS',
  lastActiveAt: '2026-10-21T09:00:00.000Z',
  signedInAt: '2026-10-20T09:00:00.000Z',
  current,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  api: Partial<AccountSessionsApi>,
  pages: SessionPage[] = [{ items: [session(1, true), session(2), session(3)] }],
) {
  const notices: Notice[] = [];
  const cursors: (string | undefined)[] = [];
  let read = 0;
  const store = createAccountSessionsStore({
    api: {
      list: (input) => {
        cursors.push(input.cursor);
        const page = pages[Math.min(read, pages.length - 1)];
        read += 1;
        return page === undefined ? Promise.reject(new Error('no page')) : Promise.resolve(page);
      },
      revoke: () => Promise.resolve({ ok: true }),
      revokeOthers: () => Promise.resolve({ count: 2 }),
      ...api,
    },
    notify: (notice) => notices.push(notice),
  });
  const view = store.view();
  const ids = () => {
    const state = view.getSnapshot();
    return state.status === 'ready' ? state.items.map((each) => each.id) : [];
  };
  return { store, view, notices, cursors, ids };
}

describe('account sessions store', () => {
  it('reads the list when first held, and the next page on loadMore', async () => {
    const { view, cursors, ids } = setup({}, [
      { items: [session(1, true), session(2)], nextCursor: 'next' },
      { items: [session(2), session(3)] },
    ]);
    expect(view.getSnapshot().status).toBe('loading');
    view.retain();
    await flush();
    expect(ids()).toEqual([ID(1), ID(2)]);
    view.loadMore();
    await flush();
    expect(cursors).toEqual([undefined, 'next']);
    expect(ids()).toEqual([ID(1), ID(2), ID(3)]);
    const state = view.getSnapshot();
    expect(state.status === 'ready' ? state.nextCursor : 'not ready').toBeUndefined();
  });

  it('shows a failed first read', async () => {
    const { view } = setup({}, []);
    view.retain();
    await flush();
    expect(view.getSnapshot().status).toBe('error');
  });

  it('signs a device out at once', async () => {
    let finish: () => void = () => undefined;
    const { store, view, ids } = setup({
      revoke: () => new Promise((resolve) => (finish = () => resolve({ ok: true }))),
    });
    view.retain();
    await flush();
    const landed = store.signOut(ID(2));
    expect(ids()).toEqual([ID(1), ID(3)]);
    finish();
    expect(await landed).toBe(true);
    expect(ids()).toEqual([ID(1), ID(3)]);
  });

  it('puts a refused sign out back in its place, with a toast', async () => {
    const { store, view, ids, notices } = setup({
      revoke: () => Promise.reject(dataError('INTERNAL', 'Something went wrong.')),
    });
    view.retain();
    await flush();
    expect(await store.signOut(ID(2))).toBe(false);
    expect(ids()).toEqual([ID(1), ID(2), ID(3)]);
    expect(notices).toEqual([{ tone: 'danger', message: 'Something went wrong.' }]);
  });

  it('keeps a device already signed out elsewhere gone, quietly', async () => {
    const { store, view, ids, notices } = setup({
      revoke: () => Promise.reject(dataError('NOT_FOUND', 'That device is already signed out.')),
    });
    view.retain();
    await flush();
    expect(await store.signOut(ID(3))).toBe(true);
    expect(ids()).toEqual([ID(1), ID(2)]);
    expect(notices).toEqual([]);
  });

  it('leaves only this device on sign out of all others', async () => {
    const { store, view, ids } = setup({}, [
      { items: [session(1, true), session(2), session(3)] },
      { items: [session(1, true)] },
    ]);
    view.retain();
    await flush();
    const answer = store.signOutOthers();
    // Nothing changes behind the confirm until the server answers.
    expect(ids()).toEqual([ID(1), ID(2), ID(3)]);
    expect(await answer).toEqual({ ok: true, count: 2 });
    expect(ids()).toEqual([ID(1)]);
    await flush();
    expect(ids()).toEqual([ID(1)]);
  });

  it('leaves the devices as they were, without a toast, when a recent sign in is needed', async () => {
    const { store, view, ids, notices } = setup({
      revokeOthers: () => Promise.reject(dataError('STEP_UP_REQUIRED', 'Confirm it is you first.')),
    });
    view.retain();
    await flush();
    expect(await store.signOutOthers()).toEqual({
      ok: false,
      code: 'STEP_UP_REQUIRED',
      message: 'Confirm it is you first.',
    });
    expect(ids()).toEqual([ID(1), ID(2), ID(3)]);
    expect(notices).toEqual([]);
  });
});
