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

  it('never corrects a company domain near a provider', () => {
    for (const domain of ['ge.com', 'aon.com', 'max.com', 'lime.com', 'cloud.com', 'me.co', 'gmx.co', 'zohoo.com']) {
      expect(suggestEmail(`ada@${domain}`)).toBeUndefined();
    }
  });

  it('allows two edits on the longest names', () => {
    expect(suggestEmail('ada@protonmial.cmo')).toBe('ada@protonmail.com');
    expect(suggestEmail('ada@gmial.con')).toBeUndefined();
  });
});
