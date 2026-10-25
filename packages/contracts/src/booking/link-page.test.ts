// The link page's rules (spec 0051): the one address check (AC-5103) and the network marks (AC-5110), which must
// answer exactly what `values/social.ts` answers for the url field.
import { describe, expect, it } from 'vitest';
import { describeLink, SOCIAL_NETWORKS } from '../values/social.ts';
import { checkContactCard, checkProfileLink, linkMarkOf, PUBLIC_LINK_MARKS } from './link-page-rules.ts';
import { ProfileBlock } from './link-page.ts';

describe('checkProfileLink', () => {
  it('keeps the schemes the spec allows, and puts https before a bare address', () => {
    expect(checkProfileLink(' www.timefix.com ')).toEqual({ ok: true, url: 'https://www.timefix.com' });
    expect(checkProfileLink('example.com:8080/path')).toEqual({ ok: true, url: 'https://example.com:8080/path' });
    for (const url of [
      'https://ada.dev/a?b=c#d',
      'http://ada.dev',
      'mailto:ada@ada.dev',
      'tel:+441234',
      'sms:+441234',
    ]) {
      expect(checkProfileLink(url)).toEqual({ ok: true, url });
    }
    expect(checkProfileLink('HTTPS://Ada.dev/Path')).toMatchObject({ ok: true });
  });

  it('turns an email or a phone number typed on its own into its link, and takes spaces out', () => {
    expect(checkProfileLink('anish@timefix.com')).toEqual({ ok: true, url: 'mailto:anish@timefix.com' });
    expect(checkProfileLink('+91 99999 99999')).toEqual({ ok: true, url: 'tel:+919999999999' });
    expect(checkProfileLink('(020) 7946-0958')).toEqual({ ok: true, url: 'tel:02079460958' });
    expect(checkProfileLink('tel:+44 20 7946 0958')).toEqual({ ok: true, url: 'tel:+442079460958' });
    expect(checkProfileLink('sms:+1 555 0100?body=Hi there')).toEqual({
      ok: true,
      url: 'sms:+15550100?body=Hi%20there',
    });
    expect(checkProfileLink('mailto:a@b.com?subject=Hi there')).toEqual({
      ok: true,
      url: 'mailto:a@b.com?subject=Hi%20there',
    });
    expect(checkProfileLink('https://example.com/my page')).toEqual({ ok: true, url: 'https://example.com/my%20page' });
    expect(checkProfileLink('https://evil.com\\@good.com')).toEqual({ ok: true, url: 'https://evil.com/@good.com' });
  });

  it('answers only what the database’s own check stores (crm_check_profile_item)', () => {
    // The definer's pattern, as written in migration 0098, and its refusal of whitespace and control characters.
    const stored = /^(https?:\/\/[^/?#@]+([/?#].*)?|mailto:.+|tel:.+|sms:.+)$/i;
    for (const typed of [
      'a b.com',
      'https://a.com# x',
      'tel:+1 555 0100',
      'mailto:a b@c.com',
      'https://evil.com\\@good.com',
      'https://a.com/\u00a0x',
      'sms:hello',
      'https://ex ample.com',
      '+1',
      'ada@ada.dev',
    ]) {
      const checked = checkProfileLink(typed);
      if (checked.ok) {
        expect(stored.test(checked.url), typed).toBe(true);
        expect(/[\s]/.test(checked.url), typed).toBe(false);
      }
    }
  });

  it('refuses every other scheme, credentials, control characters, a word and a long address', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,hi',
      'vbscript:x',
      'file:///etc/passwd',
      'ftp://ada.dev',
      'https://user:pass@ada.dev',
      'https://ada.dev\tx',
      'java\tscript:alert(1)',
      'intro',
      'https://localhost',
      'mailto:',
    ]) {
      expect(checkProfileLink(url), url).toMatchObject({ ok: false });
    }
    expect(checkProfileLink('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkProfileLink(`https://ada.dev/${'a'.repeat(2_000)}`)).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('linkMarkOf', () => {
  it('names the same network as the url field for every host it knows', () => {
    expect([...PUBLIC_LINK_MARKS].sort()).toEqual([...SOCIAL_NETWORKS].sort());
    for (const url of [
      'https://www.linkedin.com/in/ada',
      'https://uk.linkedin.com/in/ada',
      'https://twitter.com/ada',
      'https://x.com/ada/status/1',
      'https://m.facebook.com/ada',
      'https://fb.com/ada',
      'https://www.youtube.com/@ada',
      'https://wellfound.com/u/ada',
      'https://angel.co/ada',
      'https://www.tiktok.com/@ada',
      'https://www.threads.net/@ada',
      'https://github.com/ada',
      'https://instagram.com/ada',
      'https://ada.dev',
      'https://notlinkedin.com/in/ada',
    ]) {
      expect(linkMarkOf(url), url).toBe(describeLink(url).network);
    }
    expect(linkMarkOf('mailto:ada@linkedin.com')).toBeUndefined();
  });
});

describe('ProfileBlock', () => {
  it('checks each kind’s fields and makes a link canonical', () => {
    expect(ProfileBlock.parse({ kind: 'link', title: ' Site ', url: 'ada.dev' })).toEqual({
      kind: 'link',
      title: 'Site',
      url: 'https://ada.dev',
    });
    expect(ProfileBlock.safeParse({ kind: 'heading', title: 'x'.repeat(41) }).success).toBe(false);
    expect(ProfileBlock.safeParse({ kind: 'link', title: 'A', url: 'https://a.dev', icon: 'bomb' }).success).toBe(
      false,
    );
    expect(ProfileBlock.parse({ kind: 'contact', fullName: ' Ada ', website: 'ada.dev' })).toEqual({
      kind: 'contact',
      fullName: 'Ada',
      website: 'https://ada.dev',
    });
    for (const card of [
      { fullName: '' },
      { fullName: 'Ada', email: 'ada' },
      { fullName: 'Ada', phone: '12' },
      { fullName: 'Ada', phone: '+1 (555) 0100 ext' },
      { fullName: 'Ada', website: 'mailto:ada@ada.dev' },
      { fullName: 'Ada', jobTitle: '' },
      { fullName: 'Ada', note: 'two\nlines' },
      { fullName: 'x'.repeat(81) },
    ]) {
      expect(ProfileBlock.safeParse({ kind: 'contact', ...card }).success, JSON.stringify(card)).toBe(false);
    }
    expect(ProfileBlock.safeParse({ kind: 'link', title: 'Two\nlines', url: 'https://a.dev' }).success).toBe(false);
  });

  it('keeps a piece of writing’s line breaks and refuses everything else (spec 0052)', () => {
    // A Windows paste is one break a line, not two, and the body is trimmed at its ends only.
    expect(ProfileBlock.parse({ kind: 'text', title: ' About ', body: ' One\r\nTwo  ' })).toEqual({
      kind: 'text',
      title: 'About',
      body: 'One\nTwo',
    });
    // No title at all is the ordinary case: the words stand on their own.
    expect(ProfileBlock.parse({ kind: 'text', body: 'Just words' })).toEqual({ kind: 'text', body: 'Just words' });
    for (const written of [
      { body: '' },
      { body: '   ' },
      { body: 'x'.repeat(1001) },
      { body: Array.from({ length: 22 }, () => 'line').join('\n') },
      { body: 'Tab\there' },
      { body: 'Split\u2028here' },
      { title: 'x'.repeat(61), body: 'Fine' },
      { title: 'Two\nlines', body: 'Fine' },
    ]) {
      expect(ProfileBlock.safeParse({ kind: 'text', ...written }).success, JSON.stringify(written)).toBe(false);
    }
    // Twenty breaks is the limit, and exactly twenty passes.
    expect(
      ProfileBlock.safeParse({ kind: 'text', body: Array.from({ length: 21 }, () => 'line').join('\n') }).success,
    ).toBe(true);
  });
});

describe('checkContactCard', () => {
  it('keeps what was given, trimmed and canonical, and says each field’s problem', () => {
    expect(
      checkContactCard({ fullName: ' Ada ', phone: '+44 (20) 7946-0958', email: 'ada@acme.dev', company: ' ' }),
    ).toEqual({ ok: true, card: { fullName: 'Ada', phone: '+44 (20) 7946-0958', email: 'ada@acme.dev' } });
    expect(checkContactCard({ fullName: 'Ada', jobTitle: 'x'.repeat(121) })).toEqual({
      ok: false,
      problems: { jobTitle: 'Keep the job title to 120 characters.' },
    });
  });

  it('answers only what the database’s check accepts', () => {
    for (const typed of ['ada@acme.dev', 'a.b+c@x.co', 'ada@acme', 'ada @acme.dev', 'ada@@acme.dev']) {
      const checked = checkContactCard({ fullName: 'Ada', email: typed });
      expect(checked.ok, typed).toBe(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed));
    }
    for (const typed of ['+1 555 0100', '(020) 7946 0958', '12', '+', 'x123', '1'.repeat(21)]) {
      const checked = checkContactCard({ fullName: 'Ada', phone: typed });
      const digits = typed.replace(/\D/g, '').length;
      expect(checked.ok, typed).toBe(/^\+?[0-9 ().-]+$/.test(typed) && digits >= 3 && digits <= 20);
    }
    const site = checkContactCard({ fullName: 'Ada', website: 'acme.dev/about us' });
    expect(site.ok && site.card.website).toBe('https://acme.dev/about%20us');
  });
});
