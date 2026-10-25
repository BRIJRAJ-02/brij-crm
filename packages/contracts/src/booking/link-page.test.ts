// The link page's rules (spec 0051): the one address check (AC-5103) and the network marks (AC-5110), which must
// answer exactly what `values/social.ts` answers for the url field.
import { describe, expect, it } from 'vitest';
import { describeLink, SOCIAL_NETWORKS } from '../values/social.ts';
import {
  checkContactCard,
  checkProfileLink,
  headingGroupOf,
  linkMarkOf,
  PUBLIC_LINK_MARKS,
} from './link-page-rules.ts';
import { ProfileBlock, PublicProfileItem } from './link-page.ts';

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
    // A testimonial keeps its line breaks and drops an empty role, as writing drops an empty title (AC-5219).
    expect(ProfileBlock.parse({ kind: 'testimonial', quote: ' It books itself. ', author: ' Sam ' })).toEqual({
      kind: 'testimonial',
      quote: 'It books itself.',
      author: 'Sam',
    });
    expect(ProfileBlock.safeParse({ kind: 'testimonial', quote: 'x'.repeat(401), author: 'Sam' }).success).toBe(false);
    expect(ProfileBlock.safeParse({ kind: 'testimonial', quote: 'Good.', author: '' }).success).toBe(false);
    expect(ProfileBlock.safeParse({ kind: 'testimonial', quote: `a${'\n'.repeat(7)}b`, author: 'Sam' }).success).toBe(
      false,
    );
    // A heading's group is one of two words, and absent is the open heading the page already drew (AC-5415).
    expect(ProfileBlock.parse({ kind: 'heading', title: 'Find me' })).toEqual({ kind: 'heading', title: 'Find me' });
    expect(ProfileBlock.parse({ kind: 'heading', title: 'Find me', group: 'folder' })).toEqual({
      kind: 'heading',
      title: 'Find me',
      group: 'folder',
    });
    expect(ProfileBlock.safeParse({ kind: 'heading', title: 'Find me', group: 'tabs' }).success).toBe(false);
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

  // Three of each way to reach the person (26 October 2026). Every rule is the kind's, read off the key's own
  // word, so `email3` can never be held to less than `email` is.
  it('takes three emails, phones and websites, and holds each to its first one’s rule', () => {
    expect(
      ProfileBlock.parse({
        kind: 'contact',
        fullName: 'Ada',
        email: 'ada@work.com',
        email3: 'ada@notes.dev',
        phone2: '+1 (555) 0100',
        website2: 'notes.ada.dev',
      }),
    ).toEqual({
      kind: 'contact',
      fullName: 'Ada',
      email: 'ada@work.com',
      email3: 'ada@notes.dev',
      phone2: '+1 (555) 0100',
      // A second website is made canonical exactly as the first is.
      website2: 'https://notes.ada.dev',
    });
    for (const card of [
      { fullName: 'Ada', email2: 'ada' },
      { fullName: 'Ada', phone3: '12' },
      { fullName: 'Ada', website3: 'mailto:ada@ada.dev' },
      { fullName: 'Ada', email2: '' },
      { fullName: 'Ada', email3: `${'x'.repeat(116)}@b.co` },
      // The same address twice is one address listed twice, however it was typed.
      { fullName: 'Ada', email: 'ada@work.com', email2: 'ADA@work.com' },
      { fullName: 'Ada', phone: '+1 555 0100', phone2: '+1 (555) 0100' },
      { fullName: 'Ada', website: 'ada.dev', website3: 'https://ada.dev' },
    ]) {
      expect(ProfileBlock.safeParse({ kind: 'contact', ...card }).success, JSON.stringify(card)).toBe(false);
    }
    // A fourth of a kind is not a key the card has: the schema drops it, and the database refuses to store a row
    // carrying one at all (`allowed`, migration 0111), so neither can ever reach a vCard.
    expect(ProfileBlock.parse({ kind: 'contact', fullName: 'Ada', email4: 'ada@four.com' })).toEqual({
      kind: 'contact',
      fullName: 'Ada',
    });
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

  it('keeps a set of questions and refuses the same one twice (spec 0052)', () => {
    expect(
      ProfileBlock.parse({
        kind: 'faq',
        items: [{ question: ' Where are you? ', answer: ' Upstairs.\r\nRing the bell. ' }],
      }),
    ).toEqual({ kind: 'faq', items: [{ question: 'Where are you?', answer: 'Upstairs.\nRing the bell.' }] });

    const asked = (question: string) => ({ question, answer: 'Yes.' });
    // The same question twice, however it was typed, is one question asked twice.
    expect(
      ProfileBlock.safeParse({ kind: 'faq', items: [asked('Do you travel?'), asked(' do you TRAVEL? ')] }).success,
    ).toBe(false);
    // Two different questions are two questions.
    expect(
      ProfileBlock.safeParse({ kind: 'faq', items: [asked('Do you travel?'), asked('Do you deliver?')] }).success,
    ).toBe(true);

    for (const items of [
      [],
      Array.from({ length: 11 }, (_, at) => asked(`Question ${String(at)}`)),
      [asked('')],
      [asked('x'.repeat(121))],
      [{ question: 'Two\nlines?', answer: 'Yes.' }],
      [{ question: 'How long?', answer: '' }],
      [{ question: 'How long?', answer: 'x'.repeat(601) }],
      [{ question: 'How long?', answer: Array.from({ length: 12 }, () => 'line').join('\n') }],
      [{ question: 'How long?', answer: 'Tab\there' }],
    ]) {
      expect(ProfileBlock.safeParse({ kind: 'faq', items }).success, JSON.stringify(items)).toBe(false);
    }
    // Ten questions is the limit, and exactly ten passes.
    expect(
      ProfileBlock.safeParse({
        kind: 'faq',
        items: Array.from({ length: 10 }, (_, at) => asked(`Question ${String(at)}`)),
      }).success,
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

describe('a heading’s group as a visitor’s bundle reads it', () => {
  it('draws a group it does not know open, so an older bundle never breaks on a newer page (AC-5415)', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(PublicProfileItem.parse({ kind: 'heading', id, title: 'Find me', group: 'folder' })).toEqual({
      kind: 'heading',
      id,
      title: 'Find me',
      group: 'folder',
    });
    // A word a later build adds reads as the open heading every build already draws, rather than failing the page.
    expect(PublicProfileItem.parse({ kind: 'heading', id, title: 'Find me', group: 'tabs' })).toEqual({
      kind: 'heading',
      id,
      title: 'Find me',
      group: 'open',
    });
    // Absent stays absent: a heading stored before folders is not rewritten on its way out.
    expect(PublicProfileItem.parse({ kind: 'heading', id, title: 'Find me' })).toEqual({
      kind: 'heading',
      id,
      title: 'Find me',
    });
  });

  it('reads any other word as open, the one rule the server and the page share', () => {
    expect(headingGroupOf('folder')).toBe('folder');
    expect(headingGroupOf('open')).toBe('open');
    expect(headingGroupOf('tabs')).toBe('open');
    expect(headingGroupOf(undefined)).toBe('open');
  });
});
