// The smart ranking's arithmetic (spec 0037, AC-1361, AC-1363, AC-1364),
// pure and with no I/O: given a seat's candidates, their fit and their
// learned lift, it says how far the pick may tilt away from the lowest load
// and what each candidate's ranking key is. `pick.ts` orders by that key; it
// never asks what a number means.
//
// Everything is in one unit: a candidate's **load** is their count (their
// joining calibration included) for each unit of weight, at weight 100, so
// one meeting at weight 100 is exactly 1. The fairness allowance is a share
// of the pool's mean load, never less than one meeting (`SLACK_FLOOR`), and
// preference is always 0 to 1. So the key can never pull a candidate more
// than `slack` below their load, which is what holds AC-1364's bound: no
// member ends more than the slack plus one meeting's load above the lowest.
//
// Mode `off`, an allowance of 0 and a holdout draw all make every preference
// 0, and the keys then order exactly as the load does, which is the
// rotation's own strategy (AC-1363). An unknown stored mode never reaches
// here: `smartModeOf` in contracts reads it as `off` first (AC-1223).
import { SLACK_FLOOR, type SmartMode } from '@crm/contracts';
import type { Candidate } from './pick.ts';

/** A candidate's load in the ranking's unit: their count for each unit of weight, at weight 100. */
export function loadAt100(candidate: Pick<Candidate, 'count' | 'calibration' | 'weight'>): number {
  return ((candidate.count + candidate.calibration) * 100) / Math.max(1, candidate.weight);
}

/**
 * What one seat's ranking knows (AC-1363): the mode, the allowance and the
 * slack it works out to, whether this decision was drawn into the holdout,
 * each candidate's fit and learned lift, and the model the lift came from.
 */
export interface SmartRanking {
  readonly mode: SmartMode;
  /** 0 to 50. */
  readonly tiltPercent: number;
  /** True: this decision picks plain fair, and every preference reads 0 (L9 draws it). */
  readonly holdout: boolean;
  /** The allowance in load units: `tilt ÷ 100 × the pool's mean load`, never under one meeting. */
  readonly slack: number;
  /**
   * The lowest load among the pool, the rotation's switched on members. The
   * ranking may never pick someone more than `slack` above it (AC-1364), even
   * when the person holding that load isn't free at this slot: without that
   * floor, a run of slots where only the busier reps are free lets preference
   * compound, and the end state drifts past the bound (measured, 1 November
   * 2026: 1,140 against a slack of 1,031 over 10,000 arrivals).
   */
  readonly floor: number;
  /** 0 to 1 per member: the share of applying fit links whose skill they hold (AC-1362). */
  readonly fit: ReadonlyMap<string, number>;
  /** 0 to 1 per member: their learned lift in this cell, empty while every cell is cold (L9). */
  readonly lift: ReadonlyMap<string, number>;
  readonly modelVersion: number;
}

/**
 * The slack for a seat (AC-1363): the allowance times the mean load of
 * `pool`, the rotation's switched on members, and never less than one
 * meeting at weight 100. An allowance of 0 gives 0, which turns the ranking
 * off for that seat rather than floor it.
 */
export function slackOf(tiltPercent: number, pool: readonly Candidate[]): number {
  if (tiltPercent <= 0 || pool.length === 0) return 0;
  const mean = pool.reduce((total, each) => total + loadAt100(each), 0) / pool.length;
  return Math.max((tiltPercent / 100) * mean, SLACK_FLOOR);
}

/** The lowest load among the pool, the rotation's switched on members: the floor the allowance is measured from. */
export function floorOf(pool: readonly Candidate[]): number {
  return pool.length === 0 ? 0 : Math.min(...pool.map((each) => loadAt100(each)));
}

/** A number read defensively: a finite one inside 0 to 1, else 0 (an unknown stored value grants nothing). */
function share(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * One candidate's preference, 0 to 1 (AC-1363): nothing in mode `off` or
 * under the holdout, their fit in `fit`, and the mean of their fit and their
 * learned lift in `learn`.
 */
export function preferenceOf(smart: SmartRanking, memberId: string): number {
  if (smart.mode === 'off' || smart.holdout) return 0;
  const fit = share(smart.fit.get(memberId));
  if (smart.mode === 'fit') return fit;
  return (fit + share(smart.lift.get(memberId))) / 2;
}

/** Whether a seat's ranking can move anything at all: a live mode, some slack, and a preference above 0. */
export function tilts(smart: SmartRanking | undefined, memberIds: readonly string[]): smart is SmartRanking {
  if (smart === undefined || smart.slack <= 0 || smart.mode === 'off' || smart.holdout) return false;
  return memberIds.some((memberId) => preferenceOf(smart, memberId) > 0);
}

/**
 * A candidate's ranking key (AC-1363): their load less the slack times their
 * preference. With no ranking it is the load itself, so the order is the
 * rotation's own.
 */
export function rankingKey(candidate: Candidate, smart: SmartRanking | undefined): number {
  const load = loadAt100(candidate);
  return smart === undefined ? load : load - smart.slack * preferenceOf(smart, candidate.memberId);
}

/**
 * How much of the allowance the ranking itself may spend (AC-1364). The
 * allowance is what the **end state** may reach; the ranking may move a pick
 * only half that far, because once loads are apart, plain fairness among
 * whoever happens to be free that slot can only correct them in whole
 * meetings of each person's own weight, and that correction overshoots.
 *
 * Measured over 10,000 arrivals, 6 members, random weights 1 to 100 and a
 * random half free each slot (`smart.test.ts`, 1 November 2026): spending the
 * whole allowance left a member 977 above the lowest against an allowance of
 * 899 (8.7 percent over, on a roster holding weights of 5 and 7, where one
 * meeting is 20 load units); spending half of it left 538 against 872. So
 * half keeps the sentence the Smart tab states true, with room to spare.
 */
export const RANKING_ROOM = 0.5;

/**
 * Whether the ranking may pick this candidate (AC-1364): their load is no
 * more than the room above the pool's lowest. The seat's own first choice is
 * always allowed, so a seat where everyone is over the room still books,
 * through the rotation's own order.
 */
export function withinAllowance(candidate: Candidate, smart: SmartRanking): boolean {
  return loadAt100(candidate) <= smart.floor + smart.slack * RANKING_ROOM + 1e-9;
}

/**
 * The bound the Smart tab states in plain words (AC-1364): how many more
 * meetings than the least busy person the ranking may give someone, as whole
 * meetings at weight 100, the slack plus one meeting rounded down.
 */
export function boundMeetings(slack: number): number {
  return Math.max(1, Math.floor(slack + 1));
}
