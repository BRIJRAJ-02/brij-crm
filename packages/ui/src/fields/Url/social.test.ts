import { describe, expect, it } from 'vitest';
import { checkLink, checkSocial, describeLink, networkOfAttribute } from './social.ts';

const ok = (value: string) => ({ ok: true, value });

describe('checkLink', () => {
  it('takes a bare domain and adds https', () => {
    expect(checkLink('Example.com/Pricing')).toEqual(ok('https://example.com/Pricing'));
    expect(checkLink('  northwind.com ')).toEqual(ok('https://northwind.com'));
  });

  it('keeps a full link and refuses what is not a web address, in plain words', () => {
    expect(checkLink('http://example.com/a?b=1')).toEqual(ok('http://example.com/a?b=1'));
    expect(checkLink('not a link')).toEqual({
      ok: false,
      message: 'Enter a web address, such as example.com or https://example.com/about.',
    });
    expect(checkLink('ftp://example.com')).toMatchObject({ ok: false });
    expect(checkLink(`example.com/${'a'.repeat(2_100)}`)).toEqual({
      ok: false,
      message: 'A link has at most 2,048 characters.',
    });
  });
});

describe('checkSocial', () => {
  it('turns a handle, with or without @, into the profile link', () => {
    expect(checkSocial('x', '@adalovelace')).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocial('x', 'adalovelace')).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocial('linkedin', 'ada-lovelace')).toEqual(ok('https://linkedin.com/in/ada-lovelace'));
    expect(checkSocial('instagram', 'ada.lovelace')).toEqual(ok('https://instagram.com/ada.lovelace'));
    expect(checkSocial('github', 'octocat')).toEqual(ok('https://github.com/octocat'));
    expect(checkSocial('youtube', '@adalovelace')).toEqual(ok('https://youtube.com/@adalovelace'));
    expect(checkSocial('tiktok', 'ada')).toEqual(ok('https://tiktok.com/@ada'));
    expect(checkSocial('angellist', 'ada')).toEqual(ok('https://wellfound.com/u/ada'));
    expect(checkSocial('threads', '@ada')).toEqual(ok('https://threads.com/@ada'));
    expect(checkSocial('facebook', 'ada.lovelace')).toEqual(ok('https://facebook.com/ada.lovelace'));
  });

  it('takes a LinkedIn company page as company/handle', () => {
    expect(checkSocial('linkedin', 'company/acme')).toEqual(ok('https://linkedin.com/company/acme'));
  });

  it('normalises a profile link: own host, no www, no trailing slash or tracking', () => {
    expect(checkSocial('linkedin', 'https://www.linkedin.com/in/ada-lovelace/?utm_source=share')).toEqual(
      ok('https://linkedin.com/in/ada-lovelace'),
    );
    expect(checkSocial('linkedin', 'uk.linkedin.com/in/ada')).toEqual(ok('https://linkedin.com/in/ada'));
    expect(checkSocial('x', 'https://twitter.com/AdaLovelace?s=20')).toEqual(ok('https://x.com/AdaLovelace'));
    expect(checkSocial('instagram', 'instagram.com/ada.lovelace/')).toEqual(ok('https://instagram.com/ada.lovelace'));
    expect(checkSocial('angellist', 'https://angel.co/u/ada')).toEqual(ok('https://wellfound.com/u/ada'));
  });

  it('keeps a link that is not a profile as it was typed, checked', () => {
    expect(checkSocial('x', 'https://x.com/ada/status/1')).toEqual(ok('https://x.com/ada/status/1'));
    expect(checkSocial('linkedin', 'linktr.ee/ada')).toEqual(ok('https://linktr.ee/ada'));
    expect(checkSocial('facebook', 'facebook.com/profile.php?id=4')).toEqual(
      ok('https://facebook.com/profile.php?id=4'),
    );
  });

  it('refuses a handle the network would not take, saying what to type', () => {
    expect(checkSocial('x', 'ada lovelace')).toEqual({
      ok: false,
      message: 'Enter a handle on X, such as @adalovelace, or a link to the profile.',
    });
    expect(checkSocial('github', '-bad-')).toMatchObject({ ok: false });
    expect(checkSocial('linkedin', 'http://')).toMatchObject({ ok: false });
  });
});

describe('describeLink', () => {
  it('shows a profile as the handle with its network', () => {
    expect(describeLink('https://x.com/adalovelace')).toEqual({ label: '@adalovelace', network: 'x' });
    expect(describeLink('https://www.linkedin.com/in/ada-lovelace')).toEqual({
      label: 'ada-lovelace',
      network: 'linkedin',
    });
    expect(describeLink('https://linkedin.com/company/acme')).toEqual({ label: 'acme', network: 'linkedin' });
    expect(describeLink('https://github.com/octocat')).toEqual({ label: 'octocat', network: 'github' });
    expect(describeLink('https://youtube.com/@ada')).toEqual({ label: '@ada', network: 'youtube' });
    expect(describeLink('https://youtube.com/c/AdaTalks')).toEqual({ label: '@AdaTalks', network: 'youtube' });
    expect(describeLink('https://linkedin.com/in/ren%C3%A9')).toEqual({ label: 'rené', network: 'linkedin' });
  });

  it('shows a network link that is not a profile as the domain, with the mark', () => {
    expect(describeLink('https://www.facebook.com/profile.php?id=4')).toEqual({
      label: 'facebook.com',
      network: 'facebook',
    });
  });

  it('shows any other link as its domain, without www', () => {
    expect(describeLink('https://www.northwind.com/pricing')).toEqual({ label: 'northwind.com' });
    expect(describeLink('not a url')).toEqual({ label: 'not a url' });
  });
});

describe('networkOfAttribute', () => {
  it('reads the network from the attribute API name', () => {
    expect(networkOfAttribute({ apiSlug: 'twitter' })).toBe('x');
    expect(networkOfAttribute({ apiSlug: 'linkedin' })).toBe('linkedin');
    expect(networkOfAttribute({ apiSlug: 'website' })).toBeUndefined();
    expect(networkOfAttribute({})).toBeUndefined();
  });
});
