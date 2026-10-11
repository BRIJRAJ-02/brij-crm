// One thread's share of a run (spec 0011, AC-197, AC-200, AC-203): its
// users, each with its own client, minted cookie and live connection, and
// their planned joins and arrivals, dispatched at their planned moments
// without waiting for earlier answers (the open model). It keeps the measured
// window's samples, each event's commit to arrival time, what each user's
// live stream counted and knew when the window closed, how many of its
// planned actions it sent on time, and its own event loop delay, so a harness
// that can't keep up makes the run invalid rather than slow.
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { newId } from '@crm/core';
import { createLoadClient, liveApiOf, loadApiOf } from './client.ts';
import { openLiveConnection } from './live/centrifuge.ts';
import type { StreamSnapshot } from './live/stream.ts';
import { createLiveUser, type LiveTally, type LiveUser, type Reconnected } from './live/user.ts';
import type { Arrival, Burst, Join } from './plan.ts';
import type { LoadAction } from '@crm/core/scale-budget';
import { createRandom } from './random.ts';
import type { ObjectKey } from './shapes.ts';
import { createLoadUser, type Behaviour, type ObjectModel, type Sample } from './user.ts';

/** An action sent within this long of its planned moment counts as sent on time. */
export const ON_TIME_MS = 1_000;
/** How long a thread waits for its last answers after the window ends (a cursor jump can take many calls). */
export const DRAIN_MS = 60_000;

/** One user a thread drives. */
export interface ThreadUser {
  /** The user's place in the plan (0 based). */
  readonly index: number;
  /** Its seed number: `load-user-<n>@example.com`. */
  readonly n: number;
  readonly cookie: string;
  readonly memberId: string;
  readonly object: ObjectKey;
}

/** What a thread is given (all of it structured clone safe). */
export interface DriveInput {
  readonly apiUrl: string;
  readonly workspace: string;
  /** When the run's clock reads 0, in milliseconds since the epoch. */
  readonly runStartMs: number;
  readonly warmupMs: number;
  readonly measuredMs: number;
  readonly seed: number;
  readonly behaviour: Behaviour;
  readonly memberIds: readonly string[];
  readonly models: Readonly<Record<ObjectKey, ObjectModel>>;
  readonly users: readonly ThreadUser[];
  /** This thread's users' joins and arrivals, in time order. */
  readonly joins: readonly Join[];
  readonly arrivals: readonly Arrival[];
  /** Centrifugo's WebSocket endpoint and the `Origin` its handshake carries (the API's), or undefined for no live. */
  readonly live?: { readonly url: string; readonly origin: string };
  /** The storm (AC-207): this thread's users' burst edits, and when every live connection drops (ms from the start). */
  readonly bursts?: readonly Burst[];
  readonly reconnectAt?: number;
  /**
   * A test flag (`LOAD_TEST_BLOCK_LOOP_MS`): block this thread's event loop
   * this long every 100 ms, so a harness that can't keep up is shown to make
   * the run invalid. Absent in every real run.
   */
  readonly blockLoopMs?: number;
}

/** One user's live books when the window closed. */
export interface LiveOutput {
  readonly user: number;
  readonly tally: LiveTally;
  readonly snapshot: StreamSnapshot;
  readonly reconnected?: Reconnected;
}

/** What a thread hands back. */
export interface DriveOutput {
  readonly samples: readonly Sample[];
  /** Each measured event arrival: our arrival time minus its `at` on the database's clock (the offset joins later). */
  readonly arrivalsRawMs: readonly number[];
  readonly live: readonly LiveOutput[];
  readonly planned: number;
  readonly sent: number;
  readonly loopDelayP99Ms: number;
}

/** What each action of the mix is measured as. */
const METRIC_OF: Readonly<Record<LoadAction, Sample['metric']>> = {
  scroll: 'read',
  filterSort: 'read',
  open: 'open',
  edit: 'edit',
  create: 'create',
};

/** Milliseconds since the epoch, on a clock every thread shares. */
export const wallClock = (): number => performance.timeOrigin + performance.now();

/** What happens at a planned moment: a user joins, acts, edits in a burst, or drops its live connection. */
type Event =
  | { readonly kind: 'join'; readonly user: number; readonly at: number }
  | { readonly kind: 'arrival'; readonly user: number; readonly at: number; readonly arrival: Arrival }
  | { readonly kind: 'burst'; readonly user: number; readonly at: number; readonly slot: number }
  | { readonly kind: 'reconnect'; readonly user: number; readonly at: number };

/** A timer that never keeps the thread alive on its own. */
const schedule = (ms: number, run: () => void) => {
  setTimeout(run, Math.max(0, ms)).unref();
};

/** Plays this thread's users through the run, and answers when every action has answered (or the drain ran out). */
export async function drive(input: DriveInput): Promise<DriveOutput> {
  const samples: Sample[] = [];
  const arrivalsRawMs: number[] = [];
  const measuredStart = input.runStartMs + input.warmupMs;
  const measuredEnd = measuredStart + input.measuredMs;
  const measured = (at: number) => at >= measuredStart && at <= measuredEnd;
  const record = (sample: Sample) => {
    if (sample.measured) samples.push(sample);
  };
  const lives = new Map<number, LiveUser>();
  const users = new Map(
    input.users.map((user) => {
      const model = input.models[user.object];
      const client = createLoadClient(input.apiUrl, user.cookie);
      // This user's writes, until their echo comes back (or never: a refused write stores no event).
      const ownMutations = new Set<string>();
      const loadUser = createLoadUser({
        user: user.index,
        workspace: input.workspace,
        memberId: user.memberId,
        memberIds: input.memberIds,
        model,
        api: loadApiOf(client),
        random: createRandom(input.seed, `user:${String(user.index)}`),
        behaviour: input.behaviour,
        now: wallClock,
        newId,
        mutationId: () => {
          const mutationId = randomUUID();
          ownMutations.add(mutationId);
          return mutationId;
        },
        record,
      });
      if (input.live !== undefined) {
        lives.set(
          user.index,
          createLiveUser({
            user: user.index,
            workspace: input.workspace,
            api: liveApiOf(client),
            holder: loadUser.holder,
            open: openLiveConnection,
            url: input.live.url,
            origin: input.live.origin,
            ownMutations,
            now: wallClock,
            schedule,
            random: createRandom(input.seed, `live:${String(user.index)}`).next,
            measured,
            record,
            arrival: (rawMs) => arrivalsRawMs.push(rawMs),
          }),
        );
      }
      return [user.index, loadUser] as const;
    }),
  );
  const reconnectAt = input.reconnectAt;
  const events: Event[] = [
    ...input.joins.map((join: Join) => ({ kind: 'join' as const, user: join.user, at: join.at })),
    ...input.arrivals.map((arrival) => ({ kind: 'arrival' as const, user: arrival.user, at: arrival.at, arrival })),
    ...(input.bursts ?? []).map((burst) => ({ kind: 'burst' as const, ...burst })),
    ...(reconnectAt === undefined
      ? []
      : input.users.map((user) => ({ kind: 'reconnect' as const, user: user.index, at: reconnectAt }))),
  ].sort((left, right) => left.at - right.at);

  const loop = monitorEventLoopDelay({ resolution: 10 });
  const startLoop = setTimeout(() => loop.enable(), Math.max(0, measuredStart - wallClock()));
  const blocking =
    input.blockLoopMs === undefined
      ? undefined
      : setInterval(() => {
          const until = performance.now() + (input.blockLoopMs ?? 0);
          while (performance.now() < until) {
            // Busy on purpose: the test flag stalls this thread.
          }
        }, 100);
  // Each action in flight, with what an unfinished one is recorded as when the drain runs out.
  const pending = new Map<Promise<void>, Sample>();
  let planned = 0;
  let sent = 0;

  const dispatch = (event: Event, now: number) => {
    const due = input.runStartMs + event.at;
    const user = users.get(event.user);
    if (user === undefined) return;
    // The storm's drop: the connection, not an action, so nothing waits for it.
    if (event.kind === 'reconnect') {
      void lives.get(event.user)?.reconnect();
      return;
    }
    // A user connects as it joins, as a browser does before its first read; the connection isn't an action.
    if (event.kind === 'join') void lives.get(event.user)?.start();
    const isMeasured =
      event.kind === 'join' ? due >= measuredStart : event.kind === 'arrival' ? event.arrival.measured : measured(due);
    const work =
      event.kind === 'join'
        ? user.join(due, isMeasured)
        : event.kind === 'arrival'
          ? user.act(event.arrival.action, due, isMeasured)
          : user.burst(due, isMeasured, event.slot);
    if (event.kind !== 'join' && isMeasured) {
      planned += 1;
      if (now - due <= ON_TIME_MS) sent += 1;
    }
    const unfinished: Sample = {
      user: event.user,
      action: event.kind === 'join' ? 'join' : event.kind === 'arrival' ? event.arrival.action : 'edit',
      metric: event.kind === 'join' ? 'read' : event.kind === 'arrival' ? METRIC_OF[event.arrival.action] : 'edit',
      ...(event.kind === 'burst' ? { burst: true } : {}),
      scheduledAt: due,
      answeredAt: due,
      outcome: 'unexpected',
      reason: 'unfinished',
      measured: isMeasured,
      requests: 0,
      poolMs: [],
      appMs: [],
    };
    pending.set(work, unfinished);
    void work.finally(() => pending.delete(work));
  };

  await new Promise<void>((resolve) => {
    let next = 0;
    const tick = () => {
      const now = wallClock();
      while (next < events.length) {
        const event = events[next];
        if (event === undefined || input.runStartMs + event.at > now) break;
        dispatch(event, now);
        next += 1;
      }
      const upcoming = events[next];
      if (upcoming === undefined) {
        resolve();
        return;
      }
      setTimeout(tick, Math.max(0, input.runStartMs + upcoming.at - wallClock()));
    };
    tick();
  });
  // The window's end: what each live user counted and knew then. Then the stragglers.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, measuredEnd - wallClock())));
  const live: LiveOutput[] = [...lives].map(([user, liveUser]) => ({ user, ...liveUser.freeze() }));
  clearTimeout(startLoop);
  clearInterval(blocking);
  loop.disable();
  const drained = Promise.allSettled([...pending.keys()]);
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, DRAIN_MS))]);
  // What still hasn't answered never will in this run: an unexpected error, not a silence.
  const now = wallClock();
  for (const sample of pending.values()) if (sample.measured) samples.push({ ...sample, answeredAt: now });
  for (const liveUser of lives.values()) liveUser.stop();
  return {
    samples,
    arrivalsRawMs,
    live,
    planned,
    sent,
    loopDelayP99Ms: loop.count === 0 ? 0 : loop.percentile(99) / 1e6,
  };
}
