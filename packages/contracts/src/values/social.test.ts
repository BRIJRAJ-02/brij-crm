import { describe, expect, it } from 'vitest';
import {
  checkSocialProfile,
  checkWebLink,
  describeLink,
  networkOfAttribute,
  profileKindOf,
  urlContainsNeedles,
} from './social.ts';

const ok = (value: string) => ({ ok: true, value });
const invalid = { ok: false, reason: 'invalid' };

describe('checkWebLink', () => {
  it('takes a bare domain and adds https, keeping the path case', () => {
    expect(checkWebLink('Example.com/Pricing')).toEqual(ok('https://example.com/Pricing'));
    expect(checkWebLink('  northwind.com ')).toEqual(ok('https://northwind.com'));
    expect(checkWebLink('http://example.com/a?b=1')).toEqual(ok('http://example.com/a?b=1'));
  });

  it('refuses what is not a web address, and a link too long', () => {
    expect(checkWebLink('not a link')).toEqual(invalid);
    expect(checkWebLink('ftp://example.com')).toEqual(invalid);
    expect(checkWebLink(`example.com/${'a'.repeat(2_100)}`)).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('checkSocialProfile', () => {
  it('turns a handle, with or without @, into the profile link', () => {
    expect(checkSocialProfile('x', '@adalovelace', 'person')).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocialProfile('x', 'adalovelace', 'person')).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocialProfile('linkedin', 'ada-lovelace', 'person')).toEqual(
      ok('https://linkedin.com/in/ada-lovelace'),
    );
    expect(checkSocialProfile('github', 'octocat', 'person')).toEqual(ok('https://github.com/octocat'));
    expect(checkSocialProfile('youtube', '@adalovelace', 'person')).toEqual(ok('https://youtube.com/@adalovelace'));
    expect(checkSocialProfile('tiktok', 'ada', 'person')).toEqual(ok('https://tiktok.com/@ada'));
    expect(checkSocialProfile('angellist', 'ada', 'person')).toEqual(ok('https://wellfound.com/u/ada'));
    expect(checkSocialProfile('threads', '@ada', 'person')).toEqual(ok('https://threads.com/@ada'));
  });

  it('takes a bare handle on a company as its company page where the network has one', () => {
    expect(checkSocialProfile('linkedin', 'acme', 'company')).toEqual(ok('https://linkedin.com/company/acme'));
    expect(checkSocialProfile('angellist', 'acme', 'company')).toEqual(ok('https://wellfound.com/company/acme'));
    expect(checkSocialProfile('x', 'acme', 'company')).toEqual(ok('https://x.com/acme'));
    expect(checkSocialProfile('linkedin', 'in/ada', 'company')).toEqual(ok('https://linkedin.com/in/ada'));
  });

  it('refuses a link to another network, naming it, and the network on its own', () => {
    expect(checkSocialProfile('linkedin', 'https://x.com/ada', 'company')).toEqual({
      ok: false,
      reason: 'other_network',
      network: 'x',
    });
    expect(checkSocialProfile('facebook', 'https://www.facebook.com/', 'person')).toEqual(invalid);
    expect(checkSocialProfile('x', 'ada lovelace', 'person')).toEqual(invalid);
    expect(checkSocialProfile('github', '-bad-', 'person')).toEqual(invalid);
  });

  it('normalises a profile link and keeps any other link as checked', () => {
    expect(
      checkSocialProfile('linkedin', 'https://www.linkedin.com/in/ada-lovelace/?utm_source=share', 'person'),
    ).toEqual(ok('https://linkedin.com/in/ada-lovelace'));
    expect(checkSocialProfile('x', 'https://twitter.com/AdaLovelace?s=20', 'person')).toEqual(
      ok('https://x.com/AdaLovelace'),
    );
    expect(checkSocialProfile('x', 'https://x.com/ada/status/1', 'person')).toEqual(ok('https://x.com/ada/status/1'));
    expect(checkSocialProfile('linkedin', 'linktr.ee/ada', 'person')).toEqual(ok('https://linktr.ee/ada'));
  });

  it('checks a canonical link as itself, so a second check changes nothing', () => {
    for (const [network, kind, draft] of [
      ['linkedin', 'company', 'acme'],
      ['linkedin', 'person', 'ada'],
      ['x', 'person', '@ada'],
      ['youtube', 'person', 'ada_talks'],
      ['angellist', 'company', 'acme'],
    ] as const) {
      const first = checkSocialProfile(network, draft, kind);
      if (!first.ok) throw new Error(`${draft} was refused`);
      expect(checkSocialProfile(network, first.value, kind)).toEqual(first);
      expect(checkSocialProfile(network, first.value, 'person')).toEqual(first);
    }
  });
});

describe('describeLink', () => {
  it('shows a profile as the handle with its network, and any other link as domain and path', () => {
    expect(describeLink('https://x.com/adalovelace')).toEqual({ label: '@adalovelace', network: 'x' });
    expect(describeLink('https://youtube.com/c/AdaTalks')).toEqual({ label: '@AdaTalks', network: 'youtube' });
    expect(describeLink('https://www.facebook.com/profile.php?id=4')).toEqual({
      label: 'facebook.com/profile.php',
      network: 'facebook',
    });
    expect(describeLink('https://www.northwind.com/pricing/?ref=1')).toEqual({ label: 'northwind.com/pricing' });
    expect(describeLink('not a url')).toEqual({ label: 'not a url' });
  });
});

describe('networkOfAttribute and profileKindOf', () => {
  it('reads the network from the API name, and nothing from a name on the object prototype', () => {
    expect(networkOfAttribute({ apiSlug: 'twitter' })).toBe('x');
    expect(networkOfAttribute({ apiSlug: 'LinkedIn' })).toBe('linkedin');
    expect(networkOfAttribute({ apiSlug: 'wellfound' })).toBe('angellist');
    expect(networkOfAttribute({ apiSlug: 'website' })).toBeUndefined();
    expect(networkOfAttribute({ apiSlug: 'constructor' })).toBeUndefined();
    expect(networkOfAttribute({})).toBeUndefined();
  });

  it('holds a company page only on Companies', () => {
    expect(profileKindOf({ objectKey: 'companies' })).toBe('company');
    expect(profileKindOf({ objectKey: 'people' })).toBe('person');
    expect(profileKindOf({ objectKey: null })).toBe('person');
    expect(profileKindOf({})).toBe('person');
  });
});

describe('urlContainsNeedles', () => {
  it('looks for a handle typed with @ as the profile path too', () => {
    expect(urlContainsNeedles(' @Ada ')).toEqual(['@ada', '/ada']);
    expect(urlContainsNeedles('ada')).toEqual(['ada']);
    expect(urlContainsNeedles('@')).toEqual(['@']);
    expect(urlContainsNeedles('ada@example.com')).toEqual(['ada@example.com']);
    expect(urlContainsNeedles('@ada/x')).toEqual(['@ada/x']);
  });
});
