// The Timefix links' one builder: every surface's link carries the same four tags, and nothing personal rides in it.
import { describe, expect, it } from 'vitest';
import {
  POWERED_BY_EMAILS,
  POWERED_BY_PAGES,
  POWERED_BY_PLACEMENTS,
  POWERED_BY_SURFACES,
  timefixUrl,
  type PoweredByPlacement,
  type PoweredBySurface,
} from './brand.ts';

/** A link's query, read back as a plain object. */
const tagsOf = (href: string) => Object.fromEntries(new URL(href).searchParams);

describe('timefixUrl', () => {
  it('writes the four tags in a fixed order, as the emails always have', () => {
    expect(timefixUrl({ surface: 'email_booking' })).toBe(
      'https://timefix.ai/?utm_source=timefix&utm_medium=email_booking&utm_campaign=powered_by&utm_content=footer_logo',
    );
  });

  it.each(POWERED_BY_PAGES)('tags the %s footer wordmark and its claim link with the page', (surface) => {
    const footer = new URL(timefixUrl({ surface }));
    expect(footer.origin).toBe('https://timefix.ai');
    expect(footer.pathname).toBe('/');
    expect(tagsOf(footer.href)).toEqual({
      utm_source: 'timefix',
      utm_medium: surface,
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
    });
    expect(tagsOf(timefixUrl({ surface, placement: 'claim_link' }))).toEqual({
      utm_source: 'timefix',
      utm_medium: surface,
      utm_campaign: 'powered_by',
      utm_content: 'claim_link',
    });
  });

  it.each(POWERED_BY_EMAILS)('tags the %s footer with the email family', (surface) => {
    expect(tagsOf(timefixUrl({ surface }))).toEqual({
      utm_source: 'timefix',
      utm_medium: surface,
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
    });
  });

  it('adds the workspace as the referrer when the page knows its address', () => {
    expect(tagsOf(timefixUrl({ surface: 'booking_manage', workspaceSlug: 'acme-labs' }))).toEqual({
      utm_source: 'timefix',
      utm_medium: 'booking_manage',
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
      ref: 'acme-labs',
    });
  });

  it.each([
    ['an email', 'ada@acme.example'],
    ['a name', 'Ada Lovelace'],
    ['capitals', 'Acme'],
    ['a path', 'acme/../admin'],
    ['another tag', 'acme&utm_source=x'],
    ['an id', '0199f2a4-7b1c-7d3e-8f00-1a2b3c4d5e6f'],
    ['a short word', 'ac'],
    ['a long word', 'a'.repeat(41)],
    ['nothing', ''],
  ])('leaves %s out of the referrer', (_kind, workspaceSlug) => {
    const url = new URL(timefixUrl({ surface: 'booking_manage', workspaceSlug }));
    expect(url.searchParams.has('ref')).toBe(false);
    expect([...url.searchParams.keys()]).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']);
  });

  it('refuses a surface or a placement off the closed lists', () => {
    for (const surface of ['booking', 'email_', 'acme', 'booking_page&ref=acme', '']) {
      expect(() => timefixUrl({ surface: surface as PoweredBySurface }), surface).toThrow(
        'That isn’t a Timefix link surface.',
      );
    }
    for (const placement of ['badge', 'footer', 'claim_link&x=1', '']) {
      expect(() => timefixUrl({ surface: 'form', placement: placement as PoweredByPlacement }), placement).toThrow(
        'That isn’t a Timefix link placement.',
      );
    }
  });

  it('keeps every tag a plain lowercase word, each surface named once', () => {
    for (const word of [...POWERED_BY_SURFACES, ...POWERED_BY_PLACEMENTS]) expect(word).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    expect(new Set(POWERED_BY_SURFACES).size).toBe(POWERED_BY_SURFACES.length);
  });
});
