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
