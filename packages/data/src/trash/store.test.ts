// The trash store against a fake API answered by hand (spec 0022, AC-533,
// AC-534): windows by cursor with the count, a restore that takes its rows
// out at once and brings a refused one back with its reason, and the live
// settle after a delete elsewhere.
import type { ChangeEvent, DeleteForeverResults, RestoreResults, TrashItem, TrashPage } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError, type DataError } from '../errors.ts';
import { createTrash, type TrashApi, type TrashView } from './store.ts';

const WS = 'acme';
const PEOPLE = '0199a6f2-0000-7000-8000-00000000000a';
const idAt = (index: number) => `0199a6f2-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;

function itemOf(index: number): TrashItem {
  return {
    recordId: idAt(index),
    objectId: PEOPLE,
    display: { objectId: PEOPLE, recordId: idAt(index), name: `P${String(index)}`, kind: 'person' },
    deletedAt: '2026-10-15T09:00:00.000Z',
    deletedBy: { type: 'member', id: idAt(9000) },
    expiresAt: '2026-11-14T09:00:00.000Z',
  };
}

interface Pending<I, O> {
  readonly input: I;
  readonly answer: (output: O) => void;
  readonly fail: (error: DataError) => void;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const queries: Pending<{ objectId?: string; cursor?: string; limit: number }, TrashPage>[] = [];
  const counts: Pending<{ objectId?: string }, { count: number; atLeast: boolean }>[] = [];
  const restores: Pending<readonly string[], RestoreResults['results']>[] = [];
  const purges: Pending<readonly string[], DeleteForeverResults['results']>[] = [];
  const queue =
    <I, O>(list: Pending<I, O>[]) =>
    (input: I) =>
      new Promise<O>((resolve, reject) => {
        list.push({ input, answer: resolve, fail: reject });
      });
  const api: TrashApi = {
    query: ({ workspace: _workspace, ...input }) => queue(queries)(input),
    count: ({ workspace: _workspace, ...input }) => queue(counts)(input),
    restore: async (input) => ({ results: await queue(restores)(input.recordIds), echoes: 1 }),
    deleteForever: async (input) => ({ results: await queue(purges)(input.recordIds), echoes: 1 }),
  };
  const frames: (() => void)[] = [];
  const timers: { ms: number; run: () => void; live: boolean }[] = [];
  let minted = 0;
  let time = 0;
  const clock = { advance: (ms: number) => (time += ms) };
  const trash = createTrash({
    api,
    mintId: () => idAt(5000 + (minted += 1)),
    schedule: (flush) => frames.push(flush),
    random: () => 0,
    now: () => time,
    later: (run, ms) => {
      const timer = { ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  const frame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  const tick = (ms: number) => {
    for (const timer of timers.splice(0)) {
      if (!timer.live) continue;
      if (timer.ms <= ms) timer.run();
      else timers.push({ ...timer, ms: timer.ms - ms });
    }
  };
  return { trash, queries, counts, restores, purges, frame, tick, clock };
}

async function readyTrash() {
  const context = setup();
  const view = context.trash.view(WS);
  const release = view.retain();
  await settle();
  context.counts[0]?.answer({ count: 3, atLeast: false });
  await settle();
  context.queries[0]?.answer({ items: [itemOf(0), itemOf(1), itemOf(2)] });
  await view.ready();
  context.frame();
  return { ...context, view, release };
}

const names = (view: TrashView) => {
  const { source } = view.getSnapshot();
  return Array.from({ length: source.count }, (_, at) => source.getItem(at)?.item.display.name);
};

describe('the trash (AC-533)', () => {
  it('loads its count and first block by cursor, and is ready', async () => {
    const { view, queries, counts } = await readyTrash();
    expect(counts[0]?.input).toEqual({});
    expect(queries[0]?.input).toEqual({ limit: 100 });
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', count: { count: 3, atLeast: false } });
    expect(names(view)).toEqual(['P0', 'P1', 'P2']);
  });

  it('reads one object’s trash when asked, as its own view', async () => {
    const { trash, counts } = setup();
    const all = trash.view(WS);
    const people = trash.view(WS, PEOPLE);
    expect(people).not.toBe(all);
    expect(trash.view(WS, PEOPLE)).toBe(people);
    await settle();
    expect(counts.map((count) => count.input)).toEqual([{}, { objectId: PEOPLE }]);
  });

  it('fails with Retry, and loads again on retry', async () => {
    const { trash, counts, queries, frame } = setup();
    const view = trash.view(WS);
    view.retain();
    await settle();
    counts[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await view.ready();
    frame();
    expect(view.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'API_UNAVAILABLE' } });
    view.retry();
    await settle();
    counts[1]?.answer({ count: 0, atLeast: false });
    await view.ready();
    frame();
    expect(view.getSnapshot().status).toBe('ready');
    expect(queries).toHaveLength(0);
  });

  it('settles after a records event that deletes elsewhere, 1.5 s after it, while shown', async () => {
    const { trash, counts, queries, tick } = await readyTrash();
    const event: Extract<ChangeEvent, { kind: 'records' }> = {
      kind: 'records',
      seq: 9,
      at: '2026-10-15T09:00:01.000Z',
      objectId: PEOPLE,
      recordIds: [idAt(7)],
      attributeIds: [],
      deletedIds: [idAt(7)],
    };
    trash.changed(WS, event);
    expect(counts).toHaveLength(1);
    tick(1500);
    await settle();
    expect(counts).toHaveLength(2);
    expect(queries.length).toBeGreaterThan(1);
    // An edit to a live record the trash doesn't show moves nothing.
    trash.changed(WS, { ...event, seq: 10, recordIds: [idAt(8)], deletedIds: [] });
    tick(5000);
    expect(counts).toHaveLength(2);
  });
});

describe('restoring (AC-534)', () => {
  it('takes the rows out at once, and brings a refused one back with its reason on its name cell', async () => {
    const { trash, view, restores, frame } = await readyTrash();
    const restoring = trash.restore(WS, [idAt(0), idAt(1)]);
    frame();
    expect(names(view)).toEqual(['P2']);
    expect(view.getSnapshot().count.count).toBe(1);
    await settle();
    restores[0]?.answer([
      { recordId: idAt(0), state: 'restored', objectId: PEOPLE },
      {
        recordId: idAt(1),
        state: 'refused',
        refusal: { code: 'UNIQUE_CONFLICT', message: 'Another record now has Email ada@acme.com.' },
      },
    ]);
    expect(await restoring).toEqual({
      kind: 'done',
      restored: 1,
      refused: 1,
      refusedIds: [idAt(1)],
      reasons: ['Another record now has Email ada@acme.com.'],
      objectIds: [PEOPLE],
    });
    frame();
    expect(names(view)).toContain('P1');
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:name`)).toBe('Another record now has Email ada@acme.com.');
  });

  it('brings every row back when the restore fails whole', async () => {
    const { trash, view, restores, frame } = await readyTrash();
    const restoring = trash.restore(WS, [idAt(0)]);
    await settle();
    restores[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    expect(await restoring).toMatchObject({ kind: 'failed', error: { code: 'API_UNAVAILABLE' } });
    frame();
    expect(names(view)).toEqual(['P0', 'P1', 'P2']);
  });

  it('refuses more than 500 before anything leaves', async () => {
    const { trash, restores } = await readyTrash();
    const ids = Array.from({ length: 501 }, (_, at) => idAt(at));
    expect(await trash.restore(WS, ids)).toEqual({ kind: 'too-many', limit: 500 });
    expect(restores).toHaveLength(0);
  });

  it('forgets the refusals once nobody shows the trash', async () => {
    const { trash, view, restores, release, frame } = await readyTrash();
    const restoring = trash.restore(WS, [idAt(1)]);
    await settle();
    restores[0]?.answer([
      {
        recordId: idAt(1),
        state: 'refused',
        refusal: { code: 'FORBIDDEN', message: 'You can view People but not change them.' },
      },
    ]);
    await restoring;
    frame();
    expect(view.getSnapshot().cellErrors.size).toBe(1);
    release();
    frame();
    expect(view.getSnapshot().cellErrors.size).toBe(0);
  });
});

describe('deleting forever (AC-535)', () => {
  it('takes the rows out at once and keeps out what the server removed', async () => {
    const { trash, view, purges, frame } = await readyTrash();
    const purging = trash.deleteForever(WS, [idAt(0), idAt(1)]);
    frame();
    expect(names(view)).toEqual(['P2']);
    await settle();
    purges[0]?.answer([
      { recordId: idAt(0), state: 'purged' },
      { recordId: idAt(1), state: 'not-in-trash' },
    ]);
    expect(await purging).toEqual({ kind: 'done', purged: 1, skipped: 1, refused: 0, refusedIds: [] });
  });

  it('keeps a record it was refused, with its reason on its name cell (AC-538, failing closed)', async () => {
    const { trash, view, purges, frame } = await readyTrash();
    const purging = trash.deleteForever(WS, [idAt(0), idAt(1)]);
    frame();
    expect(names(view)).toEqual(['P2']);
    await settle();
    purges[0]?.answer([
      { recordId: idAt(0), state: 'purged' },
      {
        recordId: idAt(1),
        state: 'refused',
        refusal: { code: 'FORBIDDEN', message: 'You can view People but not change them.' },
      },
    ]);
    expect(await purging).toEqual({ kind: 'done', purged: 1, skipped: 0, refused: 1, refusedIds: [idAt(1)] });
    frame();
    expect(names(view)).toContain('P1');
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:name`)).toBe('You can view People but not change them.');
  });

  it('brings every row back when a member without records.purge is refused', async () => {
    const { trash, view, purges, frame } = await readyTrash();
    const purging = trash.deleteForever(WS, [idAt(0)]);
    await settle();
    purges[0]?.fail(dataError('FORBIDDEN', 'Only workspace owners and admins can delete records forever.'));
    expect(await purging).toMatchObject({ kind: 'failed', error: { code: 'FORBIDDEN' } });
    frame();
    expect(names(view)).toEqual(['P0', 'P1', 'P2']);
  });
});

describe('the trash under a stream of changes (spec 0022, the state review)', () => {
  const deleted = (seq: number, objectId = PEOPLE): Extract<ChangeEvent, { kind: 'records' }> => ({
    kind: 'records',
    seq,
    at: '2026-10-15T09:00:01.000Z',
    objectId,
    recordIds: [idAt(7000 + seq)],
    attributeIds: [],
    deletedIds: [idAt(7000 + seq)],
  });

  it('settles at most 5 s after the first change, however many keep coming', async () => {
    const { trash, counts, tick, clock } = await readyTrash();
    for (let seq = 1; seq <= 12; seq += 1) {
      trash.changed(WS, deleted(seq));
      clock.advance(500);
      tick(500);
      await settle();
    }
    // Six seconds of changes every half second: the settle came once the 5 s were up, not never.
    expect(counts.length).toBeGreaterThan(1);
  });

  it('settles a view narrowed to one object only for that object’s records', async () => {
    const { trash, counts, tick } = setup();
    const view = trash.view(WS, PEOPLE);
    view.retain();
    await settle();
    counts[0]?.answer({ count: 0, atLeast: false });
    await view.ready();
    trash.changed(WS, deleted(1, '0199a6f2-0000-7000-8000-0000000000cc'));
    tick(5000);
    await settle();
    expect(counts).toHaveLength(1);
    trash.changed(WS, deleted(2));
    tick(5000);
    await settle();
    expect(counts).toHaveLength(2);
  });

  it('lowers the count with the rows restored, so it never bounces back before a settle', async () => {
    const { trash, view, restores, frame } = await readyTrash();
    const restoring = trash.restore(WS, [idAt(0)]);
    await settle();
    restores[0]?.answer([{ recordId: idAt(0), state: 'restored', objectId: PEOPLE }]);
    await restoring;
    frame();
    expect(view.getSnapshot().count).toEqual({ count: 2, atLeast: false });
  });
});
