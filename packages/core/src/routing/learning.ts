// The learning's arithmetic (spec 0037, AC-1366, AC-1368, AC-1369, AC-1389),
// pure and with no I/O: given a ranked booking's facts it says whether the
// booking is a trial and whether it met an objective, and given a cell's
// counts it says the team's rate, each member's smoothed rate and the lift
// the ranking may spend on them.
//
// Nothing here knows what a member is beyond their id (AC-1370), and nothing
// here reaches outside the workspace: every number comes from counts the
// caller read under row level security. No AI vendor is called or imported
// from anywhere in this folder (decision 27, AC-1379) — "Learn" is this
// statistical lift over this workspace's own meetings and nothing else.
import { LIFT_FLOOR, LIFT_SPAN, objectiveOf, outcomeWindowDays, RATE_SMOOTHING, WARM_TRIALS } from '@crm/contracts';

/** One objective, as the stats store it. */
export type Objective = 'held' | 'deal' | 'won';

/** One member's counts in a cell, as `routing_stats` holds them. */
export interface CellCounts {
  readonly memberId: string;
  readonly trials: number;
  readonly successes: number;
  readonly waiting: number;
}

/** A cell read whole (AC-1369): every member's row in it, and the team rate and warmth those rows give. */
export interface Cell {
  readonly rows: readonly CellCounts[];
  readonly trials: number;
  readonly successes: number;
  readonly waiting: number;
  readonly teamRate: number;
  readonly isWarm: boolean;
}

/** A count read defensively: a finite whole number at least 0, else 0 (a row the code can't read grants nothing). */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * One cell from its member rows (AC-1369): the team rate is the sum of
 * successes over the sum of trials, and the cell is warm at
 * `WARM_TRIALS` trials. An empty cell is cold with a rate of 0, so nothing
 * unknown ever tilts a pick (AC-1223).
 */
export function cellOf(rows: readonly CellCounts[]): Cell {
  const kept = rows.map((row) => ({
    memberId: row.memberId,
    trials: count(row.trials),
    successes: Math.min(count(row.successes), count(row.trials)),
    waiting: count(row.waiting),
  }));
  const trials = kept.reduce((total, row) => total + row.trials, 0);
  const successes = kept.reduce((total, row) => total + row.successes, 0);
  const waiting = kept.reduce((total, row) => total + row.waiting, 0);
  return {
    rows: kept,
    trials,
    successes,
    waiting,
    teamRate: trials === 0 ? 0 : successes / trials,
    isWarm: trials >= WARM_TRIALS,
  };
}

/**
 * One member's smoothed rate in a cell (AC-1369):
 * `(successes + 20 × teamRate) ÷ (trials + 20)`, so a member with few trials
 * reads as the team until their own record says otherwise.
 */
export function smoothedRate(row: Pick<CellCounts, 'trials' | 'successes'>, teamRate: number): number {
  const trials = count(row.trials);
  const successes = Math.min(count(row.successes), trials);
  return (successes + RATE_SMOOTHING * teamRate) / (trials + RATE_SMOOTHING);
}

/**
 * One member's learned lift (AC-1369): how far their smoothed rate is above
 * the team's, over ten percentage points, kept between 0 and 1, and nothing
 * at all under two points — so two reps at 35.1 and 35.2 percent get nothing.
 */
export function liftOf(rate: number, teamRate: number): number {
  const gap = rate - teamRate;
  if (!Number.isFinite(gap) || gap < LIFT_FLOOR) return 0;
  return Math.min(1, Math.max(0, gap / LIFT_SPAN));
}

/**
 * The lift each member of a seat gets (AC-1369): from `cell` when it is warm,
 * else from `allSegments`, the page's all segments cell for that rotation,
 * when **that** is warm; else nothing, so a cold workspace ranks on fit
 * alone. The `?` segment is never warm by construction (the run writes its
 * trials but never enough of them into one key), so it always falls back here.
 */
export function liftsOf(cell: Cell | undefined, allSegments: Cell | undefined): ReadonlyMap<string, number> {
  const read = cell?.isWarm === true ? cell : allSegments?.isWarm === true ? allSegments : undefined;
  if (read === undefined) return new Map<string, number>();
  return new Map(read.rows.map((row) => [row.memberId, liftOf(smoothedRate(row, read.teamRate), read.teamRate)]));
}

/** What the nightly run knows about one ranked booking, read from its decision, its booking and its ledger row. */
export interface RankedBooking {
  /** The member the ranking picked: the ledger row's original member, even if the seat was voided later (AC-1368). */
  readonly memberId: string;
  /** Who it was for, so one person counts once per page per window (AC-1368). */
  readonly personKey?: string;
  readonly segmentKey: string;
  readonly rotationId: string;
  readonly holdout: boolean;
  /** How many candidates the seat had after the host rules: under 2 it isn't a trial (AC-1368). */
  readonly candidates: number;
  /** A returning guest's owner, their last host or a stand in took the seat: not ranked, not a trial (AC-1368). */
  readonly isPreassigned: boolean;
  readonly status: 'confirmed' | 'cancelled';
  /** Who cancelled it, when it was: the host's cancellation is a failure for every objective (AC-1368). */
  readonly cancelledBy?: 'guest' | 'host' | 'calendar';
  /** The booking was handed to another member after the pick: a failure for every objective (AC-1368). */
  readonly wasReassigned: boolean;
  /** Marked a no show (AC-1366): Held fails. */
  readonly isNoShow: boolean;
  /** When the meeting ends, in milliseconds: every outcome window is measured from it. */
  readonly endsAt: number;
  /** A deal was created in the deal window and this booking claims it (AC-1366). */
  readonly hasDeal: boolean;
  /** That deal reached a Won means stage within the won window (AC-1366). */
  readonly hasWon: boolean;
}

/**
 * Whether one ranked booking is a trial (AC-1368), intent to treat: a seat
 * with 2 or more candidates after the host rules, not pre-assigned. A holdout
 * draw **is** a trial — it is the comparison's control arm, and AC-1389 reads
 * its rate — but the ranking never reads a holdout's own lift, since the
 * learning counts it in the same cell as every other pick.
 */
export function isTrial(booking: Pick<RankedBooking, 'candidates' | 'isPreassigned'>): boolean {
  return booking.candidates >= 2 && !booking.isPreassigned;
}

/**
 * Whether a trial met an objective (AC-1366, AC-1368). A cancellation by the
 * host and a reassignment fail every objective. A guest's cancellation before
 * the meeting fails Held and still counts for the deal objectives, since the
 * lead was treated: the rep got the lead and what happened to it is the
 * outcome. Held is "no no show mark"; the deal objectives read the facts the
 * run joined.
 */
export function metObjective(booking: RankedBooking, objective: Objective): boolean {
  if (booking.wasReassigned) return false;
  if (booking.status === 'cancelled' && booking.cancelledBy !== 'guest') return false;
  switch (objective) {
    case 'held':
      return booking.status === 'confirmed' && !booking.isNoShow;
    case 'deal':
      return booking.hasDeal;
    default:
      return booking.hasDeal && booking.hasWon;
  }
}

/**
 * Whether an objective's outcome window has passed for a booking (AC-1366):
 * only then does it count toward the rate. One inside it is counted as
 * `waiting`, which is what Insights' "12 more waiting for their outcome" says.
 */
export function isSettled(booking: Pick<RankedBooking, 'endsAt'>, objective: Objective, now: number): boolean {
  return now >= booking.endsAt + outcomeWindowDays(objective) * 86_400_000;
}

/** The day an objective's outcome window closes for a booking, `YYYY-MM-DD` in UTC: what "ready from" reads. */
export function settlesOn(booking: Pick<RankedBooking, 'endsAt'>, objective: Objective): string {
  const at = booking.endsAt + outcomeWindowDays(objective) * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * One cell's counts from its bookings (AC-1366, AC-1368): per member, the
 * settled trials, how many met the objective, and how many are still waiting.
 * One person counts once per page per window, keeping their earliest booking,
 * so a lead who books three times is one trial (AC-1368).
 */
export function countCell(bookings: readonly RankedBooking[], objective: unknown, now: number): readonly CellCounts[] {
  const which = objectiveOf(objective) === 'held' ? 'held' : objectiveOf(objective) === 'won' ? 'won' : 'deal';
  const first = new Map<string, RankedBooking>();
  for (const booking of bookings) {
    if (!isTrial(booking)) continue;
    const key = booking.personKey ?? `booking:${String(booking.endsAt)}:${booking.memberId}`;
    const held = first.get(key);
    if (held === undefined || booking.endsAt < held.endsAt) first.set(key, booking);
  }
  const byMember = new Map<string, { trials: number; successes: number; waiting: number }>();
  for (const booking of first.values()) {
    const row = byMember.get(booking.memberId) ?? { trials: 0, successes: 0, waiting: 0 };
    if (isSettled(booking, which, now)) {
      row.trials += 1;
      if (metObjective(booking, which)) row.successes += 1;
    } else {
      row.waiting += 1;
    }
    byMember.set(booking.memberId, row);
  }
  return [...byMember].map(([memberId, row]) => ({ memberId, ...row }));
}

/**
 * The 90 percent interval of a rate (AC-1389), Wilson's, which stays inside
 * 0 to 1 at the small counts a team page has and never gives a bound of 0 to
 * 0 after one success, as the plain normal interval does. `z` is 1.645.
 */
export function interval(successes: number, trials: number): { readonly low: number; readonly high: number } {
  const n = count(trials);
  const k = Math.min(count(successes), n);
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.645;
  const rate = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (rate + (z * z) / (2 * n)) / denominator;
  const spread = (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) };
}

/** Whether two arms' 90 percent intervals are apart, which is what lets Insights drop "not yet certain" (AC-1389). */
export function isCertain(
  a: { readonly successes: number; readonly trials: number },
  b: { readonly successes: number; readonly trials: number },
): boolean {
  if (count(a.trials) === 0 || count(b.trials) === 0) return false;
  const one = interval(a.successes, a.trials);
  const two = interval(b.successes, b.trials);
  return one.low > two.high || two.low > one.high;
}
