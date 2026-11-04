// Settings' Closes row (forms fix b2): the rule as a choice, and a day as the moment it closes, and back.
import { describe, expect, it } from 'vitest';
import { closingKind, closingOnDay, dayOfClosing } from './closing.ts';

describe('a form’s closing rule', () => {
  it('reads as never, a day or a count', () => {
    expect(closingKind(undefined)).toBe('never');
    expect(closingKind({ at: '2026-12-01T00:00:00.000Z' })).toBe('date');
    expect(closingKind({ after: 100 })).toBe('count');
  });

  it('closes at the end of the chosen day in the workspace’s zone, and reads back as that day', () => {
    expect(closingOnDay('2026-12-01', 'Asia/Kolkata')).toBe('2026-12-01T18:30:00.000Z');
    expect(closingOnDay('2026-07-01', 'Europe/London')).toBe('2026-07-01T23:00:00.000Z');
    expect(closingOnDay('2026-12-01', 'UTC')).toBe('2026-12-02T00:00:00.000Z');
    expect(dayOfClosing('2026-12-01T18:30:00.000Z', 'Asia/Kolkata')).toBe('2026-12-01');
    expect(dayOfClosing(undefined, 'UTC')).toBeNull();
  });
});
