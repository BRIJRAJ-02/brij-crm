import { describe, expect, it } from 'vitest';
import { formatTime, minutesOfClock, timeOptions } from './time-options.ts';

describe('timeOptions', () => {
  it('lists the day 15 minutes apart by default', () => {
    const options = timeOptions({ locale: 'en-GB', hourCycle: 24 });
    expect(options).toHaveLength(96);
    expect(options[0]).toEqual({ id: '00:00', label: '00:00' });
    expect(options.at(-1)).toEqual({ id: '23:45', label: '23:45' });
  });

  it('starts an end time after its start and stops before `to`', () => {
    const options = timeOptions({ locale: 'en-US', hourCycle: 12, step: 30, from: 9 * 60 + 30, to: 11 * 60 });
    expect(options.map((option) => option.id)).toEqual(['09:30', '10:00', '10:30']);
    expect(options[0]?.label).toBe('9:30 AM');
  });
});

describe('formatTime', () => {
  it('reads a time on either clock', () => {
    expect(formatTime('13:05', 'en-US', 12)).toBe('1:05 PM');
    expect(formatTime('13:05', 'en-US', 24)).toBe('13:05');
    expect(formatTime('00:00', 'en-GB', 24)).toBe('00:00');
  });

  it('leaves a text that is not a time as it is', () => {
    expect(formatTime('25:00', 'en-US', 12)).toBe('25:00');
    expect(minutesOfClock('9:30')).toBeUndefined();
  });
});
