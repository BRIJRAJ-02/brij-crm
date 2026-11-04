// Settings' Closes row (forms fix b2): the rule as a choice, and a day as the moment it closes, and back.
import { describe, expect, it } from 'vitest';
import { closingKind, closingOnDay, dayOfClosing } from './closing.ts';

describe('a form’s closing rule', () => {
  it('reads as never, a day or a count', () => {
    expect(closingKind(undefined)).toBe('never');
    expect(closingKind({ at: '2026-12-01T00:00:00.000Z' })).toBe('date');
    expect(closingKind({ after: 100 })).toBe('count');
  });

  it('closes at the end of the chosen day, and reads back as that day', () => {
    const at = closingOnDay('2026-12-01');
    expect(new Date(at).getDate()).toBe(2);
    expect(new Date(at).getHours()).toBe(0);
    expect(dayOfClosing(at)).toBe('2026-12-01');
    expect(dayOfClosing(undefined)).toBeNull();
  });
});
