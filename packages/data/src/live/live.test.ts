// Live updates against a fake realtime client (spec 0005, the data layer's
// tests): the seq contract (apply the next, drop repeats and late ones, a gap
// refetches the workspace), this tab's own echoes skipped, recovery, the
// paused status, and one connection shared by every watch.
import type { ChangeEvent } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createLive, parseChangeEvent, REFETCH_JITTER_MS, type LiveChannel, type LiveTransport } from './live.ts';
import { createMutationLog } from './mutations.ts';

const WS = 'acme';
const PEOPLE = '0199a6f2-0000-7000-8000-00000000000a';
const ROW = (n: number) => `0199a6f2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const MUTATION = '0199a6f2-0000-7000-8000-0000000000ff';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const event = (seq: number, more: Partial<ChangeEvent> = {}): ChangeEvent => ({
  seq,
  kind: 'records',
  objectId: PEOPLE,
  recordIds: [ROW(seq)],
  attributeIds: [],
  ...more,
});

/** createLive on a fake client, with its waits, the handlers' calls and the status in the test's hands. */
function setup(options: { readonly token?: () => Promise<{ channel: string; token: string } | undefined> } = {}) {
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
  const mutations = createMutationLog();
  const live = createLive({
    url: 'ws://centrifugo.test/connection/websocket',
    connectionToken: () => Promise.resolve('connection-token'),
    subscriptionToken:
      options.token ?? ((workspace) => Promise.resolve({ channel: `workspace:${workspace}-id`, token: 'sub-token' })),
    open: () => {
      opened += 1;
      return Promise.resolve(transport);
    },
    handlers: {
      records: (workspace, objectId, ids) => calls.push(`records ${workspace} ${objectId} ${ids.join(',')}`),
      object: (workspace, objectId) => calls.push(`object ${workspace} ${objectId}`),
      definitions: (workspace, objectId) => calls.push(`definitions ${workspace} ${objectId}`),
      workspace: (workspace) => calls.push(`workspace ${workspace}`),
    },
    mutations,
    onStatus: (status) => statuses.push(status),
    wait: (ms) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, resolve });
      }),
    random: () => 0.5,
    startupMs: 5000,
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
  /** Watches WS and lets it subscribe for the first time (which refetches what is held once). */
  const subscribed = async () => {
    const release = live.watch(WS);
    await settle();
    channel().onSubscribed({ wasRecovering: false, recovered: false });
    calls.length = 0;
    return release;
  };
  return {
    live,
    mutations,
    channels,
    unlistened,
    trouble,
    calls,
    statuses,
    waits,
    elapse,
    channel,
    subscribed,
    opened: () => opened,
    closed: () => closed,
  };
}

const jitter = 0.5 * REFETCH_JITTER_MS;

describe('the seq contract', () => {
  it('fetches what is held once on the first subscribe, then applies each next seq', async () => {
    const t = setup();
    t.live.watch(WS);
    await settle();
    expect(t.channel()).toMatchObject({ name: `workspace:${WS}-id`, token: 'sub-token' });
    t.channel().onSubscribed({ wasRecovering: false, recovered: false });
    expect(t.calls).toEqual([`workspace ${WS}`]);

    t.channel().onPublication(event(7));
    t.channel().onPublication(event(8, { recordIds: [ROW(1), ROW(2)] }));
    expect(t.calls.slice(1)).toEqual([
      `records ${WS} ${PEOPLE} ${ROW(7)}`,
      `records ${WS} ${PEOPLE} ${ROW(1)},${ROW(2)}`,
    ]);
  });

  it('drops a repeat and a late lower seq', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(3));
    t.channel().onPublication(event(3));
    t.channel().onPublication(event(2));
    t.channel().onPublication(event(4));
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(3)}`, `records ${WS} ${PEOPLE} ${ROW(4)}`]);
  });

  it('treats a jump past the next seq as a gap: the workspace again after 0 to 2 seconds, then on from there', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(3));
    t.channel().onPublication(event(6));
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(3)}`]);
    await t.elapse(jitter);
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(3)}`, `workspace ${WS}`]);
    // The ones the gap skipped arrive late: already covered.
    t.channel().onPublication(event(4));
    t.channel().onPublication(event(5));
    t.channel().onPublication(event(7));
    expect(t.calls.slice(2)).toEqual([`records ${WS} ${PEOPLE} ${ROW(7)}`]);
  });

  it("skips this tab's own write, and forgets its id once it has echoed", async () => {
    const t = setup();
    await t.subscribed();
    t.mutations.sent(MUTATION);
    t.channel().onPublication(event(1, { mutationId: MUTATION }));
    expect(t.calls).toEqual([]);
    // Another write with the same id can only be someone else's now.
    t.channel().onPublication(event(2, { mutationId: MUTATION }));
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(2)}`]);
  });

  it("still counts a gap when the jump is this tab's own write", async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.mutations.sent(MUTATION);
    t.channel().onPublication(event(3, { mutationId: MUTATION }));
    await t.elapse(jitter);
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(1)}`, `workspace ${WS}`]);
  });

  it('refetches attributes at once for definitions, and the whole object after 0 to 2 seconds when coarse', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1, { kind: 'definitions', recordIds: [] }));
    t.channel().onPublication(event(2, { recordIds: [], coarse: true }));
    expect(t.calls).toEqual([`definitions ${WS} ${PEOPLE}`]);
    expect(t.waits.map((each) => each.ms)).toContain(jitter);
    await t.elapse(jitter);
    expect(t.calls).toEqual([`definitions ${WS} ${PEOPLE}`, `object ${WS} ${PEOPLE}`]);
  });

  it('ignores anything that is not a change event', async () => {
    const t = setup();
    await t.subscribed();
    for (const data of [null, 'x', { seq: 0 }, { ...event(1), kind: 'other' }, { ...event(1), recordIds: [1] }]) {
      t.channel().onPublication(data);
    }
    expect(t.calls).toEqual([]);
    expect(parseChangeEvent(event(1, { mutationId: MUTATION }))).toEqual(event(1, { mutationId: MUTATION }));
  });
});

describe('recovery', () => {
  it('waits for the recovered events after a recovered resubscribe, and refetches nothing', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onDown('resubscribing');
    t.channel().onSubscribed({ wasRecovering: true, recovered: true });
    t.channel().onPublication(event(2));
    await t.elapse(jitter);
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(1)}`, `records ${WS} ${PEOPLE} ${ROW(2)}`]);
  });

  it('refetches the workspace after 0 to 2 seconds when recovery failed, and counts again from the next event', async () => {
    const t = setup();
    await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onDown('resubscribing');
    t.channel().onSubscribed({ wasRecovering: true, recovered: false });
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(1)}`]);
    // The next event is a new start, not a gap.
    t.channel().onPublication(event(40));
    await t.elapse(jitter);
    expect(t.calls).toEqual([
      `records ${WS} ${PEOPLE} ${ROW(1)}`,
      `records ${WS} ${PEOPLE} ${ROW(40)}`,
      `workspace ${WS}`,
    ]);
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
          : Promise.resolve({ channel: 'workspace:x', token: 'sub-token' });
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
  });

  it('applies nothing to a workspace nobody watches any more', async () => {
    const t = setup();
    const release = await t.subscribed();
    t.channel().onPublication(event(1));
    t.channel().onPublication(event(5));
    release();
    await t.elapse(jitter);
    expect(t.calls).toEqual([`records ${WS} ${PEOPLE} ${ROW(1)}`]);
  });
});
