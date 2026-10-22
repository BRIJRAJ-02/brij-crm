// A step up's code (spec 0033, AC-896): what the API answers for a code it refuses reaches a person, so it is
// plain words, never Zod's own ("Too small: expected string to have >=6 characters" once did).
import { describe, expect, it } from 'vitest';
import { StepUpVerifyInput } from './account.ts';

const refusal = (code: string) => {
  const parsed = StepUpVerifyInput.safeParse({ method: 'email', code });
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

describe('StepUpVerifyInput', () => {
  it('takes a 6 digit code and a backup code, trimmed', () => {
    expect(StepUpVerifyInput.parse({ method: 'email', code: ' 123456 ' }).code).toBe('123456');
    expect(StepUpVerifyInput.parse({ method: 'backup', code: 'abcde-12345' }).code).toBe('abcde-12345');
  });

  it('refuses a short, long or odd code in plain words', () => {
    const plain = 'That code doesn’t look right. Check it and try again.';
    expect(refusal('12345')).toBe(plain);
    expect(refusal('1'.repeat(21))).toBe(plain);
    expect(refusal('12 3456')).toBe(plain);
  });
});
