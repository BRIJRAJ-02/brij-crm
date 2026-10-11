// When each user acts, and what it does (spec 0011, AC-197): an open model.
// Each user joins at its place in a ramp over the warm up, then acts at
// exponential gaps (a Poisson process at the budget's rate) until the end,
// whether or not its earlier actions answered. Every arrival is planned before
// the run starts, so a slow server can't slow the arrivals down; the time of
// each action is measured from its planned moment.
//
// Which action an arrival is follows the budget's mix through a low
// discrepancy sequence over the arrivals in time order (a golden ratio Weyl
// sequence), rather than a fresh draw each time: any stretch of the run, the
// measured window included, then holds the mix to within a point, where
// independent draws would drift by several on a short run.
import type { LoadAction, ScaleBudget } from '@crm/core/scale-budget';
import { createRandom } from './random.ts';

/** The mix's actions, in the fixed order the sequence maps onto. */
export const MIX_ACTIONS: readonly LoadAction[] = ['scroll', 'filterSort', 'open', 'edit', 'create'];

/** The load model's mix: a share per action. */
export type Mix = ScaleBudget['load']['mix'];

/** One planned action: which user, when (milliseconds from the run's start) and what. */
export interface Arrival {
  readonly user: number;
  readonly at: number;
  readonly action: LoadAction;
  /** Whether it falls in the measured window (after the warm up). */
  readonly measured: boolean;
}

/** A user joining: it opens its first view at `at`, during the warm up. */
export interface Join {
  readonly user: number;
  readonly at: number;
}

/** Every arrival of a run, in time order, and when each user joins. */
export interface ArrivalPlan {
  readonly joins: readonly Join[];
  readonly arrivals: readonly Arrival[];
}

/** What a plan needs: how many users, their rate, the warm up and measured window, the mix and the seed. */
export interface PlanInput {
  readonly users: number;
  readonly actionsPerUserPerSecond: number;
  readonly warmupMs: number;
  readonly measuredMs: number;
  readonly mix: Mix;
  readonly seed: number;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The action at point `u` in [0, 1) of the mix's cumulative shares. */
export function actionAt(u: number, mix: Mix): LoadAction {
  let total = 0;
  for (const action of MIX_ACTIONS) {
    total += mix[action];
    if (u < total) return action;
  }
  return MIX_ACTIONS[MIX_ACTIONS.length - 1] ?? 'scroll';
}

/**
 * Plans a run: user `i` (0 based) joins at `i / users` of the warm up, then
 * acts at exponential gaps with mean `1 / rate` until the measured window
 * ends. Arrivals in the warm up are sent but not measured.
 */
export function planArrivals(input: PlanInput): ArrivalPlan {
  const end = input.warmupMs + input.measuredMs;
  const meanGapMs = 1_000 / input.actionsPerUserPerSecond;
  const joins: Join[] = [];
  const times: { user: number; at: number }[] = [];
  for (let user = 0; user < input.users; user += 1) {
    const random = createRandom(input.seed, `arrivals:${String(user)}`);
    const joinAt = (input.warmupMs * user) / input.users;
    joins.push({ user, at: joinAt });
    for (let at = joinAt + random.exponential(meanGapMs); at < end; at += random.exponential(meanGapMs)) {
      times.push({ user, at });
    }
  }
  times.sort((left, right) => left.at - right.at || left.user - right.user);
  const offset = createRandom(input.seed, 'mix').next();
  const arrivals = times.map(({ user, at }, index) => ({
    user,
    at,
    action: actionAt((offset + index * GOLDEN) % 1, input.mix),
    measured: at >= input.warmupMs,
  }));
  return { joins, arrivals };
}

/** The share of each action among `actions`. */
export function achievedMix(actions: readonly LoadAction[]): Record<LoadAction, number> {
  const counts = Object.fromEntries(MIX_ACTIONS.map((action) => [action, 0])) as Record<LoadAction, number>;
  for (const action of actions) counts[action] += 1;
  const total = Math.max(actions.length, 1);
  return Object.fromEntries(MIX_ACTIONS.map((action) => [action, counts[action] / total])) as Record<
    LoadAction,
    number
  >;
}

/** A storm burst's edit (AC-207): which user, when, and the row of its window it edits. */
export interface Burst {
  readonly user: number;
  readonly at: number;
  /** The row the user edits, so users holding the same window edit different records. */
  readonly slot: number;
}

/** The storm's extras: a burst every `everyMs`, and the moment every live connection drops. */
export interface StormPlan {
  readonly bursts: readonly Burst[];
  readonly reconnectAt: number;
}

/**
 * Plans the storm (AC-207): from `everyMs` into the measured window, every
 * `everyMs`, every online user edits once at a random moment within the same
 * second; and at the middle of the window every live connection drops and
 * reconnects.
 */
export function planStorm(input: {
  readonly users: number;
  readonly warmupMs: number;
  readonly measuredMs: number;
  readonly everyMs: number;
  readonly seed: number;
}): StormPlan {
  const random = createRandom(input.seed, 'storm');
  const end = input.warmupMs + input.measuredMs;
  const bursts: Burst[] = [];
  for (let start = input.warmupMs + input.everyMs; start < end; start += input.everyMs) {
    for (let user = 0; user < input.users; user += 1) {
      const at = start + random.next() * 1_000;
      if (at < end) bursts.push({ user, at, slot: user });
    }
  }
  bursts.sort((left, right) => left.at - right.at);
  return { bursts, reconnectAt: input.warmupMs + input.measuredMs / 2 };
}

/** The largest gap, in points (0.01 = one point), between an achieved mix and the budget's. */
export function mixDeviation(achieved: Readonly<Record<LoadAction, number>>, mix: Mix): number {
  return Math.max(...MIX_ACTIONS.map((action) => Math.abs(achieved[action] - mix[action])));
}
