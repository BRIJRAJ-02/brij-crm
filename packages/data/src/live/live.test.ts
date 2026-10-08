// Live updates against a fake realtime client (spec 0005, the data layer's
// tests; spec 0007, catch up): the watermark (apply the next, drop repeats
// and late ones, a gap catches up from the outbox), this tab's own echoes
// skipped, unknown kinds and the stub only moving the watermark, catch up on
// a new or unrecovered subscription and after 5 minutes hidden, the resync on
// a reset, the paused status, and one connection shared by every watch.
import type { ChangeEvent } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  createLive,
  HIDDEN_CATCH_UP_MS,
  parseChangeEvent,
  REFETCH_JITTER_MS,
  type CaughtUp,
  type Granted,
  type LiveChannel,
  type LiveTransport,
} from './live.ts';
import { createMutationLog } from './mutations.ts';
import { createLiveRouter } from './router.ts';

const WS = 'acme';
const PEOPLE = '0199a6f2-0000-7000-8000-00000000000a';
const ROW = (n: number) => `0199a6f2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const MUTATION = '0199a6f2-0000-7000-8000-0000000000ff';
const AT = '2026-10-08T09:00:00.000Z';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const event = (
  seq: number,
  more: { recordIds?: string[]; mutationId?: string; coarse?: boolean } = {},
): ChangeEvent => ({
  seq,
  at: AT,
  kind: 'records',
  objectId: PEOPLE,
  recordIds: [ROW(seq)],
  attributeIds: [],
  ...more,
});

interface Setup {
  readonly token?: (workspace: string) => Promise<Granted | undefined>;
  /** The head read before the first read; undefined when it couldn't be. */
  readonly head?: number | undefined;
  /** What a catch up answers (head 0, nothing, by default). */
  readonly catchUp?: (after: number) => Promise<CaughtUp | undefined>;
  /** How many times opening the client fails before it opens. */
  readonly openFailures?: number;
}

/** createLive on a fake client, with its waits, the router's calls, the catch ups and the status in the test's hands. */
function setup(options: Setup = {}) {
  const channels: LiveChannel[] = [];
  const unlistened: string[] = [];
  const trouble = new Set<() => void>();
  let opened = 0;
  let closed = 0;
  const transport: LiveTransport = {
    listen: (channel) => {
      channels.push(channel);
      return () => {
        unlistened.push(channel.name);
      };
    },
    onTrouble: (listener) => {
      trouble.add(listener);
      return () => {
        trouble.delete(listener);
      };
    },
    close: () => {
      closed += 1;
    },
  };
  const waits: { readonly ms: number; readonly resolve: () => void }[] = [];
  const calls: string[] = [];
  const statuses: string[] = [];
  const afters: number[] = [];
  const mutations = createMutationLog();
  const router = createLiveRouter();
  router.on('records', (workspace, change) =>
    calls.push(`records ${workspace} ${change.recordIds.join(',')}${change.coarse === true ? ' coarse' : ''}`),
  );
  router.on('definitions', (workspace, change) => calls.push(`definitions ${workspace} ${change.objectId ?? ''}`));
  router.onResync((workspace) => calls.push(`resync ${workspace}`));
  let time = 0;
  let hidden = false;
  const visibilityListeners = new Set<() => void>();
  const head = 'head' in options ? options.head : 0;
  const live = createLive({
    url: 'ws://centrifugo.test/connection/websocket',
    connectionToken: () => Promise.resolve('connection-token'),
    subscriptionToken:
      options.token ??
      ((workspace) => Promise.resolve({ channel: `workspace:${workspace}-id`, token: 'sub-token', head: 0 })),
    head: () => Promise.resolve(head),
    catchUp: (_workspace, after) => {
      afters.push(after);
      return options.catchUp?.(after) ?? Promise.resolve({ head: after, reset: false, events: [] });
    },
    open: () => {
      opened += 1;
      return opened <= (options.openFailures ?? 0) ? Promise.reject(new Error('offline')) : Promise.resolve(transport);
    },
    router,
    mutations,
    onStatus: (status) => statuses.push(status),
    wait: (ms) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, resolve });
      }),
    random: () => 0.5,
    now: () => time,
    startupMs: 5000,
    visibility: {
      hidden: () => hidden,
      onChange: (listener) => {
        visibilityListeners.add(listener);
        return () => visibilityListeners.delete(listener);
      },
    },
  });
  /** Resolves every wait of `ms` (the startup timer is 5000, the jitter 1000 here). */
  const elapse = async (ms: number) => {
    for (const each of waits.filter((entry) => entry.ms === ms)) each.resolve();
    await settle();
  };
  const channel = () => {
    const [first] = channels;
    if (first === undefined) throw new Error('Nothing is listened to.');
    return first;
  };
  /** Watches WS and lets it subscribe for the first time (which catches up from the head). */
  const subscribed = async () => {
    const release = live.watch(WS);
    await settle();
    channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    calls.length = 0;
    afters.length = 0;
    return release;
  };
  const setHidden = (value: boolean, at: number) => {
    hidden = value;
    time = at;
    for (const listener of visibilityListeners) listener();
  };
  return {
    live,
    mutations,
    channels,
    unlistened,
    trouble,
    calls,
    statuses,
    afters,
    waits,
    elapse,
    channel,
    subscribed,
    setHidden,
    opened: () => opened,
    closed: () => closed,
  };
}

const jitter = 0.5 * REFETCH_JITTER_MS;

describe('the watermark', () => {
  it('starts at the head and catches up from it on the first subscribe, then applies each next seq', async () => {
    const t = setup({
      head: 6,
      catchUp: (after) => Promise.resolve({ head: after + 1, reset: false, events: [event(after + 1)] }),
    });
    t.live.watch(WS);
    await settle();
    expect(t.channel()).toMatchObject({ name: `workspace:${WS}-id`, token: 'sub-token' });
    expect(t.live.watermark(WS)).toBe(6);
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    expect(t.afters).toEqual([6]);
    expect(t.calls).toEqual([`records ${WS} ${ROW(7)}`]);
    t.channel().onPublication(event(8));
    t.channel().onPublication(event(9, { recordIds: [ROW(1), ROW(2)] }));
    expect(t.calls.slice(1)).toEqual([`records ${WS} ${ROW(8)}`, `records ${WS} ${ROW(1)},${ROW(2)}`]);
    expect(t.live.watermark(WS)).toBe(9);
  });

  it('drops a repeat and a late lower seq', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onPublication(event(1));
    t.channel().onPublication(event(2));
    t.channel().onPublication(event(1));
    expect(t.calls).toEqual([`records ${WS} ${ROW(1)}`, `records ${WS} ${ROW(2)}`]);
  });

  it('fills a gap through catch up, then applies what arrived meanwhile in order, dropping what it covered', async () => {
    let answer: (value: CaughtUp) => void = () => undefined;
    const t = setup({
      catchUp: (after) =>
        after === 0
          ? Promise.resolve({ head: 0, reset: false, events: [] })
          : new Promise((resolve) => {
              answer = resolve;
            }),
    });
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onPublication(event(4));
    // After a spread, so a whole workspace doesn't ask at once.
    expect(t.afters).toEqual([]);
    await t.elapse(jitter);
    expect(t.afters).toEqual([1]);
    // While catching up, events wait.
    t.channel().onPublication(event(5));
    t.channel().onPublication(event(3));
    expect(t.calls).toEqual([`records ${WS} ${ROW(1)}`]);
    answer({ head: 3, reset: false, events: [event(3, { recordIds: [ROW(2), ROW(3)] })] });
    await settle();
    expect(t.calls).toEqual([
      `records ${WS} ${ROW(1)}`,
      `records ${WS} ${ROW(2)},${ROW(3)}`,
      `records ${WS} ${ROW(4)}`,
      `records ${WS} ${ROW(5)}`,
    ]);
    expect(t.live.watermark(WS)).toBe(5);
  });

  it("skips this tab's own write, and forgets its id once its echoes have come (spec 0006, AC-60)", async () => {
    const t = setup();
    await t.subscribed();
    t.mutations.sent(MUTATION);
    t.mutations.answered(MUTATION, 1);
    t.channel().onPublication(event(1, { mutationId: MUTATION }));
    expect(t.calls).toEqual([]);
    // Another write with the same id can only be someone else's now.
    t.channel().onPublication(event(2, { mutationId: MUTATION }));
    expect(t.calls).toEqual([`records ${WS} ${ROW(2)}`]);
  });

  it('moves the watermark past the stub and a kind it does not know, handing them to nobody (AC-79)', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication({ seq: 1, at: AT, kind: 'restricted' });
    t.channel().onPublication({ seq: 2, at: AT, kind: 'from-a-newer-server', things: [1] });
    t.channel().onPublication(event(3));
    expect(t.calls).toEqual([`records ${WS} ${ROW(3)}`]);
    expect(t.afters).toEqual([]);
    expect(t.live.watermark(WS)).toBe(3);
  });

  it('refetches attributes at once for definitions, and the whole object after 0 to 2 seconds when coarse', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication({ seq: 1, at: AT, kind: 'definitions', objectId: PEOPLE });
    t.channel().onPublication(event(2, { recordIds: [], coarse: true }));
    t.channel().onPublication(event(3, { recordIds: [], coarse: true }));
    expect(t.calls).toEqual([`definitions ${WS} ${PEOPLE}`]);
    await t.elapse(jitter);
    expect(t.calls).toEqual([`definitions ${WS} ${PEOPLE}`, `records ${WS}  coarse`]);
  });

  it('ignores anything that is not a change event', async () => {
    const t = setup();
    await t.subscribed();
    for (const data of [
      null,
      'x',
      { seq: 0, kind: 'records' },
      { ...event(1), recordIds: [1] },
      { ...event(1), kind: 3 },
    ]) {
      t.channel().onPublication(data);
    }
    expect(t.calls).toEqual([]);
    expect(t.live.watermark(WS)).toBe(0);
  });

  it('keeps the watermark across watches, and catches up from it when watched again', async () => {
    const t = setup();
    const release = await t.subscribed();
    t.channel().onPublication(event(1));
    release();
    t.live.watch(WS);
    await settle();
    t.channels[1]?.onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    expect(t.afters).toEqual([1]);
  });
});

describe('parsing', () => {
  it('keeps only the fields of each kind, and marks a kind it does not know', () => {
    expect(parseChangeEvent({ ...event(1, { mutationId: MUTATION }), extra: 'x' })).toEqual({
      seq: 1,
      mutationId: MUTATION,
      event: event(1, { mutationId: MUTATION }),
    });
    expect(parseChangeEvent({ seq: 4, at: AT, kind: 'members', memberIds: [ROW(1)] })?.event).toEqual({
      seq: 4,
      at: AT,
      kind: 'members',
      memberIds: [ROW(1)],
    });
    expect(parseChangeEvent({ seq: 4, kind: 'later', at: AT })).toEqual({
      seq: 4,
      mutationId: undefined,
      event: undefined,
    });
    expect(
      parseChangeEvent({ seq: 4, at: AT, kind: 'entries', entryIds: [], recordIds: [], attributeIds: [] }),
    ).toBeUndefined();
  });

  it('keeps the well formed entries of what a records event replaced (spec 0006)', () => {
    const entry = { recordId: ROW(1), attributeId: ROW(2), versionId: ROW(3), by: { type: 'member', id: ROW(4) } };
    const parsed = parseChangeEvent({
      ...event(1),
      replaced: [entry, { recordId: ROW(1) }, { ...entry, by: { type: 'robot', id: null } }],
    });
    expect(parsed?.event).toEqual({ ...event(1), replaced: [entry] });
    expect(parseChangeEvent({ ...event(1), replaced: [{ recordId: 1 }] })?.event).toEqual(event(1));
  });
});

describe('catching up', () => {
  it('waits for the recovered events after a recovered resubscribe, and catches up after 0 to 2 seconds when not', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onDown('resubscribing');
    t.channel().onSubscribed({ wasRecovering: true, recovered: true });
    await settle();
    expect(t.afters).toEqual([]);
    t.channel().onDown('resubscribing');
    t.channel().onSubscribed({ wasRecovering: true, recovered: false });
    await settle();
    expect(t.afters).toEqual([]);
    await t.elapse(jitter);
    expect(t.afters).toEqual([1]);
  });

  it('runs every store’s resync on a reset, and counts on from the head it answered (AC-73)', async () => {
    const t = setup({ catchUp: () => Promise.resolve({ head: 9_000, reset: true, events: [] }) });
    t.live.watch(WS);
    await settle();
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    expect(t.calls).toEqual([]);
    await t.elapse(jitter);
    expect(t.calls).toEqual([`resync ${WS}`]);
    expect(t.live.watermark(WS)).toBe(9_000);
    t.channel().onPublication(event(9_001));
    expect(t.calls).toEqual([`resync ${WS}`, `records ${WS} ${ROW(9_001)}`]);
  });

  it('with no head read before the first read, resyncs and catches up from the token’s head', async () => {
    const t = setup({
      head: undefined,
      token: () => Promise.resolve({ channel: 'workspace:x', token: 'sub-token', head: 12 }),
    });
    t.live.watch(WS);
    await settle();
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    expect(t.afters).toEqual([12]);
    await t.elapse(jitter);
    expect(t.calls).toEqual([`resync ${WS}`]);
  });

  it('catches up when the tab comes back after 5 minutes hidden, and not after less', async () => {
    const t = setup();
    await t.subscribed();
    t.setHidden(true, 0);
    t.setHidden(false, HIDDEN_CATCH_UP_MS - 1);
    await settle();
    expect(t.afters).toEqual([]);
    t.setHidden(true, HIDDEN_CATCH_UP_MS);
    t.setHidden(false, 2 * HIDDEN_CATCH_UP_MS);
    await settle();
    expect(t.afters).toEqual([0]);
  });

  it('says paused while a catch up fails, tries again with backoff, and is live once it lands', async () => {
    let tries = 0;
    const t = setup({
      catchUp: (after) => {
        tries += 1;
        if (tries === 2) return Promise.reject(new Error('offline'));
        return Promise.resolve({ head: Math.max(after, tries === 1 ? 0 : 2), reset: false, events: [] });
      },
    });
    await t.subscribed();
    t.channel().onPublication(event(2));
    await t.elapse(jitter);
    expect(t.statuses).toEqual(['paused']);
    await t.elapse(1500);
    expect(tries).toBe(3);
    expect(t.statuses).toEqual(['paused', 'live']);
  });

  it('tries again after a spread, never at once, when a catch up leaves the gap open', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(3));
    await t.elapse(jitter);
    // The fake answers its own watermark back: the gap stays, and only the spread brings the next try.
    expect(t.afters).toEqual([0]);
    await t.elapse(jitter);
    expect(t.afters).toEqual([0, 0]);
  });

  it('costs no call when a late seq closes a gap before the spread ends (out of order delivery)', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(2));
    t.channel().onPublication(event(1));
    expect(t.calls).toEqual([`records ${WS} ${ROW(1)}`, `records ${WS} ${ROW(2)}`]);
    await t.elapse(jitter);
    expect(t.afters).toEqual([]);
  });

  it('holds at most 5,000 deliveries while a catch up is due, and the catch up covers the rest', async () => {
    let calls = 0;
    const t = setup({
      catchUp: () => {
        calls += 1;
        return Promise.resolve({ head: calls === 1 ? 0 : 6_002, reset: false, events: [] });
      },
    });
    await t.subscribed();
    for (let seq = 2; seq <= 6_002; seq += 1) t.channel().onPublication(event(seq));
    await t.elapse(jitter);
    expect(t.afters).toEqual([0]);
    expect(t.live.watermark(WS)).toBe(6_002);
    t.channel().onPublication(event(6_003));
    expect(t.calls).toEqual([`records ${WS} ${ROW(6_003)}`]);
  });

  it('pauses and stops when catch up is refused (removed from the workspace)', async () => {
    const t = setup({ catchUp: () => Promise.resolve(undefined) });
    t.live.watch(WS);
    await settle();
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    await settle();
    expect(t.statuses).toEqual(['paused']);
    // Nothing tries again, however many events still arrive.
    t.channel().onPublication(event(5));
    await t.elapse(jitter);
    expect(t.afters).toEqual([0]);
    expect(t.calls).toEqual([]);
  });
});

describe('the live status', () => {
  it('is paused while a live subscription is down, and live again once it is back', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onDown('resubscribing');
    t.channel().onSubscribed({ wasRecovering: true, recovered: true });
    expect(t.statuses).toEqual(['paused', 'live']);
  });

  it('stays live while the first subscribe is under way, and pauses when it takes 5 seconds', async () => {
    const t = setup();
    t.live.watch(WS);
    await settle();
    t.channel().onDown('resubscribing');
    expect(t.statuses).toEqual([]);
    await t.elapse(5000);
    expect(t.statuses).toEqual(['paused']);
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    expect(t.statuses).toEqual(['paused', 'live']);
  });

  it('pauses when the connection fails before the first subscribe, or a subscribe fails', async () => {
    const t = setup();
    t.live.watch(WS);
    await settle();
    for (const listener of t.trouble) listener();
    expect(t.statuses).toEqual(['paused']);
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    t.channel().onDown('failed');
    expect(t.statuses).toEqual(['paused', 'live', 'paused']);
  });

  it('pauses without listening when the workspace refuses a token', async () => {
    const t = setup({ token: () => Promise.resolve(undefined) });
    t.live.watch(WS);
    await settle();
    expect(t.channels).toEqual([]);
    expect(t.statuses).toEqual(['paused']);
  });

  it('tries a failed token again with backoff', async () => {
    let tries = 0;
    const t = setup({
      token: () => {
        tries += 1;
        return tries === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ channel: 'workspace:x', token: 'sub-token', head: 0 });
      },
    });
    t.live.watch(WS);
    await settle();
    expect(t.statuses).toEqual(['paused']);
    await t.elapse(1500);
    expect(t.channel().name).toBe('workspace:x');
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    expect(t.statuses).toEqual(['paused', 'live']);
  });
});

describe('starting', () => {
  it('tries the client again with backoff when it fails to load, then listens and says live', async () => {
    const t = setup({ openFailures: 1 });
    t.live.watch(WS);
    await settle();
    expect(t.statuses).toEqual(['paused']);
    expect(t.live.status()).toBe('paused');
    await t.elapse(1500);
    expect(t.opened()).toBe(2);
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    expect(t.live.status()).toBe('live');
  });
});

describe('watching', () => {
  it('shares one connection and one subscription per workspace, and lets go when nobody watches', async () => {
    const t = setup();
    const first = t.live.watch(WS);
    const second = t.live.watch(WS);
    await settle();
    t.live.watch('other');
    await settle();
    expect(t.opened()).toBe(1);
    expect(t.channels.map((channel) => channel.name)).toEqual([`workspace:${WS}-id`, 'workspace:other-id']);
    first();
    first();
    expect(t.unlistened).toEqual([]);
    second();
    expect(t.unlistened).toEqual([`workspace:${WS}-id`]);
    expect(t.closed()).toBe(0);
    t.live.stop();
    await settle();
    expect(t.unlistened).toEqual([`workspace:${WS}-id`, 'workspace:other-id']);
    expect(t.closed()).toBe(1);
    expect(t.live.watermark(WS)).toBeUndefined();
  });

  it('applies nothing to a workspace nobody watches any more', async () => {
    const t = setup();
    const release = await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onPublication(event(2, { recordIds: [], coarse: true }));
    release();
    await t.elapse(jitter);
    expect(t.calls).toEqual([`records ${WS} ${ROW(1)}`]);
  });
});
