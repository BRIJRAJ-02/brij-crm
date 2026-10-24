import { timefixUrl } from '@crm/contracts/brand';
import { describe, expect, it } from 'vitest';
import { claimPageHref, poweredByHref, type PoweredByPage } from './powered-by.ts';

/** A link's query, read back as a plain object. */
const tagsOf = (href: string) => Object.fromEntries(new URL(href).searchParams);

describe('poweredByHref', () => {
  it('tags the footer link with its page and the workspace', () => {
    const url = new URL(poweredByHref('booking_manage', 'acme'));
    expect(url.origin).toBe('https://www.timefix.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'timefix',
      utm_medium: 'booking_manage',
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
      ref: 'acme',
    });
  });
});

describe('poweredByHref on a hosted form', () => {
  it('tags the form footer the same way, with no referrer when the page has none', () => {
    const url = new URL(poweredByHref('form'));
    expect(url.searchParams.get('utm_medium')).toBe('form');
    expect(url.searchParams.get('utm_campaign')).toBe('powered_by');
    expect(url.searchParams.has('ref')).toBe(false);
  });
});

describe('each public page’s Timefix links', () => {
  const pages: readonly PoweredByPage[] = [
    'booking_page',
    'booking_profile',
    'booking_confirmation',
    'booking_manage',
    'form',
  ];

  it.each(pages)('tags the %s wordmark as the footer logo and its claim link as the claim link', (page) => {
    expect(tagsOf(poweredByHref(page))).toEqual({
      utm_source: 'timefix',
      utm_medium: page,
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
    });
    expect(tagsOf(claimPageHref(page))).toEqual({
      utm_source: 'timefix',
      utm_medium: page,
      utm_campaign: 'powered_by',
      utm_content: 'claim_link',
    });
  });

  it('builds both links with the one shared builder the emails use', () => {
    expect(poweredByHref('booking_page')).toBe(timefixUrl({ surface: 'booking_page' }));
    expect(poweredByHref('booking_manage', 'acme')).toBe(
      timefixUrl({ surface: 'booking_manage', workspaceSlug: 'acme' }),
    );
    expect(claimPageHref('booking_profile')).toBe(timefixUrl({ surface: 'booking_profile', placement: 'claim_link' }));
  });

  it('never sends a referrer that isn’t a workspace address', () => {
    expect(new URL(poweredByHref('booking_manage', 'ada@acme.example')).searchParams.has('ref')).toBe(false);
  });
});
