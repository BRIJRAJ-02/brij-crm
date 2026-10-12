// A simulated user's live updates against a fake connection and holder (spec
// 0011, AC-200, AC-207, AC-212): tokens through the procedures with the head
// as the watermark; its own echo skipped; a stub fetching nothing; a holder
// refetching only the changed columns it reads, with the event's commit time
// on the sample; a coarse event rereading its window after the spread; a
// create or a change to the view's sort settling the window; another
// object's event discarded; and the storm's reconnect opening a new
// connection with new tokens, recovering from where the old one reached.
import { describe, expect, it } from 'vitest';
import type { Answered } from '../tally.ts';
import type { Holder, Sample } from '../user.ts';
import type { LiveConnectionOptions } from './centrifuge.ts';
import { fakeTimers } from './fake-timers.ts';
import { createLiveUser, FRAME_MS, SETTLE_MAX_MS, SETTLE_MS, type LiveApi } from './user.ts';

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const OBJECT = id(1);
const OTHER_OBJECT = id(2);
const NAME = id(10);
const STAGE = id(11);
const NOT_SHOWN = id(12);

const recordsEvent = (seq: number, fields: Record<string, unknown> = {}) => ({
  seq,
  at: new Date(500).toISOString(),
  kind: 'records',
  objectId: OBJECT,
  recordIds: [id(100)],
  attributeIds: [NAME],
  ...fields,
});

function setup(options: { failTokens?: number; catchUpReset?: boolean } = {}) {
  let failTokens = options.failTokens ?? 0;
  const timers = fakeTimers(1_000);
  const samples: Sample[] = [];
  const arrivals: number[] = [];
  const opened: LiveConnectionOptions[] = [];
  const closed: number[] = [];
  const calls: string[] = [];
  const refetches: { ids: readonly string[]; attributeIds: readonly string[] }[] = [];
  let rereads = 0;
  let heads = 5;
  const answered = (): Answered => ({
    answeredAt: timers.now() + 40,
    outcome: 'ok',
    requests: 1,
    poolMs: [],
    appMs: [],
  });
  const holder: Holder = {
    objectId: OBJECT,
    columns: new Set([NAME, STAGE]),
    windowIds: () => new Set([id(100), id(101)]),
    viewAttributeIds: () => new Set([STAGE]),
    refetch: (ids, attributeIds) => {
      refetches.push({ ids, attributeIds });
      return Promise.resolve(answered());
    },
    reread: () => {
      rereads += 1;
      return Promise.resolve(answered());
    },
  };
  const api: LiveApi = {
    connectionToken: () => {
      calls.push('connectionToken');
      return Promise.resolve({ token: 'connection' });
    },
    subscriptionToken: () => {
      calls.push('subscriptionToken');
      if (failTokens > 0) {
        failTokens -= 1;
        return Promise.reject(new Error('fetch failed'));
      }
      return Promise.resolve({ channel: `workspace:${id(9)}`, token: 'subscription', head: heads });
    },
    catchUp: (input) => {
      calls.push(`catchUp ${String(input.after)}`);
      return Promise.resolve({ head: input.after, reset: options.catchUpReset === true, events: [] });
    },
  };
  const ownMutations = new Set<string>();
  const live = createLiveUser({
    user: 4,
    workspace: 'load',
    api,
    holder,
    open: (options) => {
      opened.push(options);
      const index = opened.length;
      return {
        position: () => ({ epoch: 'e1', offset: 40 + index }),
        close: () => closed.push(index),
      };
    },
    url: 'ws://localhost:8100/connection/websocket',
    origin: 'http://localhost:3100',
    ownEcho: (mutationId) => ownMutations.delete(mutationId),
    now: timers.now,
    schedule: timers.schedule,
    random: () => 0.5,
    measured: () => true,
    record: (sample) => samples.push(sample),
    arrival: (raw) => arrivals.push(raw),
    track: () => undefined,
  });
  const connection = () => {
    const last = opened[opened.length - 1];
    if (last === undefined) throw new Error('Not connected.');
    return last.handlers;
  };
  return {
    live,
    timers,
    samples,
    arrivals,
    opened,
    closed,
    calls,
    refetches,
    ownMutations,
    rereads: () => rereads,
    setHead: (head: number) => {
      heads = head;
    },
    connection,
  };
}

async function started(options: Parameters<typeof setup>[0] = {}) {
  const made = setup(options);
  await made.live.start();
  made.connection().subscribed({ wasRecovering: false, recovered: false });
  await made.timers.advance(0);
  return made;
}

describe('a live user', () => {
  it('subscribes with the procedures: the head is its first watermark, and it catches up from there at once', async () => {
    const { live, opened, calls } = await started();
    expect(opened[0]).toMatchObject({
      channel: `workspace:${id(9)}`,
      token: 'subscription',
      origin: 'http://localhost:3100',
    });
    await expect(opened[0]?.connectionToken()).resolves.toBe('connection');
    expect(calls).toEqual(['subscriptionToken', 'catchUp 5', 'connectionToken']);
    expect(live.watermark()).toBe(5);
  });

  it('refetches the held records with only the changed columns it reads, timed from the commit', async () => {
    const { connection, refetches, samples, timers, arrivals } = await started();
    const receivedAt = timers.now();
    connection().publication(recordsEvent(6, { recordIds: [id(100), id(999)], attributeIds: [NAME, NOT_SHOWN] }));
    expect(arrivals).toEqual([receivedAt - 500]);
    // Gathered for a frame first, as the browser's store does.
    await timers.advance(FRAME_MS - 1);
    expect(refetches).toEqual([]);
    await timers.advance(1);
    expect(refetches).toEqual([{ ids: [id(100)], attributeIds: [NAME] }]);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      metric: 'delivery',
      via: 'live',
      atMs: 500,
      outcome: 'ok',
      scheduledAt: receivedAt,
    });
    // An event naming only columns the window doesn't read fetches nothing.
    connection().publication(recordsEvent(7, { attributeIds: [NOT_SHOWN] }));
    // One holding none of the records fetches nothing either.
    connection().publication(recordsEvent(8, { recordIds: [id(999)] }));
    // And one naming no attributes (a delete, say) only settles the window, as the browser does.
    connection().publication(recordsEvent(9, { attributeIds: [], deletedIds: [id(100)] }));
    await timers.advance(FRAME_MS);
    expect(refetches).toHaveLength(1);
  });

  it("gathers a frame's events into one refetch, with a delivery sample for each", async () => {
    const { connection, refetches, samples, timers } = await started();
    connection().publication(recordsEvent(6, { recordIds: [id(100)], attributeIds: [NAME] }));
    connection().publication(recordsEvent(7, { recordIds: [id(101)], attributeIds: [STAGE] }));
    await timers.advance(FRAME_MS);
    expect(refetches).toEqual([{ ids: [id(100), id(101)], attributeIds: [NAME, STAGE] }]);
    expect(samples.filter((sample) => sample.metric === 'delivery')).toHaveLength(2);
  });

  it('skips its own echo, lets a stub only move the watermark, and discards another object', async () => {
    const { live, connection, refetches, ownMutations, timers } = await started();
    ownMutations.add(id(77));
    connection().publication(recordsEvent(6, { mutationId: id(77) }));
    connection().publication({ seq: 7, at: new Date(600).toISOString(), kind: 'restricted' });
    connection().publication(recordsEvent(8, { objectId: OTHER_OBJECT }));
    await timers.advance(0);
    expect(refetches).toEqual([]);
    expect(ownMutations.size).toBe(0);
    expect(live.watermark()).toBe(8);
    expect(live.freeze().tally).toMatchObject({ ownEchoes: 1, stubs: 1, discarded: 1, recordsEvents: 0, applied: 3 });
  });

  it('rereads its window once after the spread however many coarse events arrive meanwhile', async () => {
    const { connection, timers, rereads, samples } = await started();
    connection().publication(recordsEvent(6, { coarse: true, recordIds: [], attributeIds: [] }));
    connection().publication(recordsEvent(7, { coarse: true, recordIds: [], attributeIds: [] }));
    await timers.advance(999);
    expect(rereads()).toBe(0);
    await timers.advance(1);
    expect(rereads()).toBe(1);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ metric: 'delivery', via: 'live', atMs: 500 });
  });

  it('rereads its window after a catch up answered reset', async () => {
    const { timers, rereads } = await started({ catchUpReset: true });
    await timers.advance(2_000);
    expect(rereads()).toBe(1);
  });

  it('tries a refused subscription token again with backoff, as the browser does', async () => {
    const made = setup({ failTokens: 2 });
    const starting = made.live.start();
    await made.timers.advance(10_000);
    await starting;
    expect(made.calls.filter((call) => call === 'subscriptionToken')).toHaveLength(3);
    expect(made.opened).toHaveLength(1);
    expect(made.samples.filter((sample) => sample.metric === 'live')).toHaveLength(2);
    expect(made.samples[0]?.reason).toBe('dropped (realtime.subscriptionToken)');
  });

  it('settles its window 1.5 s after the last reordering change, at most 5 s after the first, then the spread', async () => {
    const { connection, timers, rereads, samples } = await started();
    // A create in its object, then a change to the attribute its view sorts on, every second.
    connection().publication(recordsEvent(6, { recordIds: [id(500)], createdIds: [id(500)] }));
    for (let seq = 7; seq <= 10; seq += 1) {
      await timers.advance(1_000);
      connection().publication(recordsEvent(seq, { recordIds: [id(999)], attributeIds: [STAGE] }));
    }
    // Capped at 5 s after the first change, plus the 1 s spread (random 0.5 × 2 s).
    await timers.advance(SETTLE_MAX_MS - 4_000 + 999);
    expect(rereads()).toBe(0);
    await timers.advance(1);
    expect(rereads()).toBe(1);
    expect(samples.filter((sample) => sample.metric === 'settle')).toHaveLength(1);
    // A plain edit of a column it shows doesn't reorder: no settle.
    connection().publication(recordsEvent(11, { attributeIds: [NAME] }));
    await timers.advance(SETTLE_MS + 2_000);
    expect(rereads()).toBe(1);
  });

  it('reconnects in the storm with new tokens, recovering from where the old connection reached', async () => {
    const { live, connection, opened, closed, calls, timers, setHead } = await started();
    connection().publication(recordsEvent(6));
    // Seq 7 commits while the user is away: its new token's head says so.
    setHead(7);
    await live.reconnect();
    expect(closed).toEqual([1]);
    expect(opened).toHaveLength(2);
    expect(opened[1]?.since).toEqual({ epoch: 'e1', offset: 41 });
    expect(calls.filter((call) => call === 'subscriptionToken')).toHaveLength(2);
    // Centrifugo recovered it: back at once, and the replay counts as recovered.
    connection().subscribed({ wasRecovering: true, recovered: true });
    connection().publication(recordsEvent(7));
    await timers.advance(0);
    const { reconnected, tally } = live.freeze();
    expect(reconnected).toMatchObject({ how: 'recovered' });
    expect(reconnected?.backAt).toBeGreaterThanOrEqual(reconnected?.droppedAt ?? Infinity);
    expect(tally).toMatchObject({ recovered: 1, missed: 0 });
  });

  it('reports a dropped connection or a failed token call as an unexpected live error', async () => {
    const { connection, samples } = await started();
    connection().trouble('websocket dropped');
    expect(samples).toEqual([
      expect.objectContaining({ metric: 'live', outcome: 'unexpected', reason: 'websocket dropped' }),
    ]);
  });
});
