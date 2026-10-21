import { describe, expect, it } from 'vitest';
import { poweredByHref } from './powered-by.ts';

describe('poweredByHref', () => {
  it('tags the footer link with its page and the workspace', () => {
    const url = new URL(poweredByHref('booking_manage', 'acme'));
    expect(url.origin).toBe('https://timefix.ai');
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
