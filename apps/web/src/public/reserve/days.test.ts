import { describe, expect, it } from 'vitest';
import { addDays, compact, isOpenOn, openDays, placeDate, rangesOn, services } from './days.ts';

const hours = {
  weekly: { mon: [{ from: '12:00', to: '23:00' }], tue: [{ from: '18:00', to: '23:00' }] },
  exceptions: [
    { date: '2026-11-10', closed: true },
    { date: '2026-11-15', ranges: [{ from: '12:00', to: '15:00' }] },
  ],
};

describe('the reservation page’s days and times', () => {
  it('opens by the weekly pattern, with exceptions deciding their own day', () => {
    expect(isOpenOn(hours, '2026-11-09')).toBe(true); // a Monday
    expect(isOpenOn(hours, '2026-11-10')).toBe(false); // a Tuesday, closed that day
    expect(isOpenOn(hours, '2026-11-15')).toBe(true); // a Sunday, opened that day
    expect(isOpenOn(hours, '2026-11-11')).toBe(false); // a Wednesday
    expect(openDays({ hours, today: '2026-11-09', windowDays: 10 })).toEqual([
      '2026-11-09',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('groups a day’s times by the place’s own service windows, on the place’s clock', () => {
    const times = ['2026-11-09T12:00:00.000Z', '2026-11-09T14:45:00.000Z', '2026-11-09T18:00:00.000Z'];
    const lunchDinner = [
      { from: '12:00', to: '15:00' },
      { from: '18:00', to: '22:00' },
    ];
    // London is on UTC in November: two windows read Lunch and Dinner, whatever the hour.
    expect(services(times, 'Europe/London', lunchDinner)).toEqual([
      { key: '12:00', heading: { kind: 'lunch' }, times: times.slice(0, 2) },
      { key: '18:00', heading: { kind: 'dinner' }, times: times.slice(2) },
    ]);
    // A late lunch window (until 17:00) keeps a 16:30 start at lunch: no fixed 16:00 cut.
    expect(
      services(['2026-11-09T16:30:00.000Z'], 'Europe/London', [
        { from: '12:00', to: '17:00' },
        { from: '19:00', to: '23:00' },
      ]).map((each) => each.heading),
    ).toEqual([{ kind: 'lunch' }]);
    // One window is just Times; a named window keeps its name.
    expect(services(times, 'Europe/London', [{ from: '12:00', to: '23:00' }])[0]?.heading).toEqual({ kind: 'times' });
    expect(services(times, 'Europe/London', [{ from: '10:00', to: '23:00', name: 'Brunch' }])[0]?.heading).toEqual({
      kind: 'named',
      text: 'Brunch',
    });
    // 14:45 UTC is 20:15 in Kolkata: dinner there.
    expect(services(times.slice(1, 2), 'Asia/Kolkata', lunchDinner).map((each) => each.heading)).toEqual([
      { kind: 'dinner' },
    ]);
    expect(rangesOn(hours, '2026-11-15')).toEqual([{ from: '12:00', to: '15:00' }]);
    expect(rangesOn(hours, '2026-11-10')).toEqual([]);
    expect(placeDate('2026-11-09T23:30:00.000Z', 'Asia/Kolkata')).toBe('2026-11-10');
    expect(compact('2026-11-09T18:00:00.000Z')).toBe('20261109T180000Z');
  });
});
