// The scenarios `pnpm load:run` plays (spec 0011, AC-197, AC-205, AC-207,
// AC-208): their users, minutes, whether a miss fails them, how their users
// jump and pick records, and the storm's extras. Users and minutes default
// from here and `SCALE_BUDGET`, and `--users` and `--minutes` override them.
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import type { Behaviour } from './user.ts';

/** The scenarios' names. */
export const SCENARIO_NAMES = ['steady', 'spread', 'hub', 'storm', 'thousand'] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** The storm's extras (AC-207): a burst every `burstEveryMs`, and every live connection dropped mid window. */
export interface Storm {
  readonly burstEveryMs: number;
}

/** The hub's extras (AC-206): one user renames the hub every `editEveryMs` while the rest link people to it. */
export interface Hub {
  readonly editEveryMs: number;
  /** The hub's people each user moves (its own, so no two users move the same person). */
  readonly peoplePerUser: number;
}

/** A scenario `pnpm load:run` plays. */
export interface Scenario {
  /** A gate exits 1 on a judged miss; the rest exit by validity only. */
  readonly gate: boolean;
  readonly users: number;
  readonly minutes: number;
  readonly behaviour: Behaviour;
  readonly storm?: Storm;
  readonly hub?: Hub;
}

/** The warm up every scenario ramps its users over, unmeasured. */
export const WARMUP_SECONDS = 60;

/**
 * The share of scrolls that jump rather than move by 1 to 3 windows: a person
 * drags the scrollbar now and then and mostly scrolls. A model choice, not a
 * target (the targets live in `SCALE_BUDGET`).
 */
export const JUMP_SHARE = 0.2;

/**
 * Users per harness thread (spec 0011, task 20): a run spreads its users over
 * this many per worker thread unless `--threads` says otherwise, so 1,000
 * users take 4 threads, each with its own event loop check (AC-203).
 */
export const USERS_PER_THREAD = 250;

/** The threads a run of `users` takes by default: one per 250 users. */
export const threadsFor = (users: number): number => Math.max(1, Math.ceil(users / USERS_PER_THREAD));

/** How often the storm's bursts come (AC-207). */
export const BURST_EVERY_MS = 10_000;

/** How often the hub is renamed in `hub` (AC-206). */
export const HUB_EDIT_EVERY_MS = 10_000;

const steadyBehaviour: Behaviour = { jumps: 'near-top', picks: 'window', jumpShare: JUMP_SHARE };

/** Every scenario. */
export const SCENARIOS: Readonly<Record<ScenarioName, Scenario>> = {
  steady: {
    gate: true,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: steadyBehaviour,
  },
  // Cold cache reads over the whole million: every jump, open and edit drawn evenly over the object (AC-205).
  spread: {
    gate: true,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: { jumps: 'even', picks: 'samples', jumpShare: JUMP_SHARE },
  },
  // 100 users on the steady mix, where half the edits move a person to or from the hub and a fifth of the opens
  // read it, while one user renames the hub every 10 seconds (AC-206). Reported, not judged: #41 judges it.
  hub: {
    gate: false,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: steadyBehaviour,
    hub: { editEveryMs: HUB_EDIT_EVERY_MS, peoplePerUser: 20 },
  },
  // The steady mix, a burst of edits every 10 seconds, and every live connection dropped at once mid window
  // (AC-207). Reported, not judged: #41 judges it.
  storm: {
    gate: false,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: steadyBehaviour,
    storm: { burstEveryMs: BURST_EVERY_MS },
  },
  // 1,000 users, each a different seeded member with its own session, on the steady mix for 5 measured minutes
  // (AC-208). It prints every verdict but exits by validity only: the budget at 1,000 is judged in #41.
  thousand: {
    gate: false,
    users: SCALE_BUDGET.online.room,
    minutes: 5,
    behaviour: steadyBehaviour,
  },
};
