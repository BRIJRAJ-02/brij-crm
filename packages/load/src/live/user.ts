// One simulated user's live updates (spec 0011, AC-200, AC-207), as the
// browser's live layer does them (`packages/data/src/live/live.ts` and the
// records layer's `changed`):
// - it connects with `realtime.connectionToken` and subscribes with
//   `realtime.subscriptionToken`, whose `head` is the first watermark;
// - it skips an event carrying its own `mutationId`, and a stub only moves
//   the watermark;
// - a records event of its object refetches the records it holds
//   (`records.get` with only the changed attributes the window reads,
//   nothing when the event names none of them); a coarse one rereads the
//   window and its count after a random 0 to 2 seconds;
// - a records event that creates, deletes or restores records, names no
//   attributes, or changes one the view filters or sorts on marks the window
//   dirty: it settles (rereads the window and the count) 1.5 seconds after
//   the last such change, at most 5 seconds after the first, then a random 0
//   to 2 seconds on;
// - a records event of another object is discarded (spec 0007's AC-91 share).
// Each refetch is a `delivery` sample carrying the event's commit time `at`,
// so the report joins live delivery (commit to visible) after the run; each
// arrival's commit to arrival time is kept too. The storm's `reconnect` drops
// the connection and opens a new one with new tokens, recovering from the
// position the old one reached.
import type { ChangeEvent } from '@crm/contracts';

import { createTally, type Answered, type Call } from '../tally.ts';
import type { Holder, Sample, Via } from '../user.ts';
import type { LiveConnection, OpenLiveConnection, StreamPosition } from './centrifuge.ts';
import {
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
  /** This user's own writes' mutation ids, still waiting for their echo. */
  readonly ownMutations: Set<string>;
  readonly now: () => number;
  readonly schedule: (ms: number, run: () => void) => void;
  readonly random: () => number;
  /** Whether a moment falls in the measured window. */
  readonly measured: (at: number) => boolean;
  readonly record: (sample: Sample) => void;
  /** An event's commit to arrival, raw: arrival on our clock minus `at` on the database's (the offset joins later). */
  readonly arrival: (rawMs: number) => void;
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

/** A records event. */
type RecordsEvent = Extract<ChangeEvent, { kind: 'records' }>;

/** Records ids of a records event the user can't hold yet: the ones the write made. */
const createdOf = (event: RecordsEvent) => new Set(event.createdIds ?? []);

/** One user's live updates. */
export function createLiveUser(options: LiveUserOptions) {
  const { holder, now, schedule, random } = options;
  const counts = { ownEchoes: 0, stubs: 0, recordsEvents: 0, discarded: 0, otherKinds: 0 };
  let connection: LiveConnection | undefined;
  let channel: string | undefined;
  let subscribedOnce = false;
  let stopped = false;
  let reconnected: Reconnected | undefined;

  /** One live call outside any action (a token, a catch up); a failure is a `live` sample, an unexpected error. */
  async function liveCall<T>(name: string, run: (call: Call) => Promise<T>): Promise<T | undefined> {
    const startedAt = now();
    const tally = createTally(now);
    const answer = await tally.call(run);
    if (answer.ok) return answer.value;
    const answered = tally.answered();
    options.record({
      user: options.user,
      action: 'live',
      metric: 'live',
      scheduledAt: startedAt,
      measured: options.measured(startedAt),
      ...answered,
      reason: `${name}: ${answered.reason ?? 'failed'}`,
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
        void holder.reread().then((answered) => delivered('settle', startedAt, answered, {}));
      });
    };
    schedule(settleAt() - at, check);
  }

  /** A records event of this user's object: refetch what it holds, reload on coarse, settle on a reorder. */
  function onRecords(event: RecordsEvent, receivedAt: number, via: Via) {
    const atMs = Date.parse(event.at);
    const extras = { via, atMs, ...(event.mutationId === undefined ? {} : { mutationId: event.mutationId }) };
    if (event.coarse === true) {
      // Once per object however many arrive meanwhile would be the browser's; one user holds one object.
      schedule(random() * CATCH_UP_JITTER_MS, () => {
        if (stopped) return;
        void holder.reread().then((answered) => delivered('delivery', receivedAt, answered, extras));
      });
      return;
    }
    const lifecycle =
      (event.createdIds?.length ?? 0) + (event.deletedIds?.length ?? 0) + (event.restoredIds?.length ?? 0) > 0;
    const viewAttributes = holder.viewAttributeIds();
    if (
      lifecycle ||
      event.attributeIds.length === 0 ||
      event.attributeIds.some((attributeId) => viewAttributes.has(attributeId))
    ) {
      markDirty();
    }
    const window = holder.windowIds();
    const created = createdOf(event);
    const held = event.recordIds.filter((id) => window.has(id) && !created.has(id));
    if (held.length === 0) return;
    // Only the changed attributes the window reads; an event naming none it reads fetches nothing.
    const attributeIds =
      event.attributeIds.length === 0
        ? [...holder.columns]
        : event.attributeIds.filter((attributeId) => holder.columns.has(attributeId));
    if (attributeIds.length === 0) return;
    void holder.refetch(held, attributeIds).then((answered) => delivered('delivery', receivedAt, answered, extras));
  }

  /** Counts what arrived in the measured window only. */
  const count = (name: keyof typeof counts, at: number) => {
    if (options.measured(at)) counts[name] += 1;
  };

  function onEvent(event: ChangeEvent | undefined, receivedAt: number, via: Via) {
    if (event === undefined) return;
    if (event.kind === 'restricted') {
      count('stubs', receivedAt);
      return;
    }
    if (event.kind !== 'records') {
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

  const stream = createStream({
    now,
    schedule,
    random,
    measured: options.measured,
    apply: (delivery: StreamDelivery) => {
      const { event } = delivery;
      if (event !== undefined && options.measured(delivery.receivedAt)) {
        options.arrival(delivery.receivedAt - Date.parse(event.at));
      }
      // This user's own write coming back: its answer already showed it.
      const mutationId = event !== undefined && 'mutationId' in event ? event.mutationId : undefined;
      if (mutationId !== undefined && options.ownMutations.delete(mutationId)) {
        count('ownEchoes', delivery.receivedAt);
        return;
      }
      onEvent(event, delivery.receivedAt, delivery.via);
    },
    applyCaughtUp: (event, receivedAt) => onEvent(event, receivedAt, 'catchUp'),
    catchUp: (after) =>
      liveCall('realtime.catchUp', (call) => options.api.catchUp({ workspace: options.workspace, after }, call)),
    onBack: (how, at) => {
      if (reconnected !== undefined && reconnected.backAt === undefined)
        reconnected = { ...reconnected, backAt: at, how };
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

  /** Subscribes with a fresh subscription token (its head is the first watermark), recovering from `since`. */
  async function connect(since?: StreamPosition) {
    const granted = await subscriptionToken();
    if (granted === undefined || stopped) return;
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
  }

  return {
    /** Connects and subscribes, as a browser does before its first read. */
    start: () => connect(),
    /** The storm's reconnect (AC-207): drop the connection, then open a new one with new tokens, recovering. */
    reconnect: async () => {
      const since = connection?.position();
      connection?.close();
      connection = undefined;
      reconnected = { droppedAt: now() };
      await connect(since);
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
