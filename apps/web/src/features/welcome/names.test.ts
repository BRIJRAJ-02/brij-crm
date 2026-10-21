// The welcome page's suggestions (spec 0005, Value sourcing): the workspace
// name from your first name, and a name from an email.
import { describe, expect, it } from 'vitest';
import { firstWord, memberNameFor, nameFromEmail, suggestedWorkspaceName } from './names.ts';
import { strings } from './strings.ts';

describe('the suggested workspace name', () => {
  it('is the first word of your name, then ’s workspace', () => {
    expect(suggestedWorkspaceName('Ada Lovelace', strings.possessive)).toBe('Ada’s workspace');
    expect(suggestedWorkspaceName('  Grace   Hopper ', strings.possessive)).toBe('Grace’s workspace');
  });

  it('is empty while there is no name', () => {
    expect(suggestedWorkspaceName('   ', strings.possessive)).toBe('');
    expect(firstWord('')).toBe('');
  });
});

describe('a name made from an email (spec 0036, AC-1211)', () => {
  it.each([
    ['ada.lovelace@acme.com', 'Ada Lovelace'],
    ['grace_hopper@navy.mil', 'Grace Hopper'],
    ['jean-luc@example.com', 'Jean Luc'],
    ['ada+crm@acme.com', 'Ada'],
    ['ranabrijraj82@gmail.com', 'Ranabrijraj'],
    ['zoë.ünal@example.com', 'Zoë Ünal'],
  ])('makes %s into %s', (email, name) => {
    expect(nameFromEmail(email)).toBe(name);
  });

  it('is empty when nothing but digits or marks is left', () => {
    expect(nameFromEmail('12345@example.com')).toBe('');
    expect(nameFromEmail('._-@example.com')).toBe('');
  });
});

describe('the name a member is made with', () => {
  it('is the one typed, else the account’s, else one from the email, never empty', () => {
    expect(memberNameFor(' Ada ', 'Grace Hopper', 'x@acme.com')).toBe('Ada');
    expect(memberNameFor('  ', 'Grace Hopper', 'x@acme.com')).toBe('Grace Hopper');
    expect(memberNameFor('', '', 'ada.lovelace@acme.com')).toBe('Ada Lovelace');
    expect(memberNameFor('', '', '12345@acme.com')).toBe('12345');
  });

  it('keeps to 80 characters, as the server takes it', () => {
    expect(memberNameFor('a'.repeat(100), '', 'x@acme.com')).toHaveLength(80);
  });
});
