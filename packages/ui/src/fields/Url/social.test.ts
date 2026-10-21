import { describe, expect, it } from 'vitest';
import { checkLink, checkSocial, describeLink, networkOfAttribute } from './social.ts';

const ok = (value: string) => ({ ok: true, value });
const person = { label: 'X', kind: 'person' } as const;
const company = { label: 'LinkedIn', kind: 'company' } as const;

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
    expect(checkSocial('x', '@adalovelace', person)).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocial('x', 'adalovelace', person)).toEqual(ok('https://x.com/adalovelace'));
    expect(checkSocial('linkedin', 'ada-lovelace', person)).toEqual(ok('https://linkedin.com/in/ada-lovelace'));
    expect(checkSocial('instagram', 'ada.lovelace', person)).toEqual(ok('https://instagram.com/ada.lovelace'));
    expect(checkSocial('github', 'octocat', person)).toEqual(ok('https://github.com/octocat'));
    expect(checkSocial('youtube', '@adalovelace', person)).toEqual(ok('https://youtube.com/@adalovelace'));
    expect(checkSocial('tiktok', 'ada', person)).toEqual(ok('https://tiktok.com/@ada'));
    expect(checkSocial('angellist', 'ada', person)).toEqual(ok('https://wellfound.com/u/ada'));
    expect(checkSocial('threads', '@ada', person)).toEqual(ok('https://threads.com/@ada'));
    expect(checkSocial('facebook', 'ada.lovelace', person)).toEqual(ok('https://facebook.com/ada.lovelace'));
  });

  it('takes a LinkedIn company page as company/handle, and a bare handle on a company as its page', () => {
    expect(checkSocial('linkedin', 'company/acme', person)).toEqual(ok('https://linkedin.com/company/acme'));
    expect(checkSocial('linkedin', 'acme', company)).toEqual(ok('https://linkedin.com/company/acme'));
    expect(checkSocial('angellist', 'acme', company)).toEqual(ok('https://wellfound.com/company/acme'));
    expect(checkSocial('x', 'acme', company)).toEqual(ok('https://x.com/acme'));
    expect(checkSocial('linkedin', 'in/ada', company)).toEqual(ok('https://linkedin.com/in/ada'));
  });

  it('refuses a link to another network, and the network on its own', () => {
    expect(checkSocial('linkedin', 'https://x.com/ada', company)).toEqual({
      ok: false,
      message: 'That is a link to X. Enter a handle on LinkedIn, or a link to the profile.',
    });
    expect(checkSocial('facebook', 'facebook.com', person)).toMatchObject({ ok: false });
    expect(checkSocial('facebook', 'https://www.facebook.com/', person)).toMatchObject({ ok: false });
  });

  it('normalises a profile link: own host, no www, no trailing slash or tracking', () => {
    expect(checkSocial('linkedin', 'https://www.linkedin.com/in/ada-lovelace/?utm_source=share', person)).toEqual(
      ok('https://linkedin.com/in/ada-lovelace'),
    );
    expect(checkSocial('linkedin', 'uk.linkedin.com/in/ada', person)).toEqual(ok('https://linkedin.com/in/ada'));
    expect(checkSocial('x', 'https://twitter.com/AdaLovelace?s=20', person)).toEqual(ok('https://x.com/AdaLovelace'));
    expect(checkSocial('instagram', 'instagram.com/ada.lovelace/', person)).toEqual(
      ok('https://instagram.com/ada.lovelace'),
    );
    expect(checkSocial('angellist', 'https://angel.co/u/ada', person)).toEqual(ok('https://wellfound.com/u/ada'));
  });

  it('keeps a link that is not a profile as it was typed, checked', () => {
    expect(checkSocial('x', 'https://x.com/ada/status/1', person)).toEqual(ok('https://x.com/ada/status/1'));
    expect(checkSocial('linkedin', 'linktr.ee/ada', person)).toEqual(ok('https://linktr.ee/ada'));
    expect(checkSocial('facebook', 'facebook.com/profile.php?id=4', person)).toEqual(
      ok('https://facebook.com/profile.php?id=4'),
    );
  });

  it('refuses a handle the network would not take, saying what to type', () => {
    expect(checkSocial('x', 'ada lovelace', person)).toEqual({
      ok: false,
      message: 'Enter a handle on X, such as @adalovelace, or a link to the profile.',
    });
    expect(checkSocial('github', '-bad-', person)).toMatchObject({ ok: false });
    expect(checkSocial('linkedin', 'http://', person)).toMatchObject({ ok: false });
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

  it('shows a network link that is not a profile as its domain and path, with the mark', () => {
    expect(describeLink('https://www.facebook.com/profile.php?id=4')).toEqual({
      label: 'facebook.com/profile.php',
      network: 'facebook',
    });
  });

  it('shows any other link as its domain and path, without www, query or trailing slash', () => {
    expect(describeLink('https://www.northwind.com/pricing/?ref=1')).toEqual({ label: 'northwind.com/pricing' });
    expect(describeLink('https://northwind.com/')).toEqual({ label: 'northwind.com' });
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
