// Why a submission is in Spam or Needs review (forms fix a8).
import { describe, expect, it } from 'vitest';
import { spamReason } from './spam-reason.ts';

describe('why a submission is spam', () => {
  it('says the first signal that explains it, in plain words', () => {
    expect(spamReason(['honeypot', 'links'], 'spam')).toMatch(/bot check/);
    expect(spamReason(['captcha_low_score'], 'spam')).toMatch(/robot check/);
    expect(spamReason(['captcha_unavailable', 'disposable_email'], 'needs_review')).toMatch(/throwaway/);
    expect(spamReason(['many_links'], 'needs_review')).toMatch(/links/);
  });

  it('says someone marked it, or that a held one waits, when no signal explains it', () => {
    expect(spamReason([], 'spam')).toBe('Someone marked it as spam.');
    expect(spamReason([], 'needs_review')).toMatch(/waits for you/);
  });
});
