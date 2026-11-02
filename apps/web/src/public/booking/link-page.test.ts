// The public link page's blocks (spec 0051): each kind mapped onto the library's blocks in order, a booking page to
// its handle address, and a kind this bundle doesn't know skipped rather than breaking the page.
import { describe, expect, it } from 'vitest';
import type { PublicProfileItem } from '@crm/data/booking';
import {
  blocksOf,
  continuedNotices,
  isBannerClosed,
  keepClosedBanner,
  keepContinuedNotice,
  viewFactsOf,
  type VisitStorage,
} from './link-page.ts';

describe('blocksOf', () => {
  it('maps every kind in order, and skips one it doesn’t know', () => {
    const later = {
      kind: 'music',
      id: '00000000-0000-7000-8000-000000000009',
      title: 'My playlist',
    } as unknown as PublicProfileItem;
    const items: PublicProfileItem[] = [
      {
        kind: 'page',
        id: '00000000-0000-7000-8000-000000000001',
        slug: 'intro call',
        title: 'Intro call',
        description: '',
        durations: [15, 30],
        isTeam: true,
      },
      later,
      { kind: 'heading', id: '00000000-0000-7000-8000-000000000002', title: 'Find me' },
      {
        kind: 'link',
        id: '00000000-0000-7000-8000-000000000003',
        title: 'LinkedIn',
        url: 'https://www.linkedin.com/in/ada',
        mark: 'linkedin',
        hue: 'blue',
      },
      {
        kind: 'contact',
        id: '00000000-0000-7000-8000-000000000004',
        fullName: 'Ada Lovelace',
        jobTitle: 'Founder',
        company: 'Acme',
      },
      { kind: 'contact', id: '00000000-0000-7000-8000-000000000005', fullName: 'Ada' },
    ];
    expect(blocksOf('ada', items)).toEqual([
      {
        kind: 'page',
        id: '00000000-0000-7000-8000-000000000001',
        title: 'Intro call',
        href: '/ada/intro%20call',
        facts: '15 min · 30 min · Team',
      },
      { kind: 'heading', id: '00000000-0000-7000-8000-000000000002', title: 'Find me' },
      {
        kind: 'link',
        id: '00000000-0000-7000-8000-000000000003',
        title: 'LinkedIn',
        href: 'https://www.linkedin.com/in/ada',
        hue: 'blue',
        mark: 'linkedin',
      },
      {
        kind: 'contact',
        id: '00000000-0000-7000-8000-000000000004',
        title: 'Ada Lovelace',
        line: 'Founder · Acme',
        href: '/api/public/handles/ada/contact.vcf?card=00000000-0000-7000-8000-000000000004',
      },
      {
        kind: 'contact',
        id: '00000000-0000-7000-8000-000000000005',
        title: 'Ada',
        href: '/api/public/handles/ada/contact.vcf?card=00000000-0000-7000-8000-000000000005',
      },
    ]);
  });

  it('carries a heading’s group through, and leaves an open one without the key (AC-5415)', () => {
    const id = '00000000-0000-7000-8000-00000000000a';
    expect(blocksOf('ada', [{ kind: 'heading', id, title: 'Read', group: 'folder' }])).toEqual([
      { kind: 'heading', id, title: 'Read', group: 'folder' },
    ]);
    expect(blocksOf('ada', [{ kind: 'heading', id, title: 'Read', group: 'open' }])).toEqual([
      { kind: 'heading', id, title: 'Read', group: 'open' },
    ]);
    expect(blocksOf('ada', [{ kind: 'heading', id, title: 'Read' }])).toEqual([{ kind: 'heading', id, title: 'Read' }]);
  });
});

describe('blocksOf, the kinds spec 0061 adds', () => {
  const id = (last: string) => `00000000-0000-7000-8000-00000000000${last}`;
  const picture = { src: '/api/public/profiles/ada/images/x?v=1', width: 800, height: 600 };

  it('draws the person’s own social links as a socials block, and nothing when they have none (AC-6104)', () => {
    const socials = [{ network: 'x' as const, href: 'https://x.com/ada', label: '@ada' }];
    expect(blocksOf('ada', [{ kind: 'socials', id: id('1') }], { socials })).toEqual([
      { kind: 'socials', id: id('1'), links: socials },
    ]);
    expect(blocksOf('ada', [{ kind: 'socials', id: id('1') }])).toEqual([]);
  });

  it('hands the media block the frame the server built, and never the pasted link (AC-6106)', () => {
    expect(
      blocksOf('ada', [
        {
          kind: 'media',
          id: id('2'),
          provider: 'youtube',
          title: 'The talk',
          frame: 'https://www.youtube-nocookie.com/embed/abc',
          poster: picture,
        },
      ]),
    ).toEqual([
      {
        kind: 'media',
        id: id('2'),
        provider: 'youtube',
        title: 'The talk',
        frame: 'https://www.youtube-nocookie.com/embed/abc',
        poster: picture,
      },
    ]);
  });

  it('opens a times block’s page in this tab, with the times it has read (AC-6110)', () => {
    const times = new Map([[id('3'), { status: 'ready' as const, starts: ['2026-11-04T09:00:00.000Z'] }]]);
    expect(
      blocksOf('ada', [{ kind: 'times', id: id('3'), slug: 'intro call', title: 'Intro call', duration: 30 }], {
        times,
      }),
    ).toEqual([
      {
        kind: 'times',
        id: id('3'),
        title: 'Intro call',
        href: '/ada/intro%20call',
        duration: 30,
        times: { status: 'ready', starts: ['2026-11-04T09:00:00.000Z'] },
      },
    ]);
    // Not read yet: the block holds its place and asks for them.
    expect(blocksOf('ada', [{ kind: 'times', id: id('3'), slug: 'intro', title: 'Intro call', duration: 30 }])).toEqual(
      [{ kind: 'times', id: id('3'), title: 'Intro call', href: '/ada/intro', duration: 30 }],
    );
  });

  it('carries a link’s picture, card and notice through (AC-6101, AC-6102, AC-6113)', () => {
    expect(
      blocksOf('ada', [
        {
          kind: 'link',
          id: id('4'),
          title: 'My book',
          url: 'https://ada.dev/book',
          hue: 'blue',
          thumb: picture,
          style: 'featured',
          notice: '18',
          size: 'wide',
        },
      ]),
    ).toEqual([
      {
        kind: 'link',
        id: id('4'),
        title: 'My book',
        href: 'https://ada.dev/book',
        hue: 'blue',
        thumb: picture,
        style: 'featured',
        notice: '18',
        size: 'wide',
      },
    ]);
  });

  it('maps an image, a gallery and a banner (AC-6108, AC-6109, AC-6112)', () => {
    expect(
      blocksOf('ada', [
        { kind: 'image', id: id('5'), image: picture, alt: 'Ada at work', caption: 'At work', url: 'https://ada.dev' },
        { kind: 'gallery', id: id('6'), images: [{ ...picture, alt: 'One' }], display: 'grid' },
        { kind: 'banner', id: id('7'), text: 'Launch week', url: 'https://ada.dev/launch' },
      ]),
    ).toEqual([
      {
        kind: 'image',
        id: id('5'),
        image: picture,
        alt: 'Ada at work',
        caption: 'At work',
        href: 'https://ada.dev',
      },
      { kind: 'gallery', id: id('6'), images: [{ ...picture, alt: 'One' }], display: 'grid' },
      { kind: 'banner', id: id('7'), text: 'Launch week', href: 'https://ada.dev/launch' },
    ]);
  });
});

describe('viewFactsOf (AC-6116)', () => {
  const origin = 'https://timefix.com';

  it('sends the referring host only, never the whole address', () => {
    expect(viewFactsOf({ referrer: 'https://www.instagram.com/ada/reels/secret', search: '', origin })).toEqual({
      ref: 'www.instagram.com',
    });
  });

  it('sends nothing for our own origin, an empty referrer or one that names no web host', () => {
    expect(viewFactsOf({ referrer: 'https://timefix.com/ada', search: '', origin })).toEqual({});
    expect(viewFactsOf({ referrer: '', search: '', origin })).toEqual({});
    expect(viewFactsOf({ referrer: 'android-app://com.example', search: '', origin })).toEqual({});
    // The marketing site and the handle pages are one site: a visit from one to the other is no referral.
    expect(viewFactsOf({ referrer: 'https://www.timefix.com/pricing', search: '', origin })).toEqual({});
    expect(viewFactsOf({ referrer: 'https://timefix.com/ada', search: '', origin: 'https://www.timefix.com' })).toEqual(
      {},
    );
  });

  it('keeps a utm_source in its shape, lowercased, and drops anything else', () => {
    expect(viewFactsOf({ referrer: '', search: '?utm_source=IG_Bio', origin })).toEqual({ src: 'ig_bio' });
    expect(viewFactsOf({ referrer: '', search: '?utm_source=a b', origin })).toEqual({});
    expect(viewFactsOf({ referrer: '', search: `?utm_source=${'a'.repeat(61)}`, origin })).toEqual({});
    expect(viewFactsOf({ referrer: '', search: '?utm_medium=social', origin })).toEqual({});
  });
});

describe('the tab’s session (AC-6127)', () => {
  const store = (): VisitStorage & { readonly kept: Map<string, string> } => {
    const kept = new Map<string, string>();
    return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value) };
  };

  it('keeps a closed banner and the continued notices, and nothing else', () => {
    const storage = store();
    expect(isBannerClosed(storage, 'b1')).toBe(false);
    keepClosedBanner(storage, 'b1');
    expect(isBannerClosed(storage, 'b1')).toBe(true);
    expect(isBannerClosed(storage, 'b2')).toBe(false);
    expect(keepContinuedNotice(storage, 'ada', 'n1')).toEqual(['n1']);
    expect(keepContinuedNotice(storage, 'ada', 'n2')).toEqual(['n1', 'n2']);
    expect(continuedNotices(storage, 'ada')).toEqual(['n1', 'n2']);
    expect([...storage.kept.keys()]).toEqual(['crm.banner.b1', 'crm.notice.ada']);
  });

  it('keeps nothing, and never throws, where storage refuses', () => {
    const refusing: VisitStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(isBannerClosed(refusing, 'b1')).toBe(false);
    expect(continuedNotices(refusing, 'ada')).toEqual([]);
    expect(keepContinuedNotice(refusing, 'ada', 'n1')).toEqual(['n1']);
    expect(isBannerClosed(undefined, 'b1')).toBe(false);
  });
});
