// The open model's arrivals and the mix (spec 0011, AC-197, AC-212): users
// ramp up over the warm up, arrive at the budget's rate with exponential gaps
// whatever the server does, warm up arrivals are not measured, the achieved
// mix holds within a point even on a short run, and a seed plays a run again.
import { describe, expect, it } from 'vitest';
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import { achievedMix, actionAt, mixDeviation, planArrivals, type PlanInput } from './plan.ts';
import { createRandom, hash32 } from './random.ts';

const steady: PlanInput = {
  users: 100,
  actionsPerUserPerSecond: SCALE_BUDGET.load.actionsPerUserPerSecond,
  warmupMs: 60_000,
  measuredMs: 600_000,
  mix: SCALE_BUDGET.load.mix,
  seed: 42,
};

describe('planArrivals', () => {
  const plan = planArrivals(steady);

  it('ramps users in evenly over the warm up', () => {
    expect(plan.joins).toHaveLength(100);
    expect(plan.joins[0]?.at).toBe(0);
    expect(plan.joins[50]?.at).toBe(30_000);
    expect(plan.joins[99]?.at).toBe(59_400);
  });

  it('arrives at the budget’s rate per user, in time order, measuring only after the warm up', () => {
    const measured = plan.arrivals.filter((arrival) => arrival.measured);
    // 100 users × 0.2 a second × 600 seconds = 12,000, within a few percent.
    expect(measured.length).toBeGreaterThan(11_500);
    expect(measured.length).toBeLessThan(12_500);
    expect(
      plan.arrivals.every((arrival, index) => index === 0 || (plan.arrivals[index - 1]?.at ?? 0) <= arrival.at),
    ).toBe(true);
    expect(plan.arrivals.every((arrival) => arrival.measured === arrival.at >= 60_000)).toBe(true);
    expect(Math.max(...plan.arrivals.map((arrival) => arrival.at))).toBeLessThan(660_000);
    // No user acts before it joins.
    expect(plan.arrivals.every((arrival) => arrival.at > (plan.joins[arrival.user]?.at ?? Infinity))).toBe(true);
  });

  it('draws exponential gaps: their mean is 1 / rate and their spread as wide as their mean', () => {
    const gaps = plan.arrivals
      .filter((arrival) => arrival.user === 7)
      .map((arrival, index, mine) => (index === 0 ? undefined : arrival.at - (mine[index - 1]?.at ?? 0)))
      .filter((gap): gap is number => gap !== undefined);
    const all = plan.arrivals.reduce<Map<number, number[]>>((byUser, arrival) => {
      byUser.set(arrival.user, [...(byUser.get(arrival.user) ?? []), arrival.at]);
      return byUser;
    }, new Map());
    const everyGap = [...all.values()].flatMap((times) => times.slice(1).map((at, index) => at - (times[index] ?? 0)));
    const mean = everyGap.reduce((sum, gap) => sum + gap, 0) / everyGap.length;
    const sd = Math.sqrt(everyGap.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / everyGap.length);
    expect(mean).toBeGreaterThan(4_800);
    expect(mean).toBeLessThan(5_200);
    expect(sd / mean).toBeGreaterThan(0.9);
    expect(sd / mean).toBeLessThan(1.1);
    expect(gaps.length).toBeGreaterThan(80);
  });

  it('holds the mix within a point of the budget, over the measured window and over a short run', () => {
    const measured = plan.arrivals.filter((arrival) => arrival.measured).map((arrival) => arrival.action);
    expect(mixDeviation(achievedMix(measured), SCALE_BUDGET.load.mix)).toBeLessThan(0.01);
    // The weekly smoke: 20 users for 2 minutes, about 480 actions.
    const smoke = planArrivals({ ...steady, users: 20, measuredMs: 120_000 });
    const short = smoke.arrivals.filter((arrival) => arrival.measured).map((arrival) => arrival.action);
    expect(mixDeviation(achievedMix(short), SCALE_BUDGET.load.mix)).toBeLessThan(0.01);
  });

  it('plays the same run again from the same seed, and another from another', () => {
    expect(planArrivals(steady)).toEqual(plan);
    expect(planArrivals({ ...steady, seed: 43 }).arrivals.slice(0, 20)).not.toEqual(plan.arrivals.slice(0, 20));
  });
});

describe('actionAt', () => {
  it('maps the unit interval onto the mix’s cumulative shares in a fixed order', () => {
    const mix = SCALE_BUDGET.load.mix;
    expect(actionAt(0, mix)).toBe('scroll');
    expect(actionAt(0.599, mix)).toBe('scroll');
    expect(actionAt(0.6, mix)).toBe('filterSort');
    expect(actionAt(0.76, mix)).toBe('open');
    expect(actionAt(0.86, mix)).toBe('edit');
    expect(actionAt(0.98, mix)).toBe('create');
    expect(actionAt(0.999_999, mix)).toBe('create');
  });
});

describe('createRandom', () => {
  it('draws the same numbers for the same seed and stream, and different ones otherwise', () => {
    const draw = (seed: number, stream: string) => {
      const random = createRandom(seed, stream);
      return Array.from({ length: 5 }, () => random.next());
    };
    expect(draw(1, 'a')).toEqual(draw(1, 'a'));
    expect(draw(1, 'a')).not.toEqual(draw(1, 'b'));
    expect(draw(1, 'a')).not.toEqual(draw(2, 'a'));
    expect(draw(1, 'a').every((value) => value >= 0 && value < 1)).toBe(true);
    expect(hash32('x')).toBe(hash32('x'));
  });
});
