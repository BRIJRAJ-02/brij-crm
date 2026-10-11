// The scenarios `pnpm load:run` plays (spec 0011, AC-197, AC-205, AC-207,
// AC-208): their users, minutes, whether a miss fails them, how their users
// jump and pick records, and the storm's extras. Users and minutes default
// from here and `SCALE_BUDGET`, and `--users` and `--minutes` override them.
// `hub` and `thousand` arrive with milestone 4.
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import type { Behaviour } from './user.ts';

/** The scenarios' names. */
export const SCENARIO_NAMES = ['steady', 'spread', 'hub', 'storm', 'thousand'] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** The storm's extras (AC-207): a burst every `burstEveryMs`, and every live connection dropped mid window. */
export interface Storm {
  readonly burstEveryMs: number;
}

/** A scenario this milestone runs. */
export interface Scenario {
  readonly built: true;
  /** A gate exits 1 on a judged miss; the rest exit by validity only. */
  readonly gate: boolean;
  readonly users: number;
  readonly minutes: number;
  readonly behaviour: Behaviour;
  readonly storm?: Storm;
}

/** A scenario a later milestone builds. */
export interface LaterScenario {
  readonly built: false;
  readonly milestone: number;
}

/** The warm up every scenario ramps its users over, unmeasured. */
export const WARMUP_SECONDS = 60;

/**
 * The share of scrolls that jump rather than move by 1 to 3 windows: a person
 * drags the scrollbar now and then and mostly scrolls. A model choice, not a
 * target (the targets live in `SCALE_BUDGET`).
 */
export const JUMP_SHARE = 0.2;

/** How often the storm's bursts come (AC-207). */
export const BURST_EVERY_MS = 10_000;

const steadyBehaviour: Behaviour = { jumps: 'near-top', picks: 'window', jumpShare: JUMP_SHARE };

/** Every scenario. */
export const SCENARIOS: Readonly<Record<ScenarioName, Scenario | LaterScenario>> = {
  steady: {
    built: true,
    gate: true,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: steadyBehaviour,
  },
  // Cold cache reads over the whole million: every jump, open and edit drawn evenly over the object (AC-205).
  spread: {
    built: true,
    gate: true,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: { jumps: 'even', picks: 'samples', jumpShare: JUMP_SHARE },
  },
  hub: { built: false, milestone: 4 },
  // The steady mix, a burst of edits every 10 seconds, and every live connection dropped at once mid window
  // (AC-207). Reported, not judged: #41 judges it.
  storm: {
    built: true,
    gate: false,
    users: SCALE_BUDGET.online.gate,
    minutes: 10,
    behaviour: steadyBehaviour,
    storm: { burstEveryMs: BURST_EVERY_MS },
  },
  thousand: { built: false, milestone: 4 },
};
