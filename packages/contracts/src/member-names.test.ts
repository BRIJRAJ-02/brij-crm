// The one name rule for a member who gives none (spec 0036, AC-1211; QA Q83), shared by first run and the server.
import { describe, expect, it } from 'vitest';
import { memberNameFor, nameFromEmail } from './member-names.ts';

describe('a member’s name when they give none', () => {
  it('is made from the address, words capitalised and digits dropped', () => {
    expect(nameFromEmail('jo.smith-1722@acme.com')).toBe('Jo Smith');
    expect(nameFromEmail('1234@acme.com')).toBe('');
  });

  it('prefers the typed name, then the account’s, then the address’s, then its local part', () => {
    expect(memberNameFor(' Ada ', 'Grace', 'x@acme.com')).toBe('Ada');
    expect(memberNameFor('', 'Grace Hopper', 'x@acme.com')).toBe('Grace Hopper');
    expect(memberNameFor('', '', 'jo.smith@acme.com')).toBe('Jo Smith');
    expect(memberNameFor('', '', '1234@acme.com')).toBe('1234');
  });
});
