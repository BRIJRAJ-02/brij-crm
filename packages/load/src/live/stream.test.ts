// The seq contract as a simulated user keeps it (spec 0011, AC-200, AC-212):
// events apply in order from the head, a gap is caught up after a random 0 to
// 2 seconds and counts as a catch up, not a miss; a gap nothing covers within
// 10 seconds is missed, once; a late seq inside the 10 seconds is simply
// delivered; a recovered resubscription replays as `recovered`; and the seqs a
// user never heard of are found after the run from its snapshot.
import { describe, expect, it } from 'vitest';
import { fakeTimers } from './fake-timers.ts';
import { createStream, MISS_AFTER_MS, trailingMisses, type BackHow, type CaughtUpAnswer } from './stream.ts';

const WORKSPACE_OBJECT = '00000000-0000-7000-8000-000000000001';
const RECORD = '00000000-0000-7000-8000-000000000002';

/** A records event at `seq`, committed at `at` (ms). */
const event = (seq: number, at = 0) => ({
  seq,
  at: new Date(at).toISOString(),
  kind: 'records',
  objectId: WORKSPACE_OBJECT,
  recordIds: [RECORD],
  attributeIds: [],
});

function stream(
  options: {
    catchUp?: (after: number) => Promise<CaughtUpAnswer | undefined>;
    measured?: (at: number) => boolean;
  } = {},
) {
  const timers = fakeTimers(1_000);
  const applied: { seq: number; via: string }[] = [];
  const caughtUp: number[] = [];
  const asked: number[] = [];
  const back: BackHow[] = [];
  const made = createStream({
    now: timers.now,
    schedule: timers.schedule,
    random: () => 0.5,
    measured: options.measured ?? (() => true),
    apply: (delivery) => applied.push({ seq: delivery.seq, via: delivery.via }),
    applyCaughtUp: (caught) => caughtUp.push(caught.seq),
    catchUp:
      options.catchUp ??
      ((after) => {
        asked.push(after);
        return Promise.resolve({ head: after, reset: false, events: [] });
      }),
    onBack: (how) => back.push(how),
  });
  return { made, timers, applied, caughtUp, asked, back };
}

describe('the watermark', () => {
  it('starts at the head, applies in order, drops repeats, and catches up from the head on the first subscribe', async () => {
    const { made, timers, applied, asked } = stream();
    made.start(10);
    made.subscribed({ first: true, wasRecovering: false, recovered: false });
    await timers.advance(0);
    expect(asked).toEqual([10]);
    made.publication(event(10));
    made.publication(event(11));
    made.publication(event(12));
    made.publication(event(11));
    expect(applied).toEqual([
      { seq: 11, via: 'live' },
      { seq: 12, via: 'live' },
    ]);
    expect(made.watermark()).toBe(12);
    expect(made.tally()).toMatchObject({ applied: 2, missed: 0, caughtUp: 0 });
  });

  it('holds what comes after a gap, and applies it once the gap closes by itself (no catch up, no miss)', async () => {
    const { made, timers, applied, asked } = stream();
    made.start(0);
    made.publication(event(2));
    expect(applied).toEqual([]);
    // The late seq lands before the 0 to 2 second spread runs out: no call.
    made.publication(event(1));
    expect(applied.map((each) => each.seq)).toEqual([1, 2]);
    await timers.advance(MISS_AFTER_MS + 1_000);
    expect(asked).toEqual([]);
    expect(made.tally()).toMatchObject({ missed: 0, caughtUp: 0 });
  });

  it('catches up a gap from W after the spread: a catch up, not a miss', async () => {
    const answers: CaughtUpAnswer[] = [{ head: 3, reset: false, events: [event(3)] }];
    const asked: number[] = [];
    const { made, timers, applied, caughtUp } = stream({
      catchUp: (after) => {
        asked.push(after);
        return Promise.resolve(answers.shift() ?? { head: after, reset: false, events: [] });
      },
    });
    made.start(1);
    made.publication(event(4));
    await timers.advance(2_000);
    expect(asked).toEqual([1]);
    expect(caughtUp).toEqual([3]);
    expect(applied.map((each) => each.seq)).toEqual([4]);
    expect(made.watermark()).toBe(4);
    await timers.advance(MISS_AFTER_MS);
    expect(made.tally()).toMatchObject({ caughtUp: 2, missed: 0, catchUpCalls: 1 });
  });

  it('counts a gap nothing covers within 10 seconds as missed, once, even when it lands later', async () => {
    // The catch up keeps failing (so what lands meanwhile waits behind it, as in the browser).
    const { made, timers } = stream({ catchUp: () => Promise.resolve(undefined) });
    made.start(0);
    made.publication(event(2));
    await timers.advance(MISS_AFTER_MS - 1);
    expect(made.tally().missed).toBe(0);
    await timers.advance(1);
    expect(made.tally().missed).toBe(1);
    made.publication(event(1));
    await timers.advance(MISS_AFTER_MS);
    expect(made.tally().missed).toBe(1);
    expect(made.tally().catchUpCalls).toBeGreaterThan(1);
  });

  it('counts only gaps opened in the measured window', async () => {
    const { made, timers } = stream({ catchUp: () => Promise.resolve(undefined), measured: () => false });
    made.start(0);
    made.publication(event(3));
    await timers.advance(MISS_AFTER_MS * 2);
    expect(made.tally().missed).toBe(0);
  });

  it("replays a recovered resubscription's missed publications as recovered, and says it is back", async () => {
    const { made, applied, back } = stream();
    made.start(0);
    made.subscribed({ first: true, wasRecovering: false, recovered: false });
    made.publication(event(1));
    made.subscribed({ first: false, wasRecovering: true, recovered: true });
    made.publication(event(2));
    made.publication(event(3));
    await Promise.resolve();
    made.publication(event(4));
    expect(applied).toEqual([
      { seq: 1, via: 'live' },
      { seq: 2, via: 'recovered' },
      { seq: 3, via: 'recovered' },
      { seq: 4, via: 'live' },
    ]);
    expect(back).toEqual(['recovered']);
    expect(made.tally().recovered).toBe(2);
  });

  it('catches up an unrecovered resubscription after the spread, and says it is back once caught up', async () => {
    const asked: number[] = [];
    const { made, timers, back } = stream({
      catchUp: (after) => {
        asked.push(after);
        return Promise.resolve({ head: 7, reset: false, events: [] });
      },
    });
    made.start(2);
    made.subscribed({ first: false, wasRecovering: true, recovered: false });
    await timers.advance(2_000);
    expect(asked).toEqual([2]);
    expect(made.watermark()).toBe(7);
    expect(back).toEqual(['caughtUp']);
  });

  it('starts the count from the first event when no head was read', () => {
    const { made, applied } = stream();
    made.publication(event(40));
    expect(applied.map((each) => each.seq)).toEqual([40]);
  });
});

describe('trailingMisses', () => {
  it('counts the seqs up to the head a user neither held nor already counted missed', () => {
    expect(trailingMisses({ watermark: 10, accounted: [] }, 10, 0)).toBe(0);
    expect(trailingMisses({ watermark: 10, accounted: [12, 13] }, 14, 0)).toBe(2);
    // Past the head: not yet due.
    expect(trailingMisses({ watermark: 10, accounted: [20] }, 12, 0)).toBe(2);
    // Never subscribed: everything since the window opened.
    expect(trailingMisses({ watermark: undefined, accounted: [] }, 30, 25)).toBe(5);
  });

  it('pairs with freeze: a gap still open at the end is counted there, not twice', async () => {
    const { made, timers } = stream({ catchUp: () => Promise.resolve(undefined) });
    made.start(0);
    made.publication(event(3));
    const snapshot = made.freeze();
    await timers.advance(MISS_AFTER_MS);
    expect(made.tally().missed).toBe(0);
    expect(snapshot).toEqual({ watermark: 0, accounted: [3] });
    expect(trailingMisses(snapshot, 3, 0)).toBe(2);
  });
});
