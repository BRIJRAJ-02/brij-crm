import { describe, expect, it } from 'vitest';
import { suggestEmail } from './email-hint.ts';

describe('suggestEmail', () => {
  it('suggests the provider a domain misspells', () => {
    expect(suggestEmail('ada@gmial.com')).toBe('ada@gmail.com');
    expect(suggestEmail('ada@gmail.con')).toBe('ada@gmail.com');
    expect(suggestEmail('ada@hotmal.com')).toBe('ada@hotmail.com');
    expect(suggestEmail('ada@outlok.com')).toBe('ada@outlook.com');
    expect(suggestEmail(' Ada.L@YAHO.COM ')).toBe('Ada.L@yahoo.com');
  });

  it('leaves a provider, a company domain and an unfinished address alone', () => {
    expect(suggestEmail('ada@gmail.com')).toBeUndefined();
    expect(suggestEmail('ada@acme.com')).toBeUndefined();
    expect(suggestEmail('ada@ibm.com')).toBeUndefined();
    expect(suggestEmail('ada@mail.com')).toBeUndefined();
    expect(suggestEmail('ada@')).toBeUndefined();
    expect(suggestEmail('ada')).toBeUndefined();
    expect(suggestEmail('@gmial.com')).toBeUndefined();
  });

  it('allows one edit on a short domain, so a near company domain stays', () => {
    expect(suggestEmail('ada@me.co')).toBe('ada@me.com');
    expect(suggestEmail('ada@msm.co')).toBeUndefined();
  });
});
