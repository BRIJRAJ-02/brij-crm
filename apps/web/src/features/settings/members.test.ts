import { describe, expect, it } from 'vitest';
import { canRemove, grantableRoles, invitableRoles, parseEmails, takesAccess } from './members.ts';

describe('grantableRoles (spec 0031, AC-811)', () => {
  it('lets an owner give any role, an admin move people below owner, and a member nothing', () => {
    expect(grantableRoles('owner', 'owner')).toEqual(['owner', 'admin', 'member', 'guest']);
    expect(grantableRoles('admin', 'member')).toEqual(['admin', 'member', 'guest']);
    expect(grantableRoles('admin', 'guest')).toEqual(['admin', 'member', 'guest']);
    expect(grantableRoles('admin', 'owner')).toEqual([]);
    expect(grantableRoles('member', 'member')).toEqual([]);
    expect(grantableRoles('guest', 'member')).toEqual([]);
    expect(grantableRoles(undefined, 'member')).toEqual([]);
  });

  it('lets the same people remove, never themselves (leaving is the workspace menu’s)', () => {
    expect(canRemove('owner', 'owner', false)).toBe(true);
    expect(canRemove('admin', 'member', false)).toBe(true);
    expect(canRemove('admin', 'owner', false)).toBe(false);
    expect(canRemove('member', 'member', false)).toBe(false);
    expect(canRemove('owner', 'owner', true)).toBe(false);
  });
});

describe('invitableRoles (spec 0031, AC-803)', () => {
  it('lets only an owner invite an owner, and a member nobody', () => {
    expect(invitableRoles('owner')).toEqual(['owner', 'admin', 'member', 'guest']);
    expect(invitableRoles('admin')).toEqual(['admin', 'member', 'guest']);
    expect(invitableRoles('member')).toEqual([]);
    expect(invitableRoles('guest')).toEqual([]);
  });
});

describe('takesAccess (a role change that asks first)', () => {
  it('asks for every step down, guest included, and never for a step up', () => {
    expect(takesAccess('admin', 'member')).toBe(true);
    expect(takesAccess('member', 'guest')).toBe(true);
    expect(takesAccess('owner', 'guest')).toBe(true);
    expect(takesAccess('guest', 'member')).toBe(false);
    expect(takesAccess('member', 'admin')).toBe(false);
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
