// The link page editor's registry (spec 0051): how a block's row reads, what the phone draws of it, and the kinds the
// Add menu offers.
import { describe, expect, it } from 'vitest';
import type { ProfileItem } from '@crm/data';
import { ADDABLE, BLOCK_KINDS, figuresLine, pageFacts, pressesChip, previewBlock, rowWords } from './registry.tsx';

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
    expect(ADDABLE).toEqual(['link', 'page', 'text', 'faq', 'contact', 'heading']);
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
  });

  it('reads and draws the blocks that are words, not rows: writing and the questions (spec 0052)', () => {
    const written: ProfileItem = { kind: 'text', id: 't', title: 'About', body: 'One\nTwo', updatedAt: '' };
    // The row says what it is and shows the first line, since there is no address to show.
    expect(rowWords(written)).toEqual({ title: 'About', address: 'One' });
    expect(rowWords({ ...written, title: undefined })).toEqual({ title: 'Writing', address: 'One' });
    expect(previewBlock(written, 'ada', () => undefined)).toEqual({
      kind: 'text',
      id: 't',
      title: 'About',
      body: 'One\nTwo',
    });

    const asked: ProfileItem = {
      kind: 'faq',
      id: 'f',
      items: [
        { question: 'Do you travel?', answer: 'Yes.' },
        { question: 'How far ahead?', answer: 'A week.' },
      ],
      updatedAt: '',
    };
    expect(rowWords(asked)).toEqual({ title: 'Questions', address: '2 questions' });
    expect(rowWords({ ...asked, title: 'Before you book' }).title).toBe('Before you book');
    expect(rowWords({ ...asked, items: asked.items.slice(0, 1) }).address).toBe('1 question');
    expect(previewBlock(asked, 'ada', () => undefined)).toEqual({ kind: 'faq', id: 'f', items: asked.items });
  });

  it('says the page’s figures and each block’s presses in plain words', () => {
    const counts = (views: number, visitors: number, before: number) => ({
      days: 30,
      views,
      visitors,
      before: { views: before, visitors: before },
      presses: [{ id: 'l', presses: 3 }],
    });
    const nb = (text: string) => text.replace(/\u00a0/g, ' ');
    expect(nb(figuresLine(counts(0, 0, 0)))).toBe('No views yet in the last 30 days.');
    expect(nb(figuresLine(counts(0, 0, 5)))).toBe('No views in the last 30 days, down from 5 in the 30 days before.');
    expect(nb(figuresLine(counts(1, 1, 0)))).toBe('1 view from 1 visitor in the last 30 days.');
    expect(nb(figuresLine(counts(1500, 90, 100)))).toBe(
      '1,500 views from 90 visitors in the last 30 days, up from 100 in the 30 days before.',
    );
    expect(nb(figuresLine(counts(50, 40, 100)))).toBe(
      '50 views from 40 visitors in the last 30 days, down from 100 in the 30 days before.',
    );
    expect(nb(figuresLine(counts(100, 40, 100)))).toBe(
      '100 views from 40 visitors in the last 30 days, the same as the 30 days before.',
    );
    // A number never parts from its word.
    expect(figuresLine(counts(2, 1, 0))).toContain('2\u00a0views');
    const link: ProfileItem = {
      kind: 'link',
      id: 'l',
      title: 'Site',
      url: 'https://ada.dev',
      hue: 'blue',
      updatedAt: '',
    };
    expect(pressesChip(link, counts(1, 1, 0))).toEqual(['3\u00a0clicks']);
    expect(pressesChip({ ...link, id: 'other' }, counts(1, 1, 0))).toEqual(['No clicks yet']);
    expect(pressesChip({ kind: 'heading', id: 'h', title: 'H', updatedAt: '' }, counts(1, 1, 0))).toEqual([]);
    // Neither writing nor a set of questions has anywhere to go, so neither shows a chip (AC-5207, AC-5211).
    expect(pressesChip({ kind: 'text', id: 't', body: 'Words', updatedAt: '' }, counts(1, 1, 0))).toEqual([]);
    expect(
      pressesChip({ kind: 'faq', id: 'f', items: [{ question: 'Q', answer: 'A' }], updatedAt: '' }, counts(1, 1, 0)),
    ).toEqual([]);
    expect(pressesChip(link, undefined)).toEqual([]);
  });
});
