// One thread's share of a run (spec 0011, AC-197, AC-203): its users, each
// with its own client and minted cookie, and their planned joins and
// arrivals, dispatched at their planned moments without waiting for earlier
// answers (the open model). It keeps the measured window's samples, how many
// of its planned actions it sent on time, and its own event loop delay, so a
// harness that can't keep up makes the run invalid rather than slow.
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { newId } from '@crm/core';
import { createLoadClient, loadApiOf } from './client.ts';
import type { Arrival, Join } from './plan.ts';
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
  /**
   * A test flag (`LOAD_TEST_BLOCK_LOOP_MS`): block this thread's event loop
   * this long every 100 ms, so a harness that can't keep up is shown to make
   * the run invalid. Absent in every real run.
   */
  readonly blockLoopMs?: number;
}

/** What a thread hands back. */
export interface DriveOutput {
  readonly samples: readonly Sample[];
  readonly planned: number;
  readonly sent: number;
  readonly loopDelayP99Ms: number;
}

/** Milliseconds since the epoch, on a clock every thread shares. */
export const wallClock = (): number => performance.timeOrigin + performance.now();

type Event = { readonly kind: 'join'; readonly join: Join } | { readonly kind: 'arrival'; readonly arrival: Arrival };

/** Plays this thread's users through the run, and answers when every action has answered (or the drain ran out). */
export async function drive(input: DriveInput): Promise<DriveOutput> {
  const samples: Sample[] = [];
  const users = new Map(
    input.users.map((user) => {
      const model = input.models[user.object];
      const loadUser = createLoadUser({
        user: user.index,
        workspace: input.workspace,
        memberId: user.memberId,
        memberIds: input.memberIds,
        model,
        api: loadApiOf(createLoadClient(input.apiUrl, user.cookie)),
        random: createRandom(input.seed, `user:${String(user.index)}`),
        behaviour: input.behaviour,
        now: wallClock,
        newId,
        mutationId: randomUUID,
        record: (sample) => {
          if (sample.measured) samples.push(sample);
        },
      });
      return [user.index, loadUser] as const;
    }),
  );
  const events: Event[] = [
    ...input.joins.map((join) => ({ kind: 'join' as const, join })),
    ...input.arrivals.map((arrival) => ({ kind: 'arrival' as const, arrival })),
  ].sort((left, right) => atOf(left) - atOf(right));

  const loop = monitorEventLoopDelay({ resolution: 10 });
  const measuredStart = input.runStartMs + input.warmupMs;
  const measuredEnd = measuredStart + input.measuredMs;
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
  const pending = new Set<Promise<void>>();
  let planned = 0;
  let sent = 0;

  const dispatch = (event: Event, now: number) => {
    const due = input.runStartMs + atOf(event);
    const user = users.get(event.kind === 'join' ? event.join.user : event.arrival.user);
    if (user === undefined) return;
    const work =
      event.kind === 'join'
        ? user.join(due, due >= measuredStart)
        : user.act(event.arrival.action, due, event.arrival.measured);
    if (event.kind === 'arrival' && event.arrival.measured) {
      planned += 1;
      if (now - due <= ON_TIME_MS) sent += 1;
    }
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };

  await new Promise<void>((resolve) => {
    let next = 0;
    const tick = () => {
      const now = wallClock();
      while (next < events.length) {
        const event = events[next];
        if (event === undefined || input.runStartMs + atOf(event) > now) break;
        dispatch(event, now);
        next += 1;
      }
      const upcoming = events[next];
      if (upcoming === undefined) {
        resolve();
        return;
      }
      setTimeout(tick, Math.max(0, input.runStartMs + atOf(upcoming) - wallClock()));
    };
    tick();
  });
  // The window's end, then its stragglers.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, measuredEnd - wallClock())));
  clearTimeout(startLoop);
  clearInterval(blocking);
  loop.disable();
  const drained = Promise.allSettled([...pending]);
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, DRAIN_MS))]);
  return { samples, planned, sent, loopDelayP99Ms: loop.count === 0 ? 0 : loop.percentile(99) / 1e6 };
}

function atOf(event: Event): number {
  return event.kind === 'join' ? event.join.at : event.arrival.at;
}
