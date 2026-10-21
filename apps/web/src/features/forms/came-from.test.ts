// Came from on a submission (spec 0023, tagging): the stored context reads as
// pages on their sites, the tags and the passed parameters; a submission from
// before it reads its hidden fields the same way.
import { describe, expect, it } from 'vitest';
import { cameFromOf, pageName } from './came-from.ts';

describe('where a submission came from', () => {
  it('reads the context as a person names it', () => {
    expect(
      cameFromOf({
        hidden: {},
        context: {
          page_url: 'https://acme.com/pricing?plan=pro',
          page_title: 'Pricing',
          landing_url: 'https://acme.com/',
          referrer: 'https://news.example.com/item',
          utm_campaign: 'spring',
          params: { plan: 'pro' },
          mode: 'popup',
          visitor_id: 'v_0123456789abcdef',
        },
      }),
    ).toEqual([
      { term: 'Page', description: '/pricing?plan=pro on acme.com' },
      { term: 'Page title', description: 'Pricing' },
      { term: 'First page of the visit', description: 'Home page on acme.com' },
      { term: 'Referrer', description: '/item on news.example.com' },
      { term: 'UTM campaign', description: 'spring' },
      { term: 'plan', description: 'pro' },
      { term: 'Sent from', description: 'An embed’s popup' },
    ]);
  });

  it('falls back to the older hidden fields, and says nothing when nothing came', () => {
    expect(cameFromOf({ hidden: { page: 'https://acme.com/a', utm_source: 'mail' } })).toEqual([
      { term: 'Page', description: '/a on acme.com' },
      { term: 'UTM source', description: 'mail' },
    ]);
    expect(cameFromOf({ hidden: {} })).toEqual([]);
    // A mode a later script names is left out, never shown blank.
    expect(cameFromOf({ hidden: {}, context: { mode: 'sidebar' } as never })).toEqual([]);
    expect(pageName('not an address')).toBe('not an address');
  });
});
