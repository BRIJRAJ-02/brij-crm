// The learning's arithmetic (spec 0037, lane L9), pure and with no database:
// the outcomes and trials of AC-1366 and AC-1368, the team rate, the smoothed
// rate and the lift of AC-1369 (including the two reps at 35.1 and 35.2
// percent who get nothing, and the cold cell that gives none), the segment
// keys of AC-1370, the holdout draw of AC-1389 and the comparison's interval.
import { describe, expect, it } from 'vitest';
import {
  ALL_SEGMENTS,
  HOLDOUT_PERCENT_MAX,
  isHoldout,
  learnWindowDays,
  objectiveOf,
  outcomeWindowDays,
  segmentKeyOf,
  UNKNOWN_SEGMENT,
  WARM_TRIALS,
} from '@crm/contracts';
import {
  cellOf,
  countCell,
  interval,
  isCertain,
  isSettled,
  isTrial,
  liftOf,
  liftsOf,
  metObjective,
  settlesOn,
  smoothedRate,
  type RankedBooking,
} from './learning.ts';

const DAY = 86_400_000;
/** Sunday 1 November 2026, midnight UTC. */
const NOW = Date.parse('2026-11-01T00:00:00.000Z');

/** One ranked booking, ended a week ago and held, with everything else as given. */
function booking(over: Partial<RankedBooking> = {}): RankedBooking {
  return {
    memberId: 'sam',
    segmentKey: ALL_SEGMENTS,
    rotationId: 'sales',
    holdout: false,
    candidates: 3,
    isPreassigned: false,
    status: 'confirmed',
    wasReassigned: false,
    isNoShow: false,
    endsAt: NOW - 30 * DAY,
    hasDeal: false,
    hasWon: false,
    ...over,
  };
}

describe('a cell and its rates (AC-1369)', () => {
  it('reads the team rate as the sum of successes over the sum of trials, and warms at 100 trials', () => {
    const cold = cellOf([
      { memberId: 'sam', trials: 20, successes: 8, waiting: 2 },
      { memberId: 'bea', trials: 30, successes: 10, waiting: 0 },
    ]);
    expect(cold.trials).toBe(50);
    expect(cold.successes).toBe(18);
    expect(cold.waiting).toBe(2);
    expect(cold.teamRate).toBeCloseTo(18 / 50);
    expect(cold.isWarm).toBe(false);

    const warm = cellOf([{ memberId: 'sam', trials: WARM_TRIALS, successes: 40, waiting: 0 }]);
    expect(warm.isWarm).toBe(true);
  });

  it('reads a damaged row as nothing rather than letting it tilt a pick (AC-1223)', () => {
    const cell = cellOf([
      // Successes above trials, a negative count and a NaN each read as 0 or are clamped.
      { memberId: 'sam', trials: 10, successes: 50, waiting: -3 },
      { memberId: 'bea', trials: Number.NaN, successes: 5, waiting: 0 },
    ]);
    expect(cell.rows).toEqual([
      { memberId: 'sam', trials: 10, successes: 10, waiting: 0 },
      { memberId: 'bea', trials: 0, successes: 0, waiting: 0 },
    ]);
    expect(cell.teamRate).toBeCloseTo(1);
  });

  it('smooths a member toward the team, so few trials read as the team', () => {
    const teamRate = 0.4;
    // 20 prior trials at the team rate: one trial of their own barely moves them.
    expect(smoothedRate({ trials: 1, successes: 1 }, teamRate)).toBeCloseTo((1 + 20 * 0.4) / 21);
    expect(smoothedRate({ trials: 0, successes: 0 }, teamRate)).toBeCloseTo(teamRate);
    // Many trials of their own: their own record wins.
    expect(smoothedRate({ trials: 200, successes: 160 }, teamRate)).toBeGreaterThan(0.7);
  });

  it('gives no lift under two points, and a full one at ten (the spec’s 35.1 against 35.2)', () => {
    expect(liftOf(0.352, 0.351)).toBe(0);
    expect(liftOf(0.351, 0.352)).toBe(0);
    expect(liftOf(0.37, 0.35)).toBeCloseTo(0.2);
    expect(liftOf(0.45, 0.35)).toBe(1);
    // Past ten points it is still 1: the preference is a share, never a multiplier.
    expect(liftOf(0.95, 0.35)).toBe(1);
  });

  it('falls back to the page’s all segments cell when the segment is cold, and gives nothing when both are', () => {
    const segment = cellOf([{ memberId: 'sam', trials: 5, successes: 4, waiting: 0 }]);
    const allSegments = cellOf([
      { memberId: 'sam', trials: 150, successes: 90, waiting: 0 },
      { memberId: 'bea', trials: 150, successes: 30, waiting: 0 },
    ]);
    // The cold segment gives nothing of its own; the warm all segments cell decides.
    const fell = liftsOf(segment, allSegments);
    expect(fell.get('sam') ?? 0).toBeGreaterThan(0);
    expect(fell.get('bea') ?? 0).toBe(0);
    // Both cold: no lift at all, so the ranking is fit and fairness only.
    expect([...liftsOf(segment, segment)]).toEqual([]);
    expect([...liftsOf(undefined, undefined)]).toEqual([]);
    // The segment's own numbers win once it is warm.
    const warmSegment = cellOf([
      { memberId: 'bea', trials: 150, successes: 120, waiting: 0 },
      { memberId: 'sam', trials: 150, successes: 20, waiting: 0 },
    ]);
    const own = liftsOf(warmSegment, allSegments);
    expect(own.get('bea') ?? 0).toBeGreaterThan(0);
    expect(own.get('sam') ?? 0).toBe(0);
  });
});

describe('trials and outcomes (AC-1366, AC-1368)', () => {
  it('counts a trial only for a ranked seat of two or more, never a pre-assigned one', () => {
    expect(isTrial({ candidates: 3, isPreassigned: false })).toBe(true);
    expect(isTrial({ candidates: 1, isPreassigned: false })).toBe(false);
    // A returning guest's owner, their last host or a stand in: not ranked, so not a trial.
    expect(isTrial({ candidates: 5, isPreassigned: true })).toBe(false);
  });

  it('fails every objective on a host cancellation and on a reassignment', () => {
    const cancelled = booking({ status: 'cancelled', cancelledBy: 'host', hasDeal: true, hasWon: true });
    expect(metObjective(cancelled, 'held')).toBe(false);
    expect(metObjective(cancelled, 'deal')).toBe(false);
    expect(metObjective(cancelled, 'won')).toBe(false);
    const handed = booking({ wasReassigned: true, hasDeal: true, hasWon: true });
    expect(metObjective(handed, 'deal')).toBe(false);
  });

  it('a guest’s cancellation fails Held and stays a trial for the deal objectives', () => {
    const guest = booking({ status: 'cancelled', cancelledBy: 'guest', hasDeal: true, hasWon: true });
    expect(metObjective(guest, 'held')).toBe(false);
    expect(metObjective(guest, 'deal')).toBe(true);
    expect(metObjective(guest, 'won')).toBe(true);
  });

  it('Held is “no no show mark”, and a mark flips it', () => {
    expect(metObjective(booking(), 'held')).toBe(true);
    expect(metObjective(booking({ isNoShow: true }), 'held')).toBe(false);
  });

  it('Deals won needs the deal as well as the win', () => {
    expect(metObjective(booking({ hasDeal: false, hasWon: true }), 'won')).toBe(false);
    expect(metObjective(booking({ hasDeal: true, hasWon: false }), 'won')).toBe(false);
    expect(metObjective(booking({ hasDeal: true, hasWon: true }), 'won')).toBe(true);
  });

  it('counts a booking only once its outcome window has passed, else as waiting', () => {
    const recent = booking({ endsAt: NOW - 2 * DAY });
    expect(isSettled(recent, 'held', NOW)).toBe(false);
    expect(isSettled(recent, 'deal', NOW)).toBe(false);
    const old = booking({ endsAt: NOW - 40 * DAY });
    expect(isSettled(old, 'held', NOW)).toBe(true);
    expect(isSettled(old, 'deal', NOW)).toBe(true);
    expect(isSettled(old, 'won', NOW)).toBe(false);
    // The day the window closes is what Insights' "ready from" reads.
    expect(settlesOn({ endsAt: Date.parse('2026-11-01T12:00:00.000Z') }, 'held')).toBe('2026-11-08');
  });

  it('counts one person once per page, keeping their earliest booking (AC-1368)', () => {
    const counts = countCell(
      [
        // The same lead booked three times: one trial, the first one's outcome.
        booking({ personKey: 'lead-1', memberId: 'sam', endsAt: NOW - 40 * DAY, isNoShow: true }),
        booking({ personKey: 'lead-1', memberId: 'bea', endsAt: NOW - 20 * DAY }),
        booking({ personKey: 'lead-1', memberId: 'bea', endsAt: NOW - 10 * DAY }),
        booking({ personKey: 'lead-2', memberId: 'bea', endsAt: NOW - 20 * DAY }),
        // Still inside its window: waiting, not a trial.
        booking({ personKey: 'lead-3', memberId: 'bea', endsAt: NOW - 1 * DAY }),
        // A seat that was never ranked: counted nowhere at all.
        booking({ personKey: 'lead-4', memberId: 'bea', isPreassigned: true }),
      ],
      'held',
      NOW,
    );
    const byMember = new Map(counts.map((row) => [row.memberId, row]));
    expect(byMember.get('sam')).toEqual({ memberId: 'sam', trials: 1, successes: 0, waiting: 0 });
    expect(byMember.get('bea')).toEqual({ memberId: 'bea', trials: 1, successes: 1, waiting: 1 });
  });

  it('an unknown objective counts as Deals created, never as nothing (AC-1223)', () => {
    expect(objectiveOf('nonsense')).toBe('deal');
    expect(objectiveOf(null)).toBe('deal');
    expect(objectiveOf(undefined)).toBe('deal');
    expect(objectiveOf('won')).toBe('won');
  });

  it('Deals won looks back further, by its own outcome window', () => {
    expect(learnWindowDays('held')).toBe(180);
    expect(learnWindowDays('deal')).toBe(180);
    expect(learnWindowDays('won')).toBe(270);
    expect(outcomeWindowDays('held')).toBe(7);
    expect(outcomeWindowDays('deal')).toBe(30);
    expect(outcomeWindowDays('won')).toBe(90);
  });
});

describe('segments (AC-1370)', () => {
  it('is the all segments key with no segment attributes', () => {
    expect(segmentKeyOf([], () => undefined)).toBe(ALL_SEGMENTS);
  });

  it('is canonical, in the order the attributes are set', () => {
    const values = new Map([
      ['a', 'one'],
      ['b', 'two'],
    ]);
    expect(segmentKeyOf(['a', 'b'], (id) => values.get(id))).toBe('a=one;b=two');
    // The order the attributes are set in decides the key, so swapping them makes a different cell.
    expect(segmentKeyOf(['b', 'a'], (id) => values.get(id))).toBe('b=two;a=one');
  });

  it('is the unknown key when any value is missing, so it can never warm on its own', () => {
    expect(segmentKeyOf(['a', 'b'], (id) => (id === 'a' ? 'one' : undefined))).toBe(UNKNOWN_SEGMENT);
    expect(segmentKeyOf(['a'], () => undefined)).toBe(UNKNOWN_SEGMENT);
  });
});

describe('the holdout and the comparison (AC-1389)', () => {
  it('draws nothing at 0, and roughly the share asked for, the same way every time', () => {
    const ids = Array.from(
      { length: 2_000 },
      (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    );
    expect(ids.filter((id) => isHoldout(id, 0)).length).toBe(0);
    const drawn = ids.filter((id) => isHoldout(id, 10)).length;
    // A hash, not a sampler: 10 percent of 2,000 within a few points either way.
    expect(drawn).toBeGreaterThan(130);
    expect(drawn).toBeLessThan(270);
    // A replay of the same decision draws the same way (AC-1389).
    const one = ids[7] ?? '';
    expect(isHoldout(one, 10)).toBe(isHoldout(one, 10));
    // A share above the limit is clamped, and a negative one draws nothing.
    expect(isHoldout(one, 500)).toBe(isHoldout(one, HOLDOUT_PERCENT_MAX));
    expect(isHoldout(one, -5)).toBe(false);
  });

  it('a wider share always includes a narrower one’s draws, so raising it never un-draws a decision', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `d-${String(index)}`);
    for (const id of ids) {
      if (isHoldout(id, 5)) expect(isHoldout(id, 20)).toBe(true);
    }
  });

  it('gives an interval that stays inside 0 to 1 and is only certain once the arms are apart', () => {
    expect(interval(0, 0)).toEqual({ low: 0, high: 0 });
    const few = interval(1, 1);
    expect(few.low).toBeGreaterThan(0);
    expect(few.high).toBeLessThanOrEqual(1);
    const many = interval(40, 100);
    expect(many.low).toBeGreaterThan(0.3);
    expect(many.high).toBeLessThan(0.5);
    // Not certain while the intervals overlap, nor with an empty arm.
    expect(isCertain({ successes: 41, trials: 100 }, { successes: 35, trials: 100 })).toBe(false);
    expect(isCertain({ successes: 41, trials: 100 }, { successes: 0, trials: 0 })).toBe(false);
    // Far apart with enough of each: certain.
    expect(isCertain({ successes: 800, trials: 1_000 }, { successes: 200, trials: 1_000 })).toBe(true);
  });
});
