import { describe, expect, it } from 'vitest';
import { activitySentence } from './activity.ts';

describe('a followed record’s sentence', () => {
  const none = { fields: 0, notes: 0, comments: 0, tasks: 0 };
  it('names one kind of change with its count, and counts a mix as changes', () => {
    expect(activitySentence('Ada', { ...none, fields: 3 })).toBe('Ada changed 3 fields');
    expect(activitySentence('Ada', { ...none, fields: 1 })).toBe('Ada changed a field');
    expect(activitySentence('Ada', { ...none, notes: 1 })).toBe('Ada added a note');
    expect(activitySentence('Ada', { ...none, comments: 1 })).toBe('Ada commented');
    expect(activitySentence('Ada', { ...none, tasks: 2 })).toBe('Ada completed 2 tasks');
    expect(activitySentence('Ada', { fields: 2, notes: 1, comments: 1, tasks: 0 })).toBe('Ada made 4 changes');
  });
});
