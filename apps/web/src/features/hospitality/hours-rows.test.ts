import { describe, expect, it } from 'vitest';
import { fromEditor, toEditor, todayRanges, weekRows, withDay } from './hours-rows.ts';

describe('a place’s hours in the editor', () => {
  it('draws a range past midnight with its end past 24:00, and stores it back crossing midnight', () => {
    expect(toEditor({ from: '18:00', to: '02:00' })).toEqual(['18:00', '26:00']);
    expect(toEditor({ from: '12:00', to: '15:00' })).toEqual(['12:00', '15:00']);
    expect(toEditor({ from: '18:00', to: '00:00' })).toEqual(['18:00', '24:00']);
    expect(fromEditor(['18:00', '26:00'], 'Dinner')).toEqual({ from: '18:00', to: '02:00', name: 'Dinner' });
    expect(fromEditor(['18:00', '24:00'], undefined)).toEqual({ from: '18:00', to: '00:00' });
  });

  it('draws the week Monday first, the error on its day, and keeps names by place', () => {
    const rows = weekRows({ weekly: { fri: [{ from: '18:00', to: '02:00' }] }, exceptions: [] }, (day) => day, {
      day: 'fri',
      message: 'No.',
    });
    expect(rows.map((row) => row.id)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(rows[4]).toEqual({ id: 'fri', label: 'fri', ranges: [['18:00', '26:00']], error: 'No.' });
    const changed = withDay(
      { weekly: { tue: [{ from: '12:00', to: '15:00', name: 'Lunch' }] }, exceptions: [] },
      'tue',
      [
        ['12:00', '14:30'],
        ['18:00', '23:00'],
      ],
    );
    expect(changed.problem).toBeUndefined();
    expect(changed.hours.weekly.tue).toEqual([
      { from: '12:00', to: '14:30', name: 'Lunch' },
      { from: '18:00', to: '23:00' },
    ]);
  });

  it('says what is wrong when a late night runs into the next morning’s opening', () => {
    const changed = withDay({ weekly: { sat: [{ from: '01:00', to: '05:00' }] }, exceptions: [] }, 'fri', [
      ['18:00', '27:00'],
    ]);
    expect(changed.problem).toMatch(/next day/);
  });
});

describe('today at a place', () => {
  it('reads the week by the place’s own date, and a special day in its place', () => {
    const hours = {
      weekly: { tue: [{ from: '12:00', to: '15:00' }] },
      exceptions: [{ date: '2026-11-10', closed: true }],
    };
    // 23:30 UTC on Monday 2 Nov is already Tuesday in Tokyo.
    expect(todayRanges(hours, 'Asia/Tokyo', new Date('2026-11-02T23:30:00Z'))).toEqual([
      { from: '12:00', to: '15:00' },
    ]);
    expect(todayRanges(hours, 'Europe/London', new Date('2026-11-10T12:00:00Z'))).toEqual([]);
  });
});
