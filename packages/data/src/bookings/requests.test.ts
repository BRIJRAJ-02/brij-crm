// The requests store against a fake API answered by hand: read when held, one held list per workspace, read again in
// place by `refreshHeld` (a `bookings` event) while held and on the next hold when not, a hidden row gone at once and
// back on a refusal, and a failed read keeping what is shown.
import type { WaitingRequestView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createRequestsStore, type RequestsHeld } from './requests.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const request = (n: number): WaitingRequestView => ({
  bookingId: `0199a6f2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  pageId: '0199a6f2-0000-7000-8000-0000000000a1',
  start: `2026-11-1${String(n)}T09:00:00.000Z`,
  end: `2026-11-1${String(n)}T09:30:00.000Z`,
  visitorName: `Guest ${String(n)}`,
  visitorEmail: `guest${String(n)}@example.com`,
  expiresAt: `2026-11-1${String(n)}T08:00:00.000Z`,
});

function setup() {
  const answers: { items: readonly WaitingRequestView[]; fail: boolean } = { items: [request(1)], fail: false };
  const asked: string[] = [];
  const store = createRequestsStore({
    api: {
      waiting: (workspace) => {
        asked.push(workspace);
        return answers.fail ? Promise.reject(new Error('down')) : Promise.resolve(answers.items);
      },
    },
    onReturn: () => () => undefined,
  });
  return { store, answers, asked };
}

const names = (held: RequestsHeld) => {
  const state = held.getSnapshot();
  return state.status === 'ready' ? state.items.map((item) => item.visitorName) : state.status;
};

describe('requests store', () => {
  it('reads when held, one list per workspace', async () => {
    const { store, asked } = setup();
    const held = store.view('acme');
    expect(store.view('acme')).toBe(held);
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    held.retain();
    await flush();
    expect(names(held)).toEqual(['Guest 1']);
    expect(asked).toEqual(['acme']);
  });

  it('reads again in place on a bookings event while held, and on the next hold when not', async () => {
    const { store, answers, asked } = setup();
    const held = store.view('acme');
    const release = held.retain();
    await flush();
    answers.items = [request(1), request(2)];
    store.refreshHeld('acme');
    await flush();
    expect(names(held)).toEqual(['Guest 1', 'Guest 2']);
    release();
    answers.items = [request(2)];
    store.refreshHeld('acme');
    await flush();
    expect(asked).toHaveLength(2);
    // Unheld: nothing read, but the next hold reads rather than trusting the last read.
    held.retain();
    await flush();
    expect(asked).toHaveLength(3);
    expect(names(held)).toEqual(['Guest 2']);
    // Another workspace's event reads nothing here.
    store.refreshHeld('other');
    await flush();
    expect(asked).toHaveLength(3);
  });

  it('hides an answered request at once, and puts it back on a refusal', async () => {
    const { store, answers } = setup();
    const held = store.view('acme');
    held.retain();
    await flush();
    const restore = held.hide(request(1).bookingId);
    expect(names(held)).toEqual([]);
    restore();
    expect(names(held)).toEqual(['Guest 1']);
    // Answered for good: the read after it no longer has it, and a late restore changes nothing.
    const late = held.hide(request(1).bookingId);
    answers.items = [];
    store.refreshHeld('acme');
    await flush();
    late();
    answers.items = [request(1)];
    store.refreshHeld('acme');
    await flush();
    expect(names(held)).toEqual(['Guest 1']);
  });

  it('shows a failed first read, keeps what is shown on a later failure, and Try again reads afresh', async () => {
    const { store, answers } = setup();
    answers.fail = true;
    const held = store.view('acme');
    held.retain();
    await flush();
    expect(held.getSnapshot()).toEqual({ status: 'error', message: expect.any(String) as string });
    answers.fail = false;
    held.reload();
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    await flush();
    expect(names(held)).toEqual(['Guest 1']);
    answers.fail = true;
    store.refreshHeld('acme');
    await flush();
    expect(names(held)).toEqual(['Guest 1']);
  });

  it('forgets every list on clear', async () => {
    const { store } = setup();
    const held = store.view('acme');
    held.retain();
    await flush();
    store.clear();
    expect(store.view('acme')).not.toBe(held);
  });
});
