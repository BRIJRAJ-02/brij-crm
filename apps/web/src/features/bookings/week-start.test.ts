// Bookings' week starts on the member's week start (Settings › Account › Preferences).
import { describe, expect, it } from 'vitest';
import { weekStartOf } from '../workspace/first-day.ts';
import { bookingsSearchOf } from './search.ts';
import { weekOf } from './week.ts';

describe('the week start', () => {
  it('starts a week on Monday by default, or the day chosen', () => {
    // 22 October 2026 is a Thursday.
    expect(weekOf('2026-10-22')).toBe('2026-10-19');
    expect(weekOf('2026-10-22', 0)).toBe('2026-10-18');
    expect(weekOf('2026-10-22', 6)).toBe('2026-10-17');
    expect(weekOf('2026-10-18', 0)).toBe('2026-10-18');
  });

  it('opens Bookings on the week holding today from the chosen day', () => {
    expect(bookingsSearchOf({ d: '2026-10-22' }, new Date(), 0).week).toBe('2026-10-18');
  });

  it('reads Automatic, or no choice yet, as Monday, as in round 6; a chosen day wins', () => {
    expect(weekStartOf('auto')).toBe('monday');
    expect(weekStartOf(undefined)).toBe('monday');
    expect(weekStartOf('sunday')).toBe('sunday');
  });
});
