import { describe, expect, it } from 'vitest';
import { invitableRoles, parseEmails } from './members.ts';

describe('invitableRoles (spec 0031, AC-803)', () => {
  it('lets only an owner invite an owner, and a member nobody', () => {
    expect(invitableRoles('owner')).toEqual(['owner', 'admin', 'member']);
    expect(invitableRoles('admin')).toEqual(['admin', 'member']);
    expect(invitableRoles('member')).toEqual([]);
  });
});

describe('parseEmails (spec 0031, the Invite dialog)', () => {
  it('reads a pasted list, lowercased and without repeats', () => {
    expect(parseEmails(' Ada@Example.com, grace@example.com;\nada@example.com  linus@example.org ')).toEqual({
      emails: ['ada@example.com', 'grace@example.com', 'linus@example.org'],
      invalid: [],
    });
  });

  it('takes Name <address> and names what isn’t an address', () => {
    expect(parseEmails('Ada Lovelace <ada@example.com>, nope, x@y')).toEqual({
      emails: ['ada@example.com'],
      invalid: ['nope', 'x@y'],
    });
  });
});
