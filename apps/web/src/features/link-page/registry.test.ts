// The link page editor's registry (spec 0051): how a block's row reads, what the phone draws of it, and the kinds the
// Add menu offers.
import { describe, expect, it } from 'vitest';
import type { ProfileItem } from '@crm/data';
import { ADDABLE, BLOCK_KINDS, contactTitle, pageFacts, previewBlock, rowWords } from './registry.tsx';

const page = (status: 'live' | 'paused'): ProfileItem => ({
  kind: 'page',
  id: 'p',
  workspaceId: 'w',
  pageId: 'x',
  updatedAt: '',
  page: {
    title: 'Intro',
    slug: 'intro',
    durations: [30],
    isTeam: false,
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    status,
  },
});

describe('the block registry', () => {
  it('offers every kind it has an editor for, in the Add menu’s order', () => {
    expect(ADDABLE).toEqual(['page', 'link', 'contact', 'heading']);
    expect(ADDABLE.every((kind) => BLOCK_KINDS[kind].label !== '')).toBe(true);
  });

  it('reads a row by its kind, naming the workspace only when asked', () => {
    expect(
      rowWords({ kind: 'link', id: 'l', title: 'Site', url: 'https://ada.dev/', hue: 'blue', updatedAt: '' }),
    ).toEqual({
      title: 'Site',
      address: 'ada.dev',
    });
    expect(rowWords(page('live'))).toEqual({ title: 'Intro', address: 'Booking page · 30 min' });
    expect(rowWords(page('live'), true).address).toBe('Booking page · Acme · 30 min');
    expect(rowWords(page('paused'))).toMatchObject({
      isOff: true,
      address: 'Paused, hidden from visitors · Booking page · 30 min',
    });
    expect(rowWords({ kind: 'page', id: 'p', workspaceId: 'w', pageId: 'x', updatedAt: '' })).toEqual({
      title: 'Booking page',
      address: 'Unavailable, hidden from visitors · Link only, deleted, or in a workspace you left',
      isOff: true,
    });
  });

  it('draws in the phone only what a visitor sees', () => {
    const markOf = (url: string) => (url.includes('linkedin') ? ('linkedin' as const) : undefined);
    expect(previewBlock(page('live'), 'ada', markOf)).toMatchObject({
      kind: 'page',
      href: '/ada/intro',
      facts: '30 min',
    });
    expect(previewBlock(page('paused'), 'ada', markOf)).toBeUndefined();
    expect(
      previewBlock(
        { kind: 'link', id: 'l', title: 'In', url: 'https://linkedin.com/in/a', hue: 'red', updatedAt: '' },
        'ada',
        markOf,
      ),
    ).toMatchObject({ mark: 'linkedin', hue: 'red' });
    expect(pageFacts({ durations: [15, 30], isTeam: true })).toBe('15 min · 30 min · Team');
  });

  it('reads and draws the contact card: its name, its line, and Save contact to its vCard', () => {
    const card: ProfileItem = {
      kind: 'contact',
      id: 'c',
      fullName: 'Ada Lovelace',
      jobTitle: 'Founder',
      company: 'Acme',
      email: 'ada@acme.dev',
      updatedAt: '',
    };
    expect(rowWords(card)).toEqual({ title: 'Ada Lovelace', address: 'Contact card · Founder · Acme' });
    expect(previewBlock(card, 'ada lovelace', () => undefined)).toEqual({
      kind: 'contact',
      id: 'c',
      title: 'Ada Lovelace',
      line: 'Founder · Acme',
      href: '/api/public/handles/ada%20lovelace/contact.vcf',
    });
    const bare: ProfileItem = { kind: 'contact', id: 'd', fullName: 'Ada', updatedAt: '' };
    expect(rowWords(bare).address).toBe('Contact card');
    expect(previewBlock(bare, 'ada', () => undefined)).not.toHaveProperty('line');
    // The page's own person's card is titled "Contact card": the page says their name over it already.
    expect(previewBlock(card, 'ada', () => undefined, ' ada lovelace ')).toMatchObject({ title: 'Contact card' });
    expect(contactTitle('Ada  Lovelace', 'Grace Hopper')).toBe('Ada  Lovelace');
  });
});
