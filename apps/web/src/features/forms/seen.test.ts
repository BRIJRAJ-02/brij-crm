// New answers on the forms list (forms critique c): per viewer, from when they last opened Submissions.
import { afterEach, describe, expect, it } from 'vitest';
import { hasNewAnswers, markSeen } from './seen.ts';

const held = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => {
    held.set(key, value);
  },
  removeItem: (key: string) => {
    held.delete(key);
  },
  clear: () => {
    held.clear();
  },
  key: () => null,
  length: 0,
};

afterEach(() => {
  held.clear();
});

describe('new answers on a form', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');

  it('reads New for an answer after the last look, and not once looked at', () => {
    const form = { id: 'f1', lastSubmissionAt: '2026-11-05T11:00:00.000Z' };
    markSeen('acme', 'f1', new Date('2026-11-05T10:00:00.000Z'));
    expect(hasNewAnswers('acme', form, now)).toBe(true);
    markSeen('acme', 'f1', new Date('2026-11-05T11:30:00.000Z'));
    expect(hasNewAnswers('acme', form, now)).toBe(false);
  });

  it('reads New on a never opened form only for a recent answer, and never with no answers', () => {
    expect(hasNewAnswers('acme', { id: 'f2', lastSubmissionAt: '2026-11-04T12:00:00.000Z' }, now)).toBe(true);
    expect(hasNewAnswers('acme', { id: 'f2', lastSubmissionAt: '2026-10-01T12:00:00.000Z' }, now)).toBe(false);
    expect(hasNewAnswers('acme', { id: 'f3' }, now)).toBe(false);
  });
});
