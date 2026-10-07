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

  it('replaces the count rather than adding to it, and drops deleted ids from every block', async () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 40 });
    calls[0]?.answer();
    await settle();
    windows.setCount(1001);
    windows.setCount(1001);
    expect(windows.count()).toBe(1001);
    windows.drop(new Set(['id-1']));
    expect(windows.idAt(1)).toBe('id-2');
  });

  it('aborts every load on dispose', () => {
    const { calls, load } = fakeLoader();
    const windows = createWindows({ load, count: 1000 });
    windows.show({ start: 0, end: 240 });
    windows.dispose();
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
  });
});
