// The profile order (owner ask A102) against the real held list, with each send answered by hand: a move shows at
// once, lands the server's places, goes back to the confirmed order on a refusal (saying so once), and a move made
// while one is on its way waits, replacing any already waiting, so the server always ends on the newest order.
import type { BookingPageView, ProfileOrder } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createCaptureList } from './list.ts';
import { createProfileOrder } from './profile-order.ts';

const WORKSPACE = 'acme';

/** A page with just what the order reads; the rest is never looked at here. */
const page = (id: string, profilePosition: number) =>
  ({ id, profilePosition, updatedAt: '2026-10-22T09:00:00.000Z' }) as BookingPageView;

/** A send the test answers by hand, one at a time. */
function sends() {
  const calls: {
    readonly ids: readonly string[];
    readonly answer: (order?: readonly string[]) => void;
    readonly refuse: () => void;
  }[] = [];
  const send = (_workspace: string, ids: readonly string[]) =>
    new Promise<ProfileOrder>((resolve, reject) => {
      calls.push({
        ids,
        answer: (order = ids) => {
          resolve({
            pages: order.map((id, index) => ({
              id,
              profilePosition: index,
              updatedAt: '2026-10-22T10:00:00.000Z',
            })),
          });
        },
        refuse: () => {
          reject(Object.assign(new Error('That booking page doesn’t exist, or isn’t yours.'), { code: 'NOT_FOUND' }));
        },
      });
    });
  return { calls, send };
}

/** A held list of pages a, b and c (in that order) and the profile order over it. */
async function setup() {
  const list = createCaptureList<BookingPageView>({
    read: () => Promise.resolve([page('a', 0), page('b', 1), page('c', 2)]),
  });
  await list.view(WORKSPACE).ready();
  const { calls, send } = sends();
  const order = createProfileOrder({ list, send });
  /** The pages by place, as the list shows them now. */
  const shown = () =>
    [...(list.items(WORKSPACE) ?? [])]
      .sort((left, right) => left.profilePosition - right.profilePosition)
      .map((each) => each.id)
      .join('');
  return { list, calls, order, shown };
}

/** Lets settled promises run their reactions. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the profile order', () => {
  it('shows a move at once, then puts the server’s places and versions in place', async () => {
    const { list, calls, order, shown } = await setup();
    const moved = order.reorder(WORKSPACE, ['c', 'a', 'b']);
    expect(shown()).toBe('cab');
    expect(calls.map((call) => call.ids)).toEqual([['c', 'a', 'b']]);
    calls[0]?.answer();
    expect(await moved).toBe('saved');
    expect(shown()).toBe('cab');
    expect(list.items(WORKSPACE)?.every((each) => each.updatedAt === '2026-10-22T10:00:00.000Z')).toBe(true);
  });

  it('goes back to the confirmed order when refused, and rejects that one move', async () => {
    const { calls, order, shown } = await setup();
    const moved = order.reorder(WORKSPACE, ['b', 'c', 'a']);
    expect(shown()).toBe('bca');
    calls[0]?.refuse();
    await expect(moved).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(shown()).toBe('abc');
  });

  it('holds a move made while one is on its way, then sends it, never losing the first', async () => {
    const { calls, order, shown } = await setup();
    const first = order.reorder(WORKSPACE, ['b', 'a', 'c']);
    const second = order.reorder(WORKSPACE, ['b', 'c', 'a']);
    // Both show at once; only the first has gone out.
    expect(shown()).toBe('bca');
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    expect(await first).toBe('replaced');
    // The first's answer never undoes the second, which goes out next with every change in it.
    expect(shown()).toBe('bca');
    expect(calls.map((call) => call.ids)).toEqual([
      ['b', 'a', 'c'],
      ['b', 'c', 'a'],
    ]);
    calls[1]?.answer();
    expect(await second).toBe('saved');
    expect(shown()).toBe('bca');
  });

  it('sends only the newest of the moves that waited', async () => {
    const { calls, order, shown } = await setup();
    const first = order.reorder(WORKSPACE, ['b', 'a', 'c']);
    const second = order.reorder(WORKSPACE, ['c', 'b', 'a']);
    const third = order.reorder(WORKSPACE, ['c', 'a', 'b']);
    expect(await second).toBe('replaced');
    expect(shown()).toBe('cab');
    calls[0]?.answer();
    expect(await first).toBe('replaced');
    calls[1]?.answer();
    expect(await third).toBe('saved');
    expect(calls.map((call) => call.ids)).toEqual([
      ['b', 'a', 'c'],
      ['c', 'a', 'b'],
    ]);
  });

  it('carries a refused move in the one waiting, and puts back what the server last confirmed if that fails too', async () => {
    const { calls, order, shown } = await setup();
    const first = order.reorder(WORKSPACE, ['b', 'a', 'c']);
    const second = order.reorder(WORKSPACE, ['c', 'b', 'a']);
    calls[0]?.refuse();
    // The second holds the first's change, so it goes on and settles for both.
    expect(await first).toBe('replaced');
    expect(shown()).toBe('cba');
    calls[1]?.refuse();
    await expect(second).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(shown()).toBe('abc');
  });

  it('puts back the order a landed move confirmed, not the one before it', async () => {
    const { calls, order, shown } = await setup();
    const first = order.reorder(WORKSPACE, ['b', 'a', 'c']);
    const second = order.reorder(WORKSPACE, ['c', 'b', 'a']);
    calls[0]?.answer();
    expect(await first).toBe('replaced');
    await flush();
    calls[1]?.refuse();
    await expect(second).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(shown()).toBe('bac');
    // A new run starts from there.
    const third = order.reorder(WORKSPACE, ['a', 'b', 'c']);
    calls[2]?.answer();
    expect(await third).toBe('saved');
    expect(shown()).toBe('abc');
  });
});
