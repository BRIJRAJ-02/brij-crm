// A Captures list against a read answered by hand: read when first held or
// readied, not again while fresh, again when held after a while; a write shown
// at once, its answer put in place, put back on a refusal; a duplicate pending
// until it lands; and a read that raced a write never undoing it.
import { describe, expect, it } from 'vitest';
import { createCaptureList, shownDrop, shownPatch, upsertFirst, FRESH_MS, type CaptureListState } from './list.ts';

interface Row {
  readonly id: string;
  readonly title: string;
}

const WS = 'acme';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(answers: (readonly Row[] | Error)[]) {
  let clock = 0;
  let reads = 0;
  const pending: ReturnType<typeof deferred<readonly Row[]>>[] = [];
  let manual = false;
  const store = createCaptureList<Row>({
    read: () => {
      if (manual) {
        const next = deferred<readonly Row[]>();
        pending.push(next);
        reads += 1;
        return next.promise;
      }
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      return answer instanceof Error || answer === undefined
        ? Promise.reject(answer ?? new Error('none'))
        : Promise.resolve(answer);
    },
    now: () => clock,
  });
  return {
    store,
    view: store.view(WS),
    reads: () => reads,
    tick: (ms: number) => {
      clock += ms;
    },
    manual: () => {
      manual = true;
    },
    pending,
  };
}

const items = (state: CaptureListState<Row>) =>
  state.status === 'ready' ? state.items.map((row) => row.title) : state.status;

describe('a Captures list', () => {
  it('reads once for the loader and the screen, and again when held after a while away', async () => {
    const t = setup([[{ id: 'a', title: 'Intro' }], [{ id: 'a', title: 'Intro call' }]]);
    await t.view.ready();
    const release = t.view.retain();
    await flush();
    expect(t.reads()).toBe(1);
    expect(items(t.view.getSnapshot())).toEqual(['Intro']);
    release();
    t.tick(FRESH_MS + 1);
    // Back on the list: the held rows show at once, read again behind them.
    const back = t.view.ready();
    expect(items(t.view.getSnapshot())).toEqual(['Intro']);
    await back;
    await flush();
    expect(t.reads()).toBe(2);
    expect(items(t.view.getSnapshot())).toEqual(['Intro call']);
  });

  it('rejects a first read that failed, and shows the error', async () => {
    const t = setup([new Error('down')]);
    await expect(t.view.ready()).rejects.toThrow();
    expect(t.view.getSnapshot().status).toBe('error');
  });

  it('shows a write at once, puts the answer in place, and tells listeners', async () => {
    const t = setup([[{ id: 'a', title: 'Intro' }]]);
    await t.view.ready();
    let told = 0;
    t.view.subscribe(() => {
      told += 1;
    });
    const answer = deferred<Row>();
    const sent = t.store.write(WS, {
      send: () => answer.promise,
      ...shownPatch(t.store.items(WS), 'a', (row) => ({ ...row, title: 'Renamed' })),
      land: (rows, row) => upsertFirst(row)(rows),
    });
    expect(items(t.view.getSnapshot())).toEqual(['Renamed']);
    answer.resolve({ id: 'a', title: 'Renamed by server' });
    await sent;
    expect(items(t.view.getSnapshot())).toEqual(['Renamed by server']);
    expect(told).toBe(2);
  });

  it('puts a refused change back and rejects with it', async () => {
    const t = setup([
      [
        { id: 'a', title: 'Intro' },
        { id: 'b', title: 'Visit' },
      ],
    ]);
    await t.view.ready();
    const sent = t.store.write(WS, {
      send: () => Promise.reject(new Error('no')),
      ...shownDrop(t.store.items(WS), 'a'),
    });
    expect(items(t.view.getSnapshot())).toEqual(['Visit']);
    await expect(sent).rejects.toThrow('no');
    expect(items(t.view.getSnapshot())).toEqual(['Intro', 'Visit']);
  });

  it('keeps a later change when an earlier one is refused', async () => {
    const t = setup([[{ id: 'a', title: 'Intro' }]]);
    await t.view.ready();
    const first = deferred<Row>();
    const one = t.store.write(WS, {
      send: () => first.promise,
      ...shownPatch(t.store.items(WS), 'a', (row) => ({ ...row, title: 'One' })),
    });
    const two = t.store.write(WS, {
      send: () => Promise.resolve({ id: 'a', title: 'Two' }),
      ...shownPatch(t.store.items(WS), 'a', (row) => ({ ...row, title: 'Two' })),
      land: (rows, row) => upsertFirst(row)(rows),
    });
    await two;
    first.reject(new Error('no'));
    await expect(one).rejects.toThrow('no');
    expect(items(t.view.getSnapshot())).toEqual(['Two']);
  });

  it('marks a row shown before the server made it as pending until it lands', async () => {
    const t = setup([[{ id: 'a', title: 'Intro' }]]);
    await t.view.ready();
    const made = deferred<Row>();
    const sent = t.store.write(WS, {
      send: () => made.promise,
      show: upsertFirst({ id: 'c', title: 'Intro (copy)' }),
      pendingId: 'c',
      land: (rows, row) => upsertFirst(row)(rows),
    });
    const shown = t.view.getSnapshot();
    expect(items(shown)).toEqual(['Intro (copy)', 'Intro']);
    expect(shown.status === 'ready' && shown.pendingIds.has('c')).toBe(true);
    made.resolve({ id: 'c', title: 'Intro (copy)' });
    await sent;
    const landed = t.view.getSnapshot();
    expect(landed.status === 'ready' && landed.pendingIds.size).toBe(0);
  });

  it('drops a read that raced a write and reads again once the write is in', async () => {
    const t = setup([]);
    t.manual();
    const loaded = t.view.ready();
    t.pending[0]?.resolve([{ id: 'a', title: 'Intro' }]);
    await loaded;
    const release = t.view.retain();
    t.tick(FRESH_MS + 1);
    t.view.reload();
    const write = deferred<Row>();
    const sent = t.store.write(WS, {
      send: () => write.promise,
      show: upsertFirst({ id: 'b', title: 'New' }),
      land: (rows, row) => upsertFirst(row)(rows),
    });
    // The read began before the write: its answer lacks it, and must not land.
    t.pending[1]?.resolve([{ id: 'a', title: 'Intro' }]);
    await flush();
    expect(items(t.view.getSnapshot())).toEqual(['New', 'Intro']);
    write.resolve({ id: 'b', title: 'New' });
    await sent;
    await flush();
    expect(t.pending).toHaveLength(3);
    t.pending[2]?.resolve([
      { id: 'b', title: 'New' },
      { id: 'a', title: 'Intro' },
    ]);
    await flush();
    expect(items(t.view.getSnapshot())).toEqual(['New', 'Intro']);
    release();
  });

  it('keeps a write made before the list was read for the next read', async () => {
    const t = setup([[{ id: 'a', title: 'Intro' }]]);
    await t.store.write(WS, { send: () => Promise.resolve(undefined) });
    await t.view.ready();
    expect(items(t.view.getSnapshot())).toEqual(['Intro']);
  });
});
