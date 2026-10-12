// One simulated user's live updates (spec 0011, AC-200, AC-207), as the
// browser's live layer does them (`packages/data/src/live/live.ts` and the
// records layer's `changed`):
// - it connects with `realtime.connectionToken` and subscribes with
//   `realtime.subscriptionToken`, whose `head` is the first watermark; a
//   failed token call tries again with backoff, as the browser does;
// - it skips an event carrying its own `mutationId`, and a stub only moves
//   the watermark;
// - records events of its object are gathered for a frame (16 ms), as the
//   browser's store does, then the records it holds are refetched in one
//   `records.get` with only the changed attributes the window reads (nothing
//   when the events name none of them);
// - a coarse event rereads the window and its count once, after a random 0
//   to 2 seconds, however many arrive meanwhile;
// - a records event that creates, deletes or restores records, names no
//   attributes, or changes one the view filters or sorts on marks the window
//   dirty: it settles (rereads the window and the count) 1.5 seconds after
//   the last such change, at most 5 seconds after the first, then a random 0
//   to 2 seconds on; a catch up answered `reset` rereads too;
// - a records event of another object is discarded (spec 0007's AC-91 share).
// Each event's refetch is a `delivery` sample carrying its commit time `at`,
// so the report joins live delivery (commit to visible) after the run; each
// live arrival's commit to arrival time goes to the thread's histogram. The
// storm's `reconnect` drops the connection and opens a new one with new
// tokens, recovering from the position the old one reached. Every call in
// flight is tracked, so the thread's drain waits for it.
import { createTally, type Answered, type Call } from '../tally.ts';
import type { Holder, Sample, Via } from '../user.ts';
import type { LiveConnection, OpenLiveConnection, StreamPosition } from './centrifuge.ts';
import type { LiveEvent, LiveRecordsEvent } from './event.ts';
import {
  backoffMs,
  CATCH_UP_JITTER_MS,
  createStream,
  type BackHow,
  type CaughtUpAnswer,
  type StreamDelivery,
  type StreamSnapshot,
  type StreamTally,
} from './stream.ts';

/** How long after the last reordering change a dirty window settles (`SETTLE_MS` in the records layer). */
export const SETTLE_MS = 1_500;
/** The longest a dirty window waits from its first change (`SETTLE_MAX_MS`). */
export const SETTLE_MAX_MS = 5_000;
/** How long a user gathers records events before refetching (the browser's frame). */
export const FRAME_MS = 16;

/** The live calls a user makes, as the contract names them. */
export interface LiveApi {
  readonly connectionToken: (call: Call) => Promise<{ readonly token: string }>;
  readonly subscriptionToken: (
    input: { readonly workspace: string },
    call: Call,
  ) => Promise<{ readonly channel: string; readonly token: string; readonly head: number }>;
  readonly catchUp: (
    input: { readonly workspace: string; readonly after: number },
    call: Call,
  ) => Promise<CaughtUpAnswer>;
}

/** What one live user is given. */
export interface LiveUserOptions {
  readonly user: number;
  readonly workspace: string;
  readonly api: LiveApi;
  readonly holder: Holder;
  readonly open: OpenLiveConnection;
  readonly url: string;
  readonly origin: string;
  /** Whether this user wrote a write by its mutation id (and forgets it): its own echo is skipped. */
  readonly ownEcho: (mutationId: string) => boolean;
  readonly now: () => number;
  readonly schedule: (ms: number, run: () => void) => void;
  readonly random: () => number;
  /** Whether a moment falls in the measured window. */
  readonly measured: (at: number) => boolean;
  readonly record: (sample: Sample) => void;
  /** A live event's commit to arrival, raw: arrival on our clock minus `at` on the database's (the offset joins later). */
  readonly arrival: (rawMs: number) => void;
  /** Hands the thread a call in flight, so its drain waits for it. */
  readonly track: (work: Promise<unknown>) => void;
}

/** What a live user counted, beside its stream's books. */
export interface LiveTally extends StreamTally {
  /** Events skipped as this user's own write coming back. */
  readonly ownEchoes: number;
  readonly stubs: number;
  /** Records events of this user's object, others' writes. */
  readonly recordsEvents: number;
  /** Records events of another object: nothing to do (spec 0007, AC-91). */
  readonly discarded: number;
  /** Events of other kinds, which a People table ignores. */
  readonly otherKinds: number;
}

/** The storm's reconnect, as this user saw it. */
export interface Reconnected {
  readonly droppedAt: number;
  readonly backAt?: number;
  readonly how?: BackHow;
}

/** One gathered event: when it arrived and how, for its delivery sample. */
interface Gathered {
  readonly event: LiveRecordsEvent;
  readonly receivedAt: number;
  readonly via: Via;
}

/** One user's live updates. */
export function createLiveUser(options: LiveUserOptions) {
  const { holder, now, schedule, random } = options;
  const counts = { ownEchoes: 0, stubs: 0, recordsEvents: 0, discarded: 0, otherKinds: 0 };
  let connection: LiveConnection | undefined;
  let channel: string | undefined;
  let subscribedOnce = false;
  let stopped = false;
  let reconnected: Reconnected | undefined;
  /** Bumped by every connect: a connect loop still retrying from before a reconnect gives up. */
  let generation = 0;
  const isStopped = () => stopped;

  /** Runs `run` after `ms`, tracked from now until it has started its work, so the drain waits for it. */
  function later(ms: number, run: () => void) {
    options.track(
      new Promise<void>((resolve) => {
        schedule(ms, () => {
          run();
          resolve();
        });
      }),
    );
  }

  /** Starts a call and hands it to the thread's drain. */
  function tracked<T>(work: Promise<T>): Promise<T> {
    options.track(work);
    return work;
  }

  /** One live call outside any action (a token, a catch up); a failure is a `live` sample, an unexpected error. */
  async function liveCall<T>(name: string, run: (call: Call) => Promise<T>): Promise<T | undefined> {
    const startedAt = now();
    const tally = createTally(now);
    const answer = await tracked(tally.call(run));
    if (answer.ok) return answer.value;
    const answered = tally.answered();
    options.record({
      user: options.user,
      action: 'live',
      metric: 'live',
      scheduledAt: startedAt,
      measured: options.measured(startedAt),
      ...answered,
      // The status first, so the report's 429 line counts it; the call after.
      reason: `${answered.reason ?? 'failed'} (${name})`,
    });
    return undefined;
  }

  /** A trouble report from the connection: an unexpected error in its own right. */
  function trouble(reason: string) {
    const at = now();
    options.record({
      user: options.user,
      action: 'live',
      metric: 'live',
      scheduledAt: at,
      answeredAt: at,
      outcome: 'unexpected',
      reason,
      measured: options.measured(at),
      requests: 0,
      poolMs: [],
      appMs: [],
    });
  }

  /** Records a refetch an event caused, with the event's commit time. */
  function delivered(kind: 'delivery' | 'settle', startedAt: number, answered: Answered, extras: Partial<Sample>) {
    options.record({
      user: options.user,
      action: 'live',
      metric: kind,
      scheduledAt: startedAt,
      measured: options.measured(startedAt),
      ...extras,
      ...answered,
    });
  }

  /** The delivery sample's extras for one event. */
  const extrasOf = (gathered: Gathered): Partial<Sample> => ({
    via: gathered.via,
    atMs: gathered.event.atMs,
    ...(gathered.event.mutationId === undefined ? {} : { mutationId: gathered.event.mutationId }),
  });

  // A dirty window's settle (spec 0006, AC-56): 1.5 s after the last change, at most 5 s after the first, then a
  // random 0 to 2 s more.
  let dirtySince: number | undefined;
  let dirtyLast = 0;
  let settleDue = false;
  const settleAt = () => Math.min(dirtyLast + SETTLE_MS, (dirtySince ?? dirtyLast) + SETTLE_MAX_MS);
  function markDirty() {
    const at = now();
    dirtySince ??= at;
    dirtyLast = at;
    if (settleDue) return;
    settleDue = true;
    const check = () => {
      if (stopped) return;
      const wait = settleAt() - now();
      if (wait > 0) {
        schedule(wait, check);
        return;
      }
      dirtySince = undefined;
      settleDue = false;
      schedule(random() * CATCH_UP_JITTER_MS, () => {
        if (stopped) return;
        const startedAt = now();
        void tracked(holder.reread()).then((answered) => delivered('settle', startedAt, answered, {}));
      });
    };
    schedule(settleAt() - at, check);
  }

  // Coarse events: one reread after the spread however many arrive meanwhile, each event timed to its answer.
  let coarse: Gathered[] | undefined;
  function onCoarse(gathered: Gathered) {
    if (coarse !== undefined) {
      coarse.push(gathered);
      return;
    }
    coarse = [gathered];
    later(random() * CATCH_UP_JITTER_MS, () => {
      const waiting = coarse ?? [];
      coarse = undefined;
      if (stopped) return;
      void tracked(holder.reread()).then((answered) => {
        for (const each of waiting) delivered('delivery', each.receivedAt, answered, extrasOf(each));
      });
    });
  }

  // A frame's records events, refetched together.
  let frame: Gathered[] | undefined;
  function flushFrame() {
    const events = frame ?? [];
    frame = undefined;
    if (stopped || events.length === 0) return;
    const window = holder.windowIds();
    const ids = new Set<string>();
    const attributes = new Set<string>();
    const waiting: Gathered[] = [];
    for (const gathered of events) {
      const { event } = gathered;
      const created = new Set(event.createdIds);
      const held = event.recordIds.filter((id) => window.has(id) && !created.has(id));
      // Only the changed attributes the window reads; an event naming none it reads fetches nothing.
      const wanted = event.attributeIds.filter((attributeId) => holder.columns.has(attributeId));
      if (held.length === 0 || wanted.length === 0) continue;
      for (const id of held) ids.add(id);
      for (const attributeId of wanted) attributes.add(attributeId);
      waiting.push(gathered);
    }
    if (waiting.length === 0) return;
    void tracked(holder.refetch([...ids], [...attributes])).then((answered) => {
      for (const each of waiting) delivered('delivery', each.receivedAt, answered, extrasOf(each));
    });
  }

  /** A records event of this user's object: settle on a reorder, reload on coarse, refetch what it holds. */
  function onRecords(event: LiveRecordsEvent, receivedAt: number, via: Via) {
    const gathered: Gathered = { event, receivedAt, via };
    if (event.coarse) {
      onCoarse(gathered);
      return;
    }
    const lifecycle = event.createdIds.length + event.deletedIds.length + event.restoredIds.length > 0;
    const viewAttributes = holder.viewAttributeIds();
    if (
      lifecycle ||
      event.attributeIds.length === 0 ||
      event.attributeIds.some((attributeId) => viewAttributes.has(attributeId))
    ) {
      markDirty();
    }
    if (frame !== undefined) {
      frame.push(gathered);
      return;
    }
    frame = [gathered];
    later(FRAME_MS, flushFrame);
  }

  /** Counts what arrived in the measured window only. */
  const count = (name: keyof typeof counts, at: number) => {
    if (options.measured(at)) counts[name] += 1;
  };

  function onEvent(event: LiveEvent, receivedAt: number, via: Via) {
    if (event.kind === 'restricted') {
      count('stubs', receivedAt);
      return;
    }
    if (event.kind === 'other') {
      count('otherKinds', receivedAt);
      return;
    }
    if (event.objectId !== holder.objectId) {
      count('discarded', receivedAt);
      return;
    }
    count('recordsEvents', receivedAt);
    onRecords(event, receivedAt, via);
  }

  /** Rereads the window after a spread: a catch up answered `reset`, so what it shows may be stale. */
  function resync() {
    schedule(random() * CATCH_UP_JITTER_MS, () => {
      if (stopped) return;
      const startedAt = now();
      void tracked(holder.reread()).then((answered) => delivered('settle', startedAt, answered, {}));
    });
  }

  const stream = createStream({
    now,
    schedule,
    random,
    measured: options.measured,
    apply: (delivery: StreamDelivery) => {
      const { event } = delivery;
      // Commit to arrival, for live events only: a recovered replay's arrival is the drop's length.
      if (delivery.via === 'live' && options.measured(delivery.receivedAt)) {
        options.arrival(delivery.receivedAt - event.atMs);
      }
      // This user's own write coming back: its answer already showed it.
      const mutationId = event.kind === 'restricted' ? undefined : event.mutationId;
      if (mutationId !== undefined && options.ownEcho(mutationId)) {
        count('ownEchoes', delivery.receivedAt);
        return;
      }
      onEvent(event, delivery.receivedAt, delivery.via);
    },
    applyCaughtUp: (event, receivedAt) => onEvent(event, receivedAt, 'catchUp'),
    onReset: resync,
    catchUp: (after) =>
      liveCall('realtime.catchUp', (call) => options.api.catchUp({ workspace: options.workspace, after }, call)),
    onBack: (how, at) => {
      if (reconnected !== undefined && reconnected.backAt === undefined) {
        reconnected = { ...reconnected, backAt: at, how };
      }
    },
  });

  const connectionToken = async () => {
    const answer = await liveCall('realtime.connectionToken', (call) => options.api.connectionToken(call));
    if (answer === undefined) throw new Error('No connection token.');
    return answer.token;
  };
  const subscriptionToken = () =>
    liveCall('realtime.subscriptionToken', (call) =>
      options.api.subscriptionToken({ workspace: options.workspace }, call),
    );

  /**
   * Subscribes with a fresh subscription token (its head is the first
   * watermark, or how far the workspace got while away), recovering from
   * `since`. A refused token call tries again with backoff until the run
   * stops, as the browser does.
   */
  async function connect(since?: StreamPosition) {
    generation += 1;
    const mine = generation;
    const stale = () => isStopped() || generation !== mine;
    for (let failures = 0; !stale(); failures += 1) {
      const granted = await subscriptionToken();
      if (stale()) return;
      if (granted === undefined) {
        await new Promise<void>((resolve) => {
          schedule(backoffMs(failures, random), resolve);
        });
        continue;
      }
      stream.start(granted.head);
      channel = granted.channel;
      connection = options.open({
        url: options.url,
        origin: options.origin,
        connectionToken,
        channel: granted.channel,
        token: granted.token,
        renew: async () => {
          const fresh = await subscriptionToken();
          if (fresh === undefined) throw new Error('No subscription token.');
          return fresh.token;
        },
        ...(since === undefined ? {} : { since }),
        handlers: {
          publication: (data) => stream.publication(data),
          subscribed: (info) => {
            const first = !subscribedOnce;
            subscribedOnce = true;
            stream.subscribed({ first, ...info });
          },
          trouble,
        },
      });
      return;
    }
  }

  return {
    /**
     * Connects and subscribes, as a browser does before its first read. Not
     * tracked as a whole: its calls are, but a user waiting out a token's
     * backoff mustn't hold the drain.
     */
    start: () => connect(),
    /** The storm's reconnect (AC-207): drop the connection, then open a new one with new tokens, recovering. */
    reconnect: () => {
      const since = connection?.position();
      connection?.close();
      connection = undefined;
      reconnected = { droppedAt: now() };
      return connect(since);
    },
    /** The window ended: the books, and what the user knew. */
    freeze: (): { tally: LiveTally; snapshot: StreamSnapshot; reconnected?: Reconnected } => ({
      tally: { ...stream.tally(), ...counts },
      snapshot: stream.freeze(),
      ...(reconnected === undefined ? {} : { reconnected }),
    }),
    /** Closes the connection and stops every timer's work. */
    stop: () => {
      stopped = true;
      stream.stop();
      connection?.close();
      connection = undefined;
    },
    /** The channel subscribed to, for tests. */
    channel: () => channel,
    /** The watermark, for tests. */
    watermark: () => stream.watermark(),
  };
}

/** One live user. */
export type LiveUser = ReturnType<typeof createLiveUser>;
