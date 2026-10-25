// The public link page's blocks (spec 0051): each kind mapped onto the library's blocks in order, a booking page to
// its handle address, and a kind this bundle doesn't know skipped rather than breaking the page.
import { describe, expect, it } from 'vitest';
import type { PublicProfileItem } from '@crm/data/booking';
import { blocksOf } from './link-page.ts';

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
        href: '/api/public/handles/ada/contact.vcf',
      },
      {
        kind: 'contact',
        id: '00000000-0000-7000-8000-000000000005',
        title: 'Ada',
        href: '/api/public/handles/ada/contact.vcf',
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
