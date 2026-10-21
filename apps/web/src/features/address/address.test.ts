// A workspace's web address (spec 0005, Value sourcing; spec 0036): made
// from the workspace name, as it is typed, and the free ones offered.
import { describe, expect, it } from 'vitest';
import { addressAsTyped, addressCandidates, companyDomain, SLUG_RULE, slugFrom } from './address.ts';

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
