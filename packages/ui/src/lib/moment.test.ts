import { describe, expect, it } from 'vitest';
import { formatClockOf, formatMoment, momentOf, momentParts } from './moment.ts';

/** Intl puts a narrow no break space before AM and PM in newer ICU: compared as a plain space. */
const plain = (text: string) => text.replaceAll('\u202f', ' ');

// Stories freeze the clock at 8 October 2026, 14:30 UTC, in Europe/London (15:30 BST): the same here.
const NOW = Date.UTC(2026, 9, 8, 14, 30);
const LONDON = 'Europe/London';

describe('momentParts and momentOf', () => {
  it('reads a moment as its day and time in the zone, and back to the same instant', () => {
    expect(momentParts('2026-10-08T13:30:00.000Z', LONDON)).toEqual({ date: '2026-10-08', time: '14:30' });
    expect(momentOf('2026-10-08', '14:30', LONDON)).toBe('2026-10-08T13:30:00.000Z');
    expect(momentParts('2026-10-08T23:30:00.000Z', 'Asia/Kolkata')).toEqual({ date: '2026-10-09', time: '05:00' });
  });

  it('refuses what isn’t a moment, a day or a time', () => {
    expect(momentParts('not a time', LONDON)).toBeUndefined();
    expect(momentOf('8 Oct', '14:30', LONDON)).toBeUndefined();
    expect(momentOf('2026-10-08', '2pm', LONDON)).toBeUndefined();
  });
});

describe('formatMoment', () => {
  it('says Today, Yesterday or Tomorrow beside the time near today', () => {
    expect(formatMoment('2026-10-08T08:05:00.000Z', NOW, 'en-GB', LONDON)).toBe('Today 9:05');
    expect(formatMoment('2026-10-07T08:05:00.000Z', NOW, 'en-GB', LONDON)).toBe('Yesterday 9:05');
    expect(formatMoment('2026-10-09T08:05:00.000Z', NOW, 'en-GB', LONDON)).toBe('Tomorrow 9:05');
  });

  it('gives the exact day and time further away, in the language', () => {
    expect(formatMoment('2026-09-01T08:05:00.000Z', NOW, 'en-GB', LONDON)).toBe('1 Sept 2026, 9:05');
    expect(plain(formatMoment('2026-09-01T08:05:00.000Z', NOW, 'en-US', 'America/New_York'))).toBe(
      'Sep 1, 2026, 4:05 AM',
    );
  });

  it('writes a time picker’s times in the language', () => {
    expect(formatClockOf('14:30', 'en-GB')).toBe('14:30');
    expect(plain(formatClockOf('14:30', 'en-US'))).toBe('2:30 PM');
  });
});
