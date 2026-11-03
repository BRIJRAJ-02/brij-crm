import { describe, expect, it } from 'vitest';
import { addDays, compact, isOpenOn, openDays, placeDate, services } from './days.ts';

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

  it('splits a day into Lunch and Dinner on the place’s clock, and reads its date there', () => {
    const times = ['2026-11-09T12:00:00.000Z', '2026-11-09T15:45:00.000Z', '2026-11-09T18:00:00.000Z'];
    expect(services(times, 'Europe/London')).toEqual([
      { name: 'lunch', times: times.slice(0, 2) },
      { name: 'dinner', times: times.slice(2) },
    ]);
    // 15:45 UTC is 21:15 in Kolkata: dinner there.
    expect(services(times, 'Asia/Kolkata').map((each) => each.name)).toEqual(['dinner']);
    expect(placeDate('2026-11-09T23:30:00.000Z', 'Asia/Kolkata')).toBe('2026-11-10');
    expect(compact('2026-11-09T18:00:00.000Z')).toBe('20261109T180000Z');
  });
});
