import { describe, expect, it } from 'vitest';
import { handoffForPage, handoffKey, HANDOFF_SECONDS, readHandoff, signHandoff } from './handoff.ts';

const key = handoffKey('a-session-secret-of-at-least-thirty-two-characters');
const handoff = {
  submissionId: '0192f0a0-0000-7000-8000-000000000001',
  bookingPageId: '0192f0a0-0000-7000-8000-000000000002',
};
const otherPage = '0192f0a0-0000-7000-8000-000000000003';
const now = new Date('2026-10-20T10:00:00Z');

describe('the form to booking hand off (AC-1057, AC-1058)', () => {
  it('reads back what it signed, within a day, and carries nothing personal', () => {
    const token = signHandoff(key, handoff, now);
    expect(readHandoff(key, token, now)).toEqual(handoff);
    expect(readHandoff(key, token, new Date(now.getTime() + (HANDOFF_SECONDS - 60) * 1000))).toEqual(handoff);
    const payload = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(payload) as object).sort()).toEqual(['b', 'e', 's']);
  });

  it('refuses an expired, tampered, foreign or missing token', () => {
    const token = signHandoff(key, handoff, now);
    expect(readHandoff(key, token, new Date(now.getTime() + (HANDOFF_SECONDS + 1) * 1000))).toBeUndefined();
    const [version, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: handoff.submissionId, b: otherPage, e: 2e9 })).toString('base64url');
    expect(readHandoff(key, `${version ?? ''}.${forged}.${signature ?? ''}`, now)).toBeUndefined();
    expect(readHandoff(handoffKey('another-session-secret-of-thirty-two-chars'), token, now)).toBeUndefined();
    expect(readHandoff(key, undefined, now)).toBeUndefined();
    expect(readHandoff(key, 'name=Ada', now)).toBeUndefined();
  });

  it('refuses ids that are not ids, even signed', () => {
    const token = signHandoff(key, { submissionId: '', bookingPageId: handoff.bookingPageId }, now);
    expect(readHandoff(key, token, now)).toBeUndefined();
  });

  it('counts a token only on the page it was signed for', () => {
    const token = signHandoff(key, handoff, now);
    expect(handoffForPage(key, token, handoff.bookingPageId, now)).toEqual(handoff);
    expect(handoffForPage(key, token, otherPage, now)).toBeUndefined();
    expect(handoffForPage(undefined, token, handoff.bookingPageId, now)).toBeUndefined();
    expect(handoffForPage(key, '', handoff.bookingPageId, now)).toBeUndefined();
  });
});
