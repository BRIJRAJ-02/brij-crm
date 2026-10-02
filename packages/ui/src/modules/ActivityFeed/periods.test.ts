import { describe, expect, it } from 'vitest';
import { periodOf } from './periods.ts';

// Thursday 8 October 2026, 14:30 in London (13:30 UTC), as the stories' clock.
const NOW = Date.parse('2026-10-08T13:30:00.000Z');

describe('periodOf', () => {
  it('puts the same calendar day in Today, by the time zone', () => {
    expect(periodOf('2026-10-07T23:30:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('today');
    expect(periodOf('2026-10-07T23:30:00.000Z', NOW, 'UTC', 'en-GB')).toBe('yesterday');
  });

  it('keeps a moment slightly ahead of the clock in Today', () => {
    expect(periodOf('2026-10-08T13:31:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('today');
  });

  it('puts earlier days of this week in This week, from the language’s first day', () => {
    // Monday 5 October starts the week in en-GB; Sunday 4 October starts it in en-US.
    expect(periodOf('2026-10-05T09:00:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('week');
    expect(periodOf('2026-10-04T09:00:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('2026-10');
    expect(periodOf('2026-10-04T09:00:00.000Z', NOW, 'Europe/London', 'en-US')).toBe('week');
  });

  it('names older entries by their month', () => {
    expect(periodOf('2026-09-30T09:00:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('2026-09');
    expect(periodOf('2025-12-31T09:00:00.000Z', NOW, 'Europe/London', 'en-GB')).toBe('2025-12');
  });
});
