import { describe, expect, it } from 'vitest';
import { handoffKey, HANDOFF_SECONDS, readHandoff, signHandoff } from './handoff.ts';

const key = handoffKey('a-session-secret-of-at-least-thirty-two-characters');
const handoff = {
  submissionId: '0192f0a0-0000-7000-8000-000000000001',
  bookingPageId: '0192f0a0-0000-7000-8000-000000000002',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
};
const now = new Date('2026-10-20T10:00:00Z');

describe('the form to booking hand off (AC-1057, AC-1058)', () => {
  it('reads back what it signed, within a day', () => {
    const token = signHandoff(key, handoff, now);
    expect(readHandoff(key, token, now)).toEqual(handoff);
    expect(readHandoff(key, token, new Date(now.getTime() + (HANDOFF_SECONDS - 60) * 1000))).toEqual(handoff);
  });

  it('refuses an expired, tampered, foreign or missing token', () => {
    const token = signHandoff(key, handoff, now);
    expect(readHandoff(key, token, new Date(now.getTime() + (HANDOFF_SECONDS + 1) * 1000))).toBeUndefined();
    const [version, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ s: handoff.submissionId, b: handoff.bookingPageId, n: 'Mallory', e: 2e9 }),
    ).toString('base64url');
    expect(readHandoff(key, `${version ?? ''}.${forged}.${signature ?? ''}`, now)).toBeUndefined();
    expect(readHandoff(handoffKey('another-session-secret-of-thirty-two-chars'), token, now)).toBeUndefined();
    expect(readHandoff(key, undefined, now)).toBeUndefined();
    expect(readHandoff(key, 'name=Ada', now)).toBeUndefined();
  });

  it('carries no name or email when the form asked for none', () => {
    const token = signHandoff(key, { submissionId: handoff.submissionId, bookingPageId: handoff.bookingPageId }, now);
    expect(readHandoff(key, token, now)).toEqual({
      submissionId: handoff.submissionId,
      bookingPageId: handoff.bookingPageId,
    });
  });
});
