// One simulated user's side of the seq contract (spec 0011, AC-200; spec
// 0007), mirroring the browser's live layer (`packages/data/src/live/live.ts`)
// and keeping the books the report needs. Pure: the clock, timers, the random
// source and the catch up call come in as arguments.
//
// It keeps a watermark `W`, the last contiguous `seq` applied, starting at the
// head `realtime.subscriptionToken` answered:
// - at or below `W`: a repeat, dropped;
// - `W + 1`: applied (handed to `apply`), and becomes `W`, with any held
//   after it;
// - past `W + 1`: held (5,000 at most, as the browser), and every seq between
//   opens a gap; a catch up from `W` runs after a random 0 to 2 seconds (a
//   late seq that closes the gap first costs no call), and what arrived
//   meanwhile follows in order.
// A first subscription catches up from `W` at once. A resubscription opens a
// gap for every seq up to the head its new token carried (the seqs committed
// while it was away); Centrifugo's recovery replays them at once (applied as
// `recovered`), or else a catch up fills them after a random 0 to 2 seconds.
// A failed catch up tries again with backoff (1 second doubling to 30,
// spread); one answered `reset` asks the user to reread what it shows.
//
// The miss rule (AC-200): a gap's seq that no event, stub or catch up covers
// within 10 seconds of the gap opening is missed (once, even if it lands
// later); one a catch up covers is caught up, reported, not a miss; one that
// arrives late by itself within the 10 seconds is simply delivered. A seq the
// user never hears of at all (nothing after it arrived) is found after the run
// from its snapshot and the workspace's head (`trailingMisses`).
import { parseLiveEvent, type LiveEvent } from './event.ts';

/** A gap's seq not covered within this long is missed. */
export const MISS_AFTER_MS = 10_000;
/** The longest spread before a catch up that many users would make at once. */
export const CATCH_UP_JITTER_MS = 2_000;
/** The longest wait between tries at a failed call (a catch up, a token). */
export const MAX_RETRY_MS = 30_000;
/** The most deliveries held while waiting for a catch up (the browser's `MAX_HELD`); the catch up covers the rest. */
export const MAX_HELD = 5_000;

/** The wait before try `failures + 1` of a failed call: 1 second doubling to 30, spread by `random`. */
export const backoffMs = (failures: number, random: () => number) =>
  Math.min(MAX_RETRY_MS, 1_000 * 2 ** failures) * (1 + random());

/** How a seq reached the user: live, replayed by Centrifugo's recovery, or through `realtime.catchUp`. */
export type StreamVia = 'live' | 'recovered' | 'catchUp';

/** One applied seq and its event. */
export interface StreamDelivery {
  readonly event: LiveEvent;
  readonly receivedAt: number;
  readonly via: Exclude<StreamVia, 'catchUp'>;
}

/** What `realtime.catchUp` answered, or undefined when the call failed (tried again with backoff). */
export interface CaughtUpAnswer {
  readonly head: number;
  readonly reset: boolean;
  readonly events: readonly unknown[];
}

/** How a resubscription came back: Centrifugo recovered it, a catch up filled it, or the outbox said reset. */
export type BackHow = 'recovered' | 'caughtUp' | 'reset';

/** What a stream needs. */
export interface StreamOptions {
  readonly now: () => number;
  /** Runs `run` after `ms`; the stream never holds a timer of its own. */
  readonly schedule: (ms: number, run: () => void) => void;
  /** A number in [0, 1). */
  readonly random: () => number;
  /** Whether a moment falls in the measured window: only gaps opened then can be missed. */
  readonly measured: (at: number) => boolean;
  /** A seq applied in order, live or recovered (the stub and other kinds too). */
  readonly apply: (delivery: StreamDelivery) => void;
  /** An event a catch up answered (collapsed, with no `mutationId`). */
  readonly applyCaughtUp: (event: LiveEvent, receivedAt: number) => void;
  /** A catch up answered `reset`: reread everything shown, after a spread. */
  readonly onReset?: () => void;
  /** `realtime.catchUp` from `after`; undefined when the call failed. */
  readonly catchUp: (after: number) => Promise<CaughtUpAnswer | undefined>;
  /** A resubscription is whole again (the storm's recovery time, AC-207). */
  readonly onBack?: (how: BackHow, at: number) => void;
}

/** The stream's books, for the report. */
export interface StreamTally {
  /** Seqs applied in order, live or recovered, that arrived in the window. */
  readonly applied: number;
  /** Of those, Centrifugo's recovery replayed. */
  readonly recovered: number;
  /** Gap seqs a catch up covered (gaps opened in the window). */
  readonly caughtUp: number;
  /** Gap seqs nothing covered within 10 seconds (gaps opened in the window). */
  readonly missed: number;
  /** `realtime.catchUp` calls, failed ones included. */
  readonly catchUpCalls: number;
  /** Catch ups answered `reset`. */
  readonly resets: number;
}

/** What the user knew at the window's end: its watermark, and the seqs past it it holds or already counted missed. */
export interface StreamSnapshot {
  readonly watermark: number | undefined;
  readonly accounted: readonly number[];
}

/** A new stream; `start(head)` sets its first watermark. */
export function createStream(options: StreamOptions) {
  const { now, schedule, random } = options;
  let watermark: number | undefined;
  /** The highest seq heard of (applied, held, caught up or known committed), so each gap seq opens once. */
  let highest = 0;
  /** The head a resubscription's new token carried, until it subscribes. */
  let resubscribedHead: number | undefined;
  const held = new Map<number, StreamDelivery>();
  /** Open gap seqs, by when they opened. */
  const gaps = new Map<number, number>();
  const missedSeqs = new Set<number>();
  let catching = false;
  let again = false;
  let dueCatchUp = false;
  let replaying = false;
  let stopped = false;
  let frozen = false;
  /** A resubscription waiting for its catch up before it counts as back. */
  let awaitingBack = false;
  const tally = { applied: 0, recovered: 0, caughtUp: 0, missed: 0, catchUpCalls: 0, resets: 0 };
  // Read through functions: an await may have changed them.
  const isStopped = () => stopped;
  const askedAgain = () => again;

  /** Applies held seqs from `W + 1` on, in order; true when one is still held past a gap. */
  const drain = (): boolean => {
    if (watermark === undefined) return held.size > 0;
    for (;;) {
      const next = held.get(watermark + 1);
      if (next === undefined) break;
      held.delete(watermark + 1);
      watermark += 1;
      gaps.delete(watermark);
      if (options.measured(next.receivedAt)) {
        tally.applied += 1;
        if (next.via === 'recovered') tally.recovered += 1;
      }
      options.apply(next);
    }
    for (const seq of held.keys()) if (seq <= watermark) held.delete(seq);
    return held.size > 0;
  };

  /** Opens a gap for every seq after the highest heard of up to `last`, all checked once, 10 seconds on. */
  const openGapsThrough = (last: number, at: number) => {
    const from = Math.max(highest, watermark ?? 0) + 1;
    highest = Math.max(highest, last);
    if (from > last) return;
    const opened: number[] = [];
    for (let gap = from; gap <= last; gap += 1) {
      if (held.has(gap) || gaps.has(gap) || missedSeqs.has(gap)) continue;
      gaps.set(gap, at);
      opened.push(gap);
    }
    if (opened.length === 0) return;
    schedule(MISS_AFTER_MS, () => {
      if (stopped || frozen) return;
      for (const gap of opened) {
        if (!gaps.has(gap)) continue;
        gaps.delete(gap);
        missedSeqs.add(gap);
        if (options.measured(at)) tally.missed += 1;
      }
    });
  };

  /** Catches up after a random 0 to 2 seconds, once however many gaps open meanwhile. */
  const catchUpLater = () => {
    if (dueCatchUp) return;
    dueCatchUp = true;
    schedule(random() * CATCH_UP_JITTER_MS, () => {
      dueCatchUp = false;
      if (stopped) return;
      if (awaitingBack || drain() || gaps.size > 0) void fill();
    });
  };

  /** Catches up from `W`, then applies what arrived meanwhile; again while a gap remains. One at a time. */
  const fill = async (): Promise<void> => {
    if (catching) {
      again = true;
      return;
    }
    catching = true;
    try {
      for (let failures = 0; !stopped;) {
        again = false;
        const after = watermark;
        if (after === undefined) return;
        tally.catchUpCalls += 1;
        const answer = await options.catchUp(after);
        if (isStopped()) return;
        if (answer === undefined) {
          await new Promise<void>((resolve) => {
            schedule(backoffMs(failures, random), resolve);
          });
          failures += 1;
          continue;
        }
        failures = 0;
        const at = now();
        if (answer.reset) {
          tally.resets += 1;
          options.onReset?.();
        } else {
          for (const data of answer.events) {
            const event = parseLiveEvent(data);
            if (event !== undefined) options.applyCaughtUp(event, at);
          }
        }
        // Every gap the answer reaches is covered: a catch up, not a miss.
        for (const [gap, openedAt] of gaps) {
          if (gap > answer.head) continue;
          gaps.delete(gap);
          if (options.measured(openedAt)) tally.caughtUp += 1;
        }
        watermark = answer.reset ? answer.head : Math.max(after, answer.head);
        highest = Math.max(highest, watermark);
        const gap = drain();
        if (awaitingBack) {
          awaitingBack = false;
          options.onBack?.(answer.reset ? 'reset' : 'caughtUp', at);
        }
        if (askedAgain()) continue;
        if (gap || gaps.size > 0) catchUpLater();
        return;
      }
    } finally {
      catching = false;
    }
  };

  return {
    /**
     * The head a subscription token carried: the first watermark, or, on a
     * resubscription, how far the workspace got while the user was away.
     */
    start: (head: number) => {
      if (watermark === undefined) {
        watermark = head;
        highest = Math.max(highest, head);
      } else {
        resubscribedHead = head;
      }
    },
    /** Subscribed: the first time, catch up from `W` at once; after a drop, as Centrifugo recovered it or not. */
    subscribed: (info: { readonly first: boolean; readonly wasRecovering: boolean; readonly recovered: boolean }) => {
      if (stopped) return;
      if (info.first) {
        void fill();
        return;
      }
      // What was committed while away is a gap until a replay or a catch up covers it.
      if (resubscribedHead !== undefined) openGapsThrough(resubscribedHead, now());
      resubscribedHead = undefined;
      if (info.wasRecovering && info.recovered) {
        // The missed publications follow in the same task: they are recovered, not live.
        replaying = true;
        queueMicrotask(() => {
          replaying = false;
        });
        options.onBack?.('recovered', now());
        return;
      }
      awaitingBack = true;
      catchUpLater();
    },
    /** A publication on the channel. */
    publication: (data: unknown) => {
      if (stopped) return;
      const event = parseLiveEvent(data);
      if (event === undefined) return;
      const receivedAt = now();
      if (watermark !== undefined && event.seq <= watermark) return;
      // No watermark at all: this event starts the count.
      watermark ??= event.seq - 1;
      gaps.delete(event.seq);
      openGapsThrough(event.seq - 1, receivedAt);
      highest = Math.max(highest, event.seq);
      // Past the cap only while a catch up is due or running, which reads to the head and covers them.
      if (held.size >= MAX_HELD) held.clear();
      held.set(event.seq, { event, receivedAt, via: replaying ? 'recovered' : 'live' });
      if (catching) return;
      if (drain() || gaps.size > 0) catchUpLater();
    },
    /** The books so far. */
    tally: (): StreamTally => ({ ...tally }),
    /** Stops counting misses (the window ended) and answers what the user knew then. */
    freeze: (): StreamSnapshot => {
      frozen = true;
      const above = (seq: number) => watermark === undefined || seq > watermark;
      return {
        watermark,
        accounted: [...new Set([...held.keys(), ...missedSeqs])].filter(above).sort((left, right) => left - right),
      };
    },
    /** Stops everything: no more catch ups, timers do nothing. */
    stop: () => {
      stopped = true;
    },
    /** The watermark, for tests. */
    watermark: () => watermark,
  };
}

/** A stream. */
export type Stream = ReturnType<typeof createStream>;

/**
 * The seqs a user never heard of by the window's end (AC-200): those up to
 * `head` (the last seq committed at least 10 seconds before the end) past its
 * watermark that it neither held nor had already counted missed. A user with
 * no watermark at all never subscribed: everything since `startHead` (the
 * head when the window opened) is missed.
 */
export function trailingMisses(snapshot: StreamSnapshot, head: number, startHead: number): number {
  const from = snapshot.watermark ?? startHead;
  if (head <= from) return 0;
  const accounted = snapshot.accounted.filter((seq) => seq > from && seq <= head).length;
  return head - from - accounted;
}
