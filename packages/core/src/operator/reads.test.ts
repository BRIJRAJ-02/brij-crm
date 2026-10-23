// The console's periods (spec 0047): UTC days ending today, and the same length before.
import { describe, expect, it } from 'vitest';
import { periodDays } from './reads.ts';

describe('periodDays', () => {
  it('ends today in UTC, starts days back, and puts its twin right before it', () => {
    expect(periodDays('7d', new Date('2026-10-23T23:30:00-05:00'))).toEqual({
      period: '7d',
      today: '2026-10-24',
      last: '2026-10-24',
      from: '2026-10-18',
      to: '2026-10-25',
      before: '2026-10-11',
    });
    const month = periodDays('30d', new Date('2026-03-01T00:00:00Z'));
    expect(month).toMatchObject({ from: '2026-01-31', to: '2026-03-02', before: '2026-01-01' });
  });
});
