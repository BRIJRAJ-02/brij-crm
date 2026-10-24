import { describe, expect, it } from 'vitest';
import {
  checkSocialLink,
  checkSocialProfile,
  checkWebLink,
  describeLink,
  networkOfAttribute,
  profileKindOf,
  socialLinkFieldValue,
  socialLinkPrefix,
  socialLinkProblem,
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

describe('long input', () => {
  it('refuses text past 2,048 characters before any pattern runs, quickly', () => {
    const slashes = `${'/'.repeat(500_000)}x`;
    const started = performance.now();
    expect(checkSocialProfile('linkedin', slashes, 'person')).toEqual(invalid);
    expect(checkSocialProfile('x', `x.com/${'/'.repeat(2_000)}ada`, 'person')).toHaveProperty('ok');
    expect(checkWebLink(slashes)).toEqual({ ok: false, reason: 'too_long' });
    expect(performance.now() - started).toBeLessThan(500);
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

describe('checkSocialLink (a person’s own links, booking socials)', () => {
  it('turns a handle or a pasted profile link into the network’s one link', () => {
    expect(checkSocialLink('linkedin', ' ada-lovelace ')).toEqual({
      ok: true,
      value: 'https://linkedin.com/in/ada-lovelace',
    });
    expect(checkSocialLink('x', '@ada')).toEqual({ ok: true, value: 'https://x.com/ada' });
    expect(checkSocialLink('x', 'https://twitter.com/ada?s=20')).toEqual({ ok: true, value: 'https://x.com/ada' });
    expect(checkSocialLink('youtube', 'ada.makes')).toEqual({ ok: true, value: 'https://youtube.com/@ada.makes' });
    expect(checkSocialLink('angellist', 'ada')).toEqual({ ok: true, value: 'https://wellfound.com/u/ada' });
  });

  it('refuses a link to another network, naming it, and a link that is no profile', () => {
    expect(checkSocialLink('linkedin', 'https://instagram.com/ada')).toEqual({
      ok: false,
      reason: 'other_network',
      network: 'instagram',
    });
    expect(checkSocialLink('linkedin', 'https://linkedin.com/feed/')).toEqual({ ok: false, reason: 'not_profile' });
    expect(checkSocialLink('instagram', 'https://linktr.ee/ada')).toEqual({ ok: false, reason: 'not_profile' });
    expect(checkSocialLink('x', 'not a handle!')).toEqual({ ok: false, reason: 'invalid' });
    // A pasted link's handle is held to the network's own pattern too.
    expect(checkSocialLink('x', 'https://x.com/ada%20verified')).toEqual({ ok: false, reason: 'not_profile' });
    expect(checkSocialLink('x', 'https://x.com/ada%E2%80%AE')).toEqual({ ok: false, reason: 'not_profile' });
    expect(checkSocialLink('x', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('takes a website as an http or https link, never another scheme, credentials, or a network', () => {
    expect(checkSocialLink('website', 'ada.dev/about')).toEqual({ ok: true, value: 'https://ada.dev/about' });
    expect(checkSocialLink('website', 'http://ada.dev')).toMatchObject({ ok: true });
    for (const refused of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://ada.dev', 'mailto:ada@ada.dev']) {
      expect(checkSocialLink('website', refused), refused).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(checkSocialLink('website', 'https://ada:pw@ada.dev')).toEqual({ ok: false, reason: 'credentials' });
    // A browser resolves these to https://evil.com, but no one writes a link so: refused, never stored as typed.
    for (const odd of ['https:evil.com', 'https:\\\\evil.com', 'https:/evil.com']) {
      expect(checkSocialLink('website', odd), odd).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(checkSocialLink('website', 'https://github.com/ada')).toEqual({
      ok: false,
      reason: 'other_network',
      network: 'github',
    });
    expect(checkSocialLink('website', `https://ada.dev/${'a'.repeat(2_000)}`)).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('checks a canonical link as itself, for every network', () => {
    const typed = {
      linkedin: 'ada',
      x: 'ada',
      instagram: 'ada.l',
      github: 'ada',
      facebook: 'ada.l',
      youtube: 'adamakes',
      tiktok: 'adal',
      threads: 'ada.l',
      angellist: 'ada',
      website: 'ada.dev',
    } as const;
    for (const [network, text] of Object.entries(typed) as [keyof typeof typed, string][]) {
      const first = checkSocialLink(network, text);
      if (!first.ok) throw new Error(network);
      expect(checkSocialLink(network, first.value), network).toEqual(first);
      // The field shows the handle after its prefix, and that checks to the same link.
      const shown = socialLinkFieldValue(network, first.value);
      expect(checkSocialLink(network, shown), network).toEqual(first);
    }
  });

  it('words each refusal plainly, naming the networks', () => {
    expect(socialLinkProblem('linkedin', { reason: 'other_network', network: 'instagram' })).toBe(
      'That’s a link to Instagram, not LinkedIn.',
    );
    expect(socialLinkProblem('x', { reason: 'invalid' })).toBe(
      'That doesn’t look like your X handle. Type it like @adalovelace, or paste your profile link.',
    );
    expect(socialLinkPrefix('linkedin')).toBe('linkedin.com/in/');
    expect(socialLinkPrefix('youtube')).toBe('youtube.com/@');
    expect(socialLinkPrefix('website')).toBe('');
    expect(socialLinkFieldValue('linkedin', 'https://linkedin.com/company/acme')).toBe(
      'https://linkedin.com/company/acme',
    );
  });
});
