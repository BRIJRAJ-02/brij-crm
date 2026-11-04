import { describe, expect, it } from 'vitest';
import {
  areaPath,
  BAR_MAX_THICKNESS,
  barPath,
  barSlot,
  charsThatFit,
  cutLabel,
  labelStep,
  labelStepFor,
  estimateLabelWidth,
  LABEL_GAP,
  linePath,
  nearestIndex,
  niceTicks,
} from './chart-math.ts';

describe('niceTicks', () => {
  it('rounds the top up to a clean number and starts at zero', () => {
    expect(niceTicks(87)).toEqual({ ticks: [0, 25, 50, 75, 100], top: 100 });
    expect(niceTicks(1200)).toEqual({ ticks: [0, 500, 1000, 1500], top: 1500 });
    expect(niceTicks(10)).toEqual({ ticks: [0, 2.5, 5, 7.5, 10], top: 10 });
    expect(niceTicks(4)).toEqual({ ticks: [0, 1, 2, 3, 4], top: 4 });
  });

  it('keeps small steps free of floating point dust', () => {
    expect(niceTicks(0.3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('draws a 0 to 1 axis for nothing', () => {
    expect(niceTicks(0)).toEqual({ ticks: [0, 1], top: 1 });
    expect(niceTicks(Number.NaN).top).toBe(1);
  });
});

describe('barSlot', () => {
  it('caps a bar at the mark spec and centres it in its slot', () => {
    const first = barSlot(0, 4, 400);
    expect(first.slot).toBe(100);
    expect(first.bar).toBe(BAR_MAX_THICKNESS);
    expect(first.x).toBe(38);
    expect(barSlot(3, 4, 400).start).toBe(300);
  });

  it('leaves air between crowded bars and never draws one thinner than 2px', () => {
    expect(barSlot(0, 40, 400).bar).toBe(2);
    expect(barSlot(0, 20, 400).bar).toBe(12);
  });
});

describe('labels', () => {
  it('cuts to the room it has, with an ellipsis', () => {
    expect(cutLabel('Negotiation', 20)).toBe('Negotiation');
    expect(cutLabel('Negotiation', 6)).toBe('Negot…');
    expect(cutLabel('Negotiation', 1)).toBe('…');
    expect(charsThatFit(62)).toBe(10);
  });

  it('draws every label that fits and every nth when they would touch', () => {
    expect(labelStep(5, 120, 8)).toBe(1);
    expect(labelStep(12, 40, 8)).toBe(2);
    expect(labelStep(12, 20, 8)).toBe(4);
    expect(labelStep(1, 5, 30)).toBe(1);
  });
});

describe('paths', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 10.123, y: 4 },
    { x: 20, y: 8 },
  ];

  it('draws a line through the points', () => {
    expect(linePath(points)).toBe('M0 10 L10.12 4 L20 8');
    expect(linePath([])).toBe('');
  });

  it('closes the area down to the baseline', () => {
    expect(areaPath(points, 30)).toBe('M0 10 L10.12 4 L20 8 L20 30 L0 30 Z');
    expect(areaPath([], 30)).toBe('');
  });
});

describe('barPath', () => {
  it('rounds the top corners and stands square on the baseline', () => {
    expect(barPath(10, 20, 24, 100)).toBe('M10 120 L10 24 Q10 20 14 20 L30 20 Q34 20 34 24 L34 120 Z');
  });

  it('shrinks the corners for a short bar and draws nothing for none', () => {
    expect(barPath(0, 0, 24, 2)).toContain('Q0 0 2 0');
    expect(barPath(0, 0, 24, 0)).toBe('');
  });
});

describe('nearestIndex', () => {
  it('finds the slot a pointer is in, held inside the plot', () => {
    expect(nearestIndex(5, 4, 400)).toBe(0);
    expect(nearestIndex(150, 4, 400)).toBe(1);
    expect(nearestIndex(-20, 4, 400)).toBe(0);
    expect(nearestIndex(999, 4, 400)).toBe(3);
    expect(nearestIndex(10, 0, 400)).toBe(-1);
  });
});

describe('labelStepFor (T7)', () => {
  /** The drawn labels' boxes at a step: [left, right], each centred in its slot. */
  const boxes = (widths: readonly number[], slot: number, step: number) =>
    widths.flatMap((width, at) =>
      at % step === 0 ? [[slot * (at + 0.5) - width / 2, slot * (at + 0.5) + width / 2] as const] : [],
    );

  it('never lets two drawn labels touch, at any range and width', () => {
    const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    for (const count of [2, 7, 14, 30, 31, 60, 89, 90, 120, 365]) {
      const widths = Array.from({ length: count }, (_, at) =>
        estimateLabelWidth(monthDay.format(new Date(Date.UTC(2026, 7, 7 + at))), 12),
      );
      for (const plot of [120, 240, 320, 480, 760, 1100, 1600, 2400, 3200]) {
        const slot = plot / count;
        const step = labelStepFor(widths, slot);
        const drawn = boxes(widths, slot, step);
        expect(drawn.length).toBeGreaterThan(0);
        for (let at = 1; at < drawn.length; at += 1) {
          expect((drawn[at]?.[0] ?? 0) - (drawn[at - 1]?.[1] ?? 0)).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9);
        }
      }
    }
  });

  it('draws every label when they fit, and the least step that keeps the gap when they don’t', () => {
    expect(labelStepFor([30, 30, 30], 100)).toBe(1);
    // 89 days of "Aug 7" in 760px: about 8.5px a day, so a label every few days, never every second one.
    const widths = Array.from({ length: 89 }, () => estimateLabelWidth('Aug 17', 12));
    const step = labelStepFor(widths, 760 / 89);
    expect(step).toBeGreaterThan(2);
    expect(step * (760 / 89)).toBeGreaterThanOrEqual((widths[0] ?? 0) + LABEL_GAP);
    expect(labelStepFor([40], 10)).toBe(1);
  });
});
