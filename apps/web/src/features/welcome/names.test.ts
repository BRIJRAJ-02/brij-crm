// The welcome page's suggestions (spec 0005, Value sourcing): the workspace
// name from your first name, and the web address from the workspace name.
import { describe, expect, it } from 'vitest';
import {
  addressAsTyped,
  addressCandidates,
  companyDomain,
  firstWord,
  memberNameFor,
  nameFromEmail,
  SLUG_RULE,
  slugFrom,
  suggestedWorkspaceName,
} from './names.ts';
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

describe('the web address', () => {
  it.each([
    ['Ada’s workspace', 'adas-workspace'],
    ["Ada's workspace", 'adas-workspace'],
    ['Halcyon Labs', 'halcyon-labs'],
    ['  Café  Zürich!! ', 'cafe-zurich'],
    ['ACME -- Corp', 'acme-corp'],
    ['2026 plans', '2026-plans'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugFrom(name)).toBe(slug);
    expect(SLUG_RULE.test(slug)).toBe(true);
  });

  it('keeps to 40 characters with no dash at the end', () => {
    const slug = slugFrom('The extremely long name of a workspace that goes on and on');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG_RULE.test(slug)).toBe(true);
  });

  it('can come out too short or empty, which the rule refuses', () => {
    expect(slugFrom('Al')).toBe('al');
    expect(SLUG_RULE.test('al')).toBe(false);
    expect(slugFrom('日本')).toBe('');
    expect(SLUG_RULE.test('')).toBe(false);
    expect(SLUG_RULE.test('two--dashes')).toBe(false);
    expect(SLUG_RULE.test('Upper')).toBe(false);
  });
});

describe('the web address as it is typed', () => {
  it('is lowercase, with spaces as dashes', () => {
    expect(addressAsTyped('Halcyon Labs')).toBe('halcyon-labs');
    expect(addressAsTyped('acme  hq')).toBe('acme-hq');
    expect(addressAsTyped('acme-')).toBe('acme-');
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

describe('the addresses offered (spec 0036)', () => {
  it('start from the name, then a company email’s domain, with a number only last', () => {
    expect(addressCandidates('Stealth', 'brij@stealth.design').slice(0, 3)).toEqual([
      'stealth',
      'stealth-design',
      'stealth-team',
    ]);
    const offered = addressCandidates('Ada’s workspace', 'ada@acme.com');
    expect(offered.slice(0, 3)).toEqual(['ada', 'acme', 'adas-workspace']);
    expect(offered.at(-1)).toBe('ada-4');
    expect(offered.every((each) => SLUG_RULE.test(each))).toBe(true);
  });

  it('leave a personal mailbox’s domain out', () => {
    expect(companyDomain('ada@gmail.com')).toBeUndefined();
    expect(companyDomain('ada@Stealth.Design')).toBe('stealth.design');
    expect(addressCandidates('Grace’s workspace', 'grace@gmail.com').slice(0, 2)).toEqual([
      'grace',
      'graces-workspace',
    ]);
  });

  it('come from the domain when there is no name', () => {
    expect(addressCandidates('', 'ada@halcyon.io')[0]).toBe('halcyon');
    expect(addressCandidates('', 'ada@gmail.com')).toEqual([]);
  });
});
