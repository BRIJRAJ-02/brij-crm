// A view's ordered id windows: blocks of 100 loaded around the range on
// screen, far loads aborted, far blocks dropped, the count replaced.
import { describe, expect, it } from 'vitest';
import { createWindows, type BlockLoader } from './windows.ts';

interface Call {
  readonly offset: number;
  readonly signal: AbortSignal;
  readonly answer: () => void;
  readonly fail: (error: unknown) => void;
}

/** A loader whose calls wait until the test answers them. */
function fakeLoader() {
  const calls: Call[] = [];
  const load: BlockLoader = (offset, limit, signal) =>
    new Promise((resolve, reject) => {
      calls.push({
        offset,
        signal,
        answer: () => {
          resolve(Array.from({ length: limit }, (_, index) => `id-${String(offset + index)}`));
        },
        fail: reject,
      });
    });
  return { calls, load };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the id windows', () => {
  it('loads the blocks a range covers, once each, and answers ids by position', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    let heard = 0;
    windows.subscribe(() => (heard += 1));
    windows.show({ start: 50, end: 160 });
    windows.show({ start: 60, end: 170 });
    expect(calls.map((call) => call.offset)).toEqual([0, 100]);
    expect(windows.idAt(55)).toBeUndefined();
    for (const call of calls) call.answer();
    await settle();
    expect(windows.idAt(55)).toBe('id-55');
    expect(windows.idAt(150)).toBe('id-150');
    expect(heard).toBe(2);
  });

  it('loads only the blocks on screen again on refreshShown, letting go of the others until scrolled back', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 40 });
    windows.show({ start: 300, end: 340 });
    for (const call of calls) call.answer();
    await settle();
    expect(windows.stats()).toEqual({ loaded: 2, loading: 0 });
    windows.refreshShown();
    expect(calls.slice(2).map((call) => call.offset)).toEqual([300]);
    expect(windows.idAt(0)).toBeUndefined();
    calls[2]?.answer();
    await settle();
    expect(windows.idAt(310)).toBe('id-310');
    windows.show({ start: 0, end: 40 });
    expect(calls.slice(3).map((call) => call.offset)).toEqual([0]);
  });

  it('never asks past the last row', () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 250 });
    windows.show({ start: 180, end: 400 });
    expect(calls.map((call) => call.offset)).toEqual([100, 200]);
  });

  it('aborts a load that scrolled more than 5 blocks away, and ignores its late answer', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 100_000 });
    windows.show({ start: 0, end: 40 });
    windows.show({ start: 50_000, end: 50_040 });
    const [first] = calls;
    expect(first?.signal.aborted).toBe(true);
    first?.answer();
    await settle();
    expect(windows.idAt(0)).toBeUndefined();
    expect(windows.stats()).toEqual({ loaded: 0, loading: 1 });
  });

  it('keeps blocks within 5 of the range and drops the rest', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 100_000 });
    for (let block = 0; block < 12; block += 1) {
      windows.show({ start: block * 100, end: block * 100 + 40 });
      for (const call of calls.splice(0)) call.answer();
      await settle();
    }
    // On block 11: blocks 6 to 11 stay, 0 to 5 are gone.
    expect(windows.stats().loaded).toBe(6);
    expect(windows.idAt(550)).toBeUndefined();
    expect(windows.idAt(650)).toBe('id-650');
  });

  it('reports a failed load, and tries the block again when it is next on screen', async () => {
    const { calls, load } = fakeLoader();
    const errors: unknown[] = [];
    const windows = createWindows({ load, count: 1000, onError: (error) => errors.push(error) });
    windows.show({ start: 0, end: 40 });
    calls[0]?.fail(new Error('QUERY_CANCELLED'));
    await settle();
    expect(errors).toHaveLength(1);
    windows.show({ start: 0, end: 41 });
    expect(calls).toHaveLength(2);
  });

  it('replaces the count rather than adding to it', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 40 });
    calls[0]?.answer();
    await settle();
    windows.setCount(1001);
    windows.setCount(1001);
    expect(windows.count()).toBe(1001);
  });

  it('empties a deleted row in place, then loads its block and every later loaded block again, and the count', async () => {
    const { calls, load } = fakeLoader();
    let stale = 0;
    const released: string[] = [];
    const windows = createWindows({
      load,
      count: 1000,
      onStale: () => (stale += 1),
      release: (ids) => released.push(...ids),
    });
    windows.show({ start: 50, end: 260 });
    for (const call of calls.splice(0)) call.answer();
    await settle();
    windows.drop(new Set(['id-150']));
    // No hole closes up and nothing shifts: the row empties, later rows stay where they were until reloaded.
    expect(windows.idAt(150)).toBeUndefined();
    expect(windows.idAt(151)).toBe('id-151');
    expect(windows.idAt(250)).toBe('id-250');
    expect(windows.has('id-150')).toBe(false);
    expect(released).toEqual(['id-150']);
    expect(stale).toBe(1);
    // Blocks 1 and 2 load again; block 0, before the gone row, doesn't.
    expect(calls.map((call) => call.offset)).toEqual([100, 200]);
    for (const call of calls.splice(0)) call.answer();
    await settle();
    expect(windows.idAt(150)).toBe('id-150');
  });

  it('keeps the range it had when shown an empty one', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 100_000 });
    windows.show({ start: 50_000, end: 50_040 });
    windows.show({ start: 0, end: 0 });
    for (const call of calls.splice(0)) call.answer();
    await settle();
    expect(windows.idAt(50_000)).toBe('id-50000');
    expect(calls).toHaveLength(0);
  });

  it('asks for nothing while the count is 0', () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 0 });
    windows.show({ start: 0, end: 40 });
    expect(calls).toHaveLength(0);
  });

  it('lets go of the rows past a smaller count', async () => {
    const { calls, load } = fakeLoader();
    const released: string[] = [];
    const windows = createWindows({ load, count: 1000, release: (ids) => released.push(...ids) });
    windows.show({ start: 0, end: 240 });
    for (const call of calls.splice(0)) call.answer();
    await settle();
    windows.setCount(150);
    expect(windows.idAt(149)).toBe('id-149');
    expect(windows.idAt(150)).toBeUndefined();
    expect(windows.idAt(210)).toBeUndefined();
    expect(released).toHaveLength(150);
    expect(windows.stats().loaded).toBe(2);
  });

  it('never keeps more of a late block than the count allows', async () => {
    const { calls, load } = fakeLoader();
    const released: string[] = [];
    const windows = createWindows({ load, count: 1000, release: (ids) => released.push(...ids) });
    windows.show({ start: 0, end: 40 });
    windows.setCount(30);
    calls[0]?.answer();
    await settle();
    expect(windows.idAt(29)).toBe('id-29');
    expect(windows.idAt(30)).toBeUndefined();
    expect(released).toHaveLength(70);
  });

  it('adds a record made here at the end and holds it while the last block is loaded, and withdraws it', async () => {
    const { calls, load } = fakeLoader();
    const held: string[] = [];
    const released: string[] = [];
    const windows = createWindows({
      load,
      count: 150,
      hold: (ids) => held.push(...ids),
      release: (ids) => released.push(...ids),
    });
    windows.show({ start: 100, end: 150 });
    for (const call of calls.splice(0)) call.answer();
    await settle();
    // The fake answers a full block: the 50 ids past the count were let go as it landed.
    expect(released).toHaveLength(50);
    released.length = 0;
    expect(windows.add('new')).toBe(150);
    expect(windows.count()).toBe(151);
    expect(windows.idAt(150)).toBe('new');
    expect(windows.indexOf('new')).toBe(150);
    expect(held).toEqual(['new']);
    windows.withdraw('new');
    expect(windows.count()).toBe(150);
    expect(windows.idAt(150)).toBeUndefined();
    expect(released).toEqual(['new']);
  });

  it('adds the first record to an empty table', () => {
    const { load } = fakeLoader();
    const windows = createWindows({ load, count: 0 });
    expect(windows.add('first')).toBe(0);
    expect(windows.idAt(0)).toBe('first');
  });

  it('counts a record made here past an unloaded block without holding it', () => {
    const { load } = fakeLoader();
    const held: string[] = [];
    const windows = createWindows({ load, count: 1000, hold: (ids) => held.push(...ids) });
    expect(windows.add('new')).toBe(1000);
    expect(windows.count()).toBe(1001);
    expect(windows.has('new')).toBe(false);
    expect(held).toEqual([]);
  });

  it('aborts a block request a newer one for the same block supersedes', () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 40 });
    windows.refresh();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
  });

  it('aborts every load on dispose', () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 240 });
    windows.dispose();
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
  });

  it('lets go of the ids of every block it drops, and of a late answer it never keeps', async () => {
    const { calls, load } = fakeLoader();
    const released: string[] = [];
    const windows = createWindows({ load, count: 100_000, release: (ids) => released.push(...ids) });
    windows.show({ start: 0, end: 40 });
    windows.show({ start: 50_000, end: 50_040 });
    // Block 0 was aborted, but its answer still arrives: its ids are let go at once.
    for (const call of calls.splice(0)) call.answer();
    await settle();
    expect(released).toHaveLength(100);
    expect(released[0]).toBe('id-0');
    // Moving far again drops block 500, which was kept.
    windows.show({ start: 0, end: 40 });
    expect(released).toHaveLength(200);
    expect(released.at(-1)).toBe('id-50099');
    for (const call of calls.splice(0)) call.answer();
    await settle();
    windows.dispose();
    expect(released).toHaveLength(300);
  });
});
