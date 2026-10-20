// The visitor's overlay (spec 0028, AC-723 and AC-725): clash edges, the Best
// rule in the visitor's zone, and the soonest shared slots filling the rest.
import { describe, expect, it } from 'vitest';
import { overlay, type OverlaySlot } from './overlay.ts';

/** Half hour slots on 2 November 2026, starting at each UTC time given. */
const slotsAt = (...times: readonly string[]): readonly OverlaySlot[] =>
  times.map((time) => {
    const start = new Date(`2026-11-02T${time}:00.000Z`);
    return { start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() };
  });
const busyAt = (from: string, to: string) => ({
  start: `2026-11-02T${from}:00.000Z`,
  end: `2026-11-02T${to}:00.000Z`,
});
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

describe('overlay', () => {
  it('clashes on any overlap, never on a slot touching a busy end', () => {
    const slots = slotsAt('09:00', '09:30', '10:00', '10:30');
    const { clashes } = overlay(slots, [busyAt('09:15', '10:00')], 'UTC');
    expect(clashes).toEqual([at('09:00'), at('09:30')]);
  });

  it('clashes nothing with no busy time, and skips an empty busy span', () => {
    const slots = slotsAt('09:00', '09:30');
    expect(overlay(slots, [], 'UTC').clashes).toEqual([]);
    expect(overlay(slots, [busyAt('09:00', '09:00')], 'UTC').clashes).toEqual([]);
  });

  it('picks the soonest three shared slots in good hours with room around them', () => {
    const slots = slotsAt('08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00');
    const result = overlay(slots, [busyAt('10:00', '10:30'), busyAt('11:40', '11:50')], 'UTC');
    expect(result.clashes).toEqual([at('10:00')]);
    // 08:00 is too early; 11:00 ends 10 minutes before a busy 11:40, and 12:00 starts 10 minutes after it ends.
    expect(result.best).toEqual([at('09:00'), at('13:00'), at('14:00')]);
  });

  it('reads good hours in the visitor’s zone', () => {
    // 14:00 and 15:00 UTC are 9 and 10 AM in New York (EST in November); 13:00 is 8 AM, so it only fills.
    const slots = slotsAt('13:00', '14:00', '15:00', '16:00', '23:30');
    expect(overlay(slots, [], 'America/New_York').best).toEqual([at('14:00'), at('15:00'), at('16:00')]);
    expect(overlay(slotsAt('13:00', '14:00', '23:30'), [], 'America/New_York').best).toEqual([
      at('13:00'),
      at('14:00'),
      at('23:30'),
    ]);
    // A slot ending at 6 PM counts; one past it does not (23:00 UTC is 6 PM in New York).
    const evening = [
      ...slotsAt('22:30', '23:00'),
      { start: '2026-11-03T14:00:00.000Z', end: '2026-11-03T14:30:00.000Z' },
    ];
    const late = [...evening, { start: '2026-11-03T15:00:00.000Z', end: '2026-11-03T15:30:00.000Z' }];
    expect(overlay(late, [], 'America/New_York').best).toEqual([
      at('22:30'),
      '2026-11-03T14:00:00.000Z',
      '2026-11-03T15:00:00.000Z',
    ]);
  });

  it('fills with the soonest shared slots when fewer than three pass, and never a clash', () => {
    const slots = slotsAt('06:00', '07:00', '09:00', '20:00');
    const result = overlay(slots, [busyAt('07:00', '07:30')], 'UTC');
    expect(result.clashes).toEqual([at('07:00')]);
    expect(result.best).toEqual([at('06:00'), at('09:00'), at('20:00')]);
    expect(new Set(result.best).size).toBe(3);
  });

  it('answers in the slots’ own order, whatever order they came in', () => {
    const slots = [...slotsAt('11:00', '09:00', '10:00')];
    expect(overlay(slots, [], 'UTC').best).toEqual([at('11:00'), at('09:00'), at('10:00')]);
    expect(overlay([], [busyAt('09:00', '10:00')], 'UTC')).toEqual({ clashes: [], best: [] });
  });
});
