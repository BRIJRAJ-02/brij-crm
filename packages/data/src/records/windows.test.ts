// A view's ordered id windows (spec 0006, windows): blocks of 100 loaded
// around the range on screen in both modes, far loads aborted, far blocks
// dropped (a cursor block keeping its checkpoint), the read ahead of a cursor
// chain, a short final block, the count replaced, and settle's reread.
import { describe, expect, it } from 'vitest';
import { createWindows, type BlockReader, type ReadFrom, type WindowMode } from './windows.ts';

interface Call {
  readonly from: ReadFrom;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly answer: () => void;
  readonly fail: (error: unknown) => void;
}

/**
 * A server over `rows` (the reference order), whose calls wait until the
 * test answers them: a position reads from that row, a cursor (the id of the
 * last row before) reads after it, as keyset paging does.
 */
function fakeServer(rows: () => readonly string[]) {
  const calls: Call[] = [];
  const read: BlockReader = (from, limit, signal) =>
    new Promise((resolve, reject) => {
      calls.push({
        from,
        limit,
        signal,
        answer: () => {
          const all = rows();
          const start =
            from.position ?? (from.cursor === undefined ? 0 : all.indexOf(from.cursor.slice('after:'.length)) + 1);
          const ids = all.slice(start, start + limit);
          const last = ids.at(-1);
          const more = start + limit < all.length;
          resolve(more && last !== undefined ? { ids, nextCursor: `after:${last}` } : { ids });
        },
        fail: reject,
      });
    });
  const answerAll = async () => {
    for (let round = 0; round < 500; round += 1) {
      const open = calls.filter((call) => !answered.has(call) && !call.signal.aborted);
      if (open.length === 0) return;
      for (const call of open) {
        answered.add(call);
        call.answer();
      }
      await settle();
    }
  };
  const answered = new Set<Call>();
  return { calls, read, answerAll };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sample = (n: number) => Array.from({ length: n }, (_, index) => `id-${String(index).padStart(6, '0')}`);

function windowsOver(
  rows: readonly string[],
  mode: WindowMode,
  extra: Partial<Parameters<typeof createWindows>[0]> = {},
) {
  let current = rows;
  const server = fakeServer(() => current);
  const released: string[] = [];
  const errors: unknown[] = [];
  const windows = createWindows({
    mode: () => mode,
    read: server.read,
    release: (ids) => released.push(...ids),
    onError: (error) => errors.push(error),
    ...extra,
  });
  return {
    windows,
    server,
    released,
    errors,
    setRows: (next: readonly string[]) => {
      current = next;
    },
  };
}

/** The ids the windows hold for `start` to `end`. */
const idsIn = (windows: ReturnType<typeof createWindows>, start: number, end: number) =>
  Array.from({ length: end - start }, (_, index) => windows.idAt(start + index));

describe('position mode', () => {
  it('loads the blocks a range covers, once each, and answers ids by position', async () => {
    const { windows, server } = windowsOver(sample(1000), 'position');
    windows.setCount({ count: 1000, atLeast: false });
    let heard = 0;
    windows.subscribe(() => (heard += 1));
    windows.show({ start: 50, end: 160 });
    windows.show({ start: 60, end: 170 });
    expect(server.calls.map((call) => call.from)).toEqual([{ position: 0 }, { position: 100 }]);
    expect(windows.idAt(55)).toBeUndefined();
    await server.answerAll();
    expect(windows.idAt(55)).toBe(sample(1000)[55]);
    expect(windows.idAt(150)).toBe(sample(1000)[150]);
    expect(heard).toBe(2);
  });

  it('jumps straight to a far row with one read, aborting the loads left behind', async () => {
    const rows = sample(1_000_000);
    const { windows, server } = windowsOver(rows, 'position');
    windows.setCount({ count: rows.length, atLeast: false });
    windows.show({ start: 0, end: 40 });
    windows.show({ start: 600_000, end: 600_040 });
    expect(server.calls[0]?.signal.aborted).toBe(true);
    expect(server.calls.slice(1).map((call) => call.from)).toEqual([{ position: 600_000 }]);
    await server.answerAll();
    expect(idsIn(windows, 600_000, 600_040)).toEqual(rows.slice(600_000, 600_040));
    expect(windows.stats().loaded).toBe(1);
  });

  it('never asks past the last row, and nothing while the count is 0', () => {
    const { windows, server } = windowsOver(sample(250), 'position');
    windows.show({ start: 0, end: 40 });
    expect(server.calls).toHaveLength(0);
    windows.setCount({ count: 250, atLeast: false });
    windows.show({ start: 180, end: 400 });
    expect(server.calls.map((call) => call.from)).toEqual([{ position: 0 }, { position: 100 }, { position: 200 }]);
  });

  it('keeps blocks within 5 of the range, drops the rest and lets go of their ids', async () => {
    const { windows, server, released } = windowsOver(sample(100_000), 'position');
    windows.setCount({ count: 100_000, atLeast: false });
    windows.show({ start: 0, end: 40 });
    await server.answerAll();
    windows.show({ start: 500, end: 540 });
    await server.answerAll();
    expect(windows.stats().loaded).toBe(2);
    windows.show({ start: 2000, end: 2040 });
    await server.answerAll();
    expect(windows.idAt(10)).toBeUndefined();
    expect(released).toEqual(expect.arrayContaining([sample(100)[10]]));
    expect(windows.stats().loaded).toBe(1);
  });

  it('empties a deleted row in place, then loads its block and every later loaded block again', async () => {
    let stale = 0;
    const rows = sample(300);
    const { windows, server, setRows } = windowsOver(rows, 'position', { onStale: () => (stale += 1) });
    windows.setCount({ count: 300, atLeast: false });
    windows.show({ start: 0, end: 300 });
    await server.answerAll();
    const gone = rows[150] ?? '';
    setRows(rows.filter((id) => id !== gone));
    windows.drop(new Set([gone]));
    expect(windows.idAt(150)).toBeUndefined();
    expect(stale).toBe(1);
    await server.answerAll();
    expect(windows.idAt(150)).toBe(rows[151]);
  });

  it('lets go of the rows past a smaller count, and never keeps more of a late block than the count allows', async () => {
    const { windows, server, released } = windowsOver(sample(250), 'position');
    windows.setCount({ count: 250, atLeast: false });
    windows.show({ start: 0, end: 250 });
    windows.setCount({ count: 120, atLeast: false });
    await server.answerAll();
    expect(windows.idAt(119)).toBe(sample(250)[119]);
    expect(windows.idAt(120)).toBeUndefined();
    expect(released).toEqual(expect.arrayContaining([sample(250)[120]]));
  });

  it('aborts every load on dispose, and lets go of a late answer', async () => {
    const { windows, server, released } = windowsOver(sample(500), 'position');
    windows.setCount({ count: 500, atLeast: false });
    windows.show({ start: 0, end: 300 });
    windows.dispose();
    expect(server.calls.every((call) => call.signal.aborted)).toBe(true);
    server.calls[0]?.answer();
    await settle();
    expect(released).toEqual(expect.arrayContaining(sample(100)));
  });

  it('rereads the blocks on screen in one read and lets the others go (settle)', async () => {
    const rows = sample(10_000);
    const { windows, server, setRows } = windowsOver(rows, 'position');
    windows.setCount({ count: rows.length, atLeast: false });
    windows.show({ start: 0, end: 40 });
    await server.answerAll();
    windows.show({ start: 450, end: 520 });
    await server.answerAll();
    expect(windows.stats().loaded).toBe(3);
    const moved = [rows[9999] ?? '', ...rows.slice(0, 9999)];
    setRows(moved);
    const before = server.calls.length;
    const done = windows.reread(new AbortController().signal);
    await server.answerAll();
    await done;
    expect(server.calls.slice(before).map((call) => [call.from, call.limit])).toEqual([[{ position: 400 }, 200]]);
    expect(idsIn(windows, 450, 520)).toEqual(moved.slice(450, 520));
    expect(windows.stats().loaded).toBe(2);
  });
});

describe('cursor mode', () => {
  it('pages forward from each checkpoint, block by block, matching the reference order', async () => {
    const rows = sample(450);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 450, atLeast: false });
    for (let start = 0; start < 450; start += 50) {
      windows.show({ start, end: Math.min(450, start + 50) });
      await server.answerAll();
    }
    expect(server.calls.map((call) => call.from.cursor === undefined)).toEqual([true, false, false, false, false]);
    expect(windows.stats().checkpoints).toBe(4);
    windows.show({ start: 0, end: 450 });
    await server.answerAll();
    expect(idsIn(windows, 0, 450)).toEqual(rows);
  });

  it('reloads a dropped block from its own checkpoint with one call', async () => {
    const rows = sample(2000);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 2000, atLeast: false });
    for (let start = 0; start < 2000; start += 100) {
      windows.show({ start, end: start + 40 });
      await server.answerAll();
    }
    expect(windows.idAt(300)).toBeUndefined();
    const before = server.calls.length;
    windows.show({ start: 300, end: 340 });
    await server.answerAll();
    expect(server.calls.slice(before).map((call) => [call.from.cursor, call.limit])).toEqual([
      [`after:${rows[299] ?? ''}`, 100],
    ]);
    expect(idsIn(windows, 300, 340)).toEqual(rows.slice(300, 340));
  });

  it('reads ahead of the chain in calls of 200 to a far row, and the second block of a call reloads from the first', async () => {
    const rows = sample(5000);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 5000, atLeast: false });
    windows.show({ start: 0, end: 40 });
    await server.answerAll();
    const before = server.calls.length;
    windows.show({ start: 1050, end: 1090 });
    await server.answerAll();
    const ahead = server.calls.slice(before);
    // From block 1 (block 0's cursor) to block 10: five calls of 200 fill blocks 1 to 10.
    expect(ahead.map((call) => call.limit)).toEqual([200, 200, 200, 200, 200]);
    expect(idsIn(windows, 1050, 1090)).toEqual(rows.slice(1050, 1090));
    // Block 10 came as the second half of a call, so it has no checkpoint of its own: dropped, it reloads
    // from block 9's with 200 rows; block 11 has its own and reloads with 100.
    windows.show({ start: 3000, end: 3040 });
    await server.answerAll();
    windows.show({ start: 1050, end: 1090 });
    const reload = server.calls.at(-1);
    expect([reload?.from.cursor, reload?.limit]).toEqual([`after:${rows[899] ?? ''}`, 200]);
    await server.answerAll();
    expect(idsIn(windows, 1050, 1090)).toEqual(rows.slice(1050, 1090));
    windows.show({ start: 3000, end: 3040 });
    await server.answerAll();
    windows.show({ start: 1150, end: 1190 });
    const own = server.calls.at(-1);
    expect([own?.from.cursor, own?.limit]).toEqual([`after:${rows[1099] ?? ''}`, 100]);
  });

  it('aborts a read ahead the screen moved back from', async () => {
    const rows = sample(5000);
    const { windows, server, errors } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 5000, atLeast: false });
    windows.show({ start: 0, end: 40 });
    await server.answerAll();
    windows.show({ start: 4000, end: 4040 });
    // Ten calls in, the screen goes back to the top: the call in flight (blocks 21 and 22) is aborted.
    for (let call = 0; call < 10; call += 1) {
      server.calls.at(-1)?.answer();
      await settle();
    }
    const ahead = server.calls.at(-1);
    windows.show({ start: 0, end: 40 });
    expect(ahead?.signal.aborted).toBe(true);
    // Only block 0 loads again: it was dropped while the screen was far down.
    expect(server.calls.at(-1)?.from).toEqual({});
    expect(windows.stats().loading).toBe(1);
    await server.answerAll();
    expect(errors).toEqual([]);
  });

  it('grows the bar past 10,000 as rows load, and a short final block sets the count', async () => {
    const rows = sample(10_150);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 10_000, atLeast: true });
    expect(windows.count()).toBe(10_000);
    windows.show({ start: 9960, end: 10_000 });
    await server.answerAll();
    // The screen reached the end of a chain that may hold more: the next blocks came too, and the bar grew.
    expect(windows.count()).toBeGreaterThan(10_000);
    windows.show({ start: 10_060, end: windows.count() });
    await server.answerAll();
    expect(windows.told()).toEqual({ count: 10_150, atLeast: false });
    expect(windows.count()).toBe(10_150);
    expect(idsIn(windows, 10_100, 10_150)).toEqual(rows.slice(10_100));
  });

  it('starts the chain again from block 0 on restart, forgetting its checkpoints', async () => {
    const rows = sample(1000);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 1000, atLeast: false });
    windows.show({ start: 0, end: 40 });
    await server.answerAll();
    windows.show({ start: 500, end: 540 });
    await server.answerAll();
    const before = server.calls.length;
    windows.restart();
    expect(windows.stats()).toMatchObject({ loaded: 0, checkpoints: 0 });
    await server.answerAll();
    expect(server.calls[before]?.from).toEqual({});
    expect(idsIn(windows, 500, 540)).toEqual(rows.slice(500, 540));
  });

  it('reports whether a failed read carried a cursor', async () => {
    const rows = sample(1000);
    const seen: boolean[] = [];
    const { windows, server } = windowsOver(rows, 'cursor', {
      onError: (_error, read) => seen.push(read.withCursor),
    });
    windows.setCount({ count: 1000, atLeast: false });
    windows.show({ start: 0, end: 40 });
    server.calls[0]?.fail(new Error('no'));
    await settle();
    windows.loadMissing();
    await server.answerAll();
    windows.show({ start: 100, end: 140 });
    server.calls.at(-1)?.fail(new Error('no'));
    await settle();
    expect(seen).toEqual([false, true]);
  });

  it('rereads from the first block on screen’s checkpoint, as many rows as the screen spans', async () => {
    const rows = sample(3000);
    const { windows, server, setRows } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 3000, atLeast: false });
    for (let start = 0; start <= 1200; start += 100) {
      windows.show({ start, end: start + 40 });
      await server.answerAll();
    }
    windows.show({ start: 1250, end: 1330 });
    await server.answerAll();
    const changed = rows.filter((id) => id !== rows[5]);
    setRows(changed);
    const before = server.calls.length;
    const done = windows.reread(new AbortController().signal);
    await server.answerAll();
    await done;
    expect(server.calls.slice(before).map((call) => [call.from.cursor, call.limit])).toEqual([
      [`after:${rows[1199] ?? ''}`, 200],
    ]);
    // Keyset paging: the rows after the checkpoint's record, whatever moved above it.
    expect(idsIn(windows, 1250, 1330)).toEqual(rows.slice(1250, 1330));
    expect(windows.stats().loaded).toBe(2);
  });

  it('sizes the bar of a cursor window counted past 10,000 by what loaded, so a drag reads 50 calls at most', async () => {
    const rows = sample(1_000_000);
    const { windows, server } = windowsOver(rows, 'cursor');
    windows.setCount({ count: 1_000_000, atLeast: false });
    // The label keeps the exact count; the bar covers 10,000 until more loads.
    expect(windows.told()).toEqual({ count: 1_000_000, atLeast: false });
    expect(windows.count()).toBe(10_000);
    windows.show({ start: 600_000, end: 600_040 });
    windows.show({ start: 9_960, end: 10_000 });
    await server.answerAll();
    expect(server.calls.length).toBeLessThanOrEqual(51);
    expect(windows.count()).toBeGreaterThan(10_000);
    expect(idsIn(windows, 9_960, 10_000)).toEqual(rows.slice(9_960, 10_000));
  });
});
