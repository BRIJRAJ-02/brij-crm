// The handle shell for a business (spec 0066, AC-6644): its own meta block, structured data of its schema.org type,
// crawler text and boot block, nothing a business wrote able to close an element, and the shell's fall through from
// a handle that names no person.
import type { PublicBusinessPage } from '@crm/contracts/business-page';
import { describe, expect, it } from 'vitest';
import { businessOf, businessShell, businessTitle } from './business-shell.ts';
import { shellFor } from './handle-shell.ts';

const SHELL =
  '<!doctype html>\n<html lang="en">\n  <head>\n    <title>Timefix</title>\n    <meta name="robots" content="noindex" />\n  </head>\n  <body><div id="root"></div></body>\n</html>';

const PAGE: PublicBusinessPage = {
  handle: 'somewhere-nowhere',
  name: 'Somewhere </script> Nowhere',
  kind: 'restaurant',
  description: 'Plates to share.',
  gallery: [{ id: 'a', width: 1600, height: 1200, src: '/api/public/business/somewhere-nowhere/photos/a' }],
  amenities: ['wifi'],
  places: [
    {
      id: '01a1a318-65c2-773f-9280-f19a9291844e',
      slug: 'indiranagar',
      name: 'Indiranagar',
      addressLine: '12 MG Road',
      city: 'Bengaluru',
      country: 'IN',
      timeZone: 'Asia/Kolkata',
      hours: { weekly: { mon: [{ from: '12:00', to: '23:00' }] }, exceptions: [] },
      seoHidden: false,
    },
  ],
  placeId: '01a1a318-65c2-773f-9280-f19a9291844e',
  reserve: 'soon',
  indexable: true,
  publishedAt: '2026-11-04T00:00:00.000Z',
  tags: ['business:01a1a318-4527-783d-8b66-6e0e25215351', 'place:01a1a318-65c2-773f-9280-f19a9291844e'],
};

describe('businessShell', () => {
  it('writes its title, canonical, photo card, Restaurant structured data, crawler text and boot block', () => {
    const html = businessShell(SHELL, PAGE, 'https://timefix.com', 1);
    expect(html).toContain('<link rel="canonical" href="https://timefix.com/somewhere-nowhere" />');
    expect(html).toContain('content="https://timefix.com/api/public/business/somewhere-nowhere/photos/a"');
    expect(html).toContain('<meta property="og:image:width" content="1600" />');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    const ld: unknown = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}');
    expect(ld).toMatchObject({
      '@type': 'Restaurant',
      address: { '@type': 'PostalAddress', addressLocality: 'Bengaluru', addressCountry: 'IN' },
      openingHoursSpecification: [{ dayOfWeek: 'https://schema.org/Monday', opens: '12:00', closes: '23:00' }],
    });
    // Nothing the business wrote closes a script or opens a tag.
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect(html).toContain('<h1>Somewhere &lt;/script&gt; Nowhere</h1>');
    expect(html).toContain('"kind":"business"');
  });

  it('carries no structured data and says noindex for a place hidden from search engines', () => {
    const html = businessShell(SHELL, { ...PAGE, indexable: false }, 'https://timefix.com', 1);
    expect(html).not.toContain('application/ld+json');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('titles the page with its kind and city', () => {
    expect(businessTitle({ ...PAGE, name: 'Somewhere' })).toBe('Somewhere · Restaurant in Bengaluru');
  });

  it('trusts no read: a malformed answer is no business', () => {
    expect(businessOf({ handle: 'x' })).toBeUndefined();
    expect(businessOf({ ...PAGE, kind: 'casino' })).toBeUndefined();
    expect(businessOf(PAGE)).toBe(PAGE);
  });
});

describe('shellFor with a business', () => {
  const deps = {
    shell: SHELL,
    origin: 'https://timefix.com',
    readProfile: () => Promise.resolve(undefined),
    readPage: () => Promise.resolve(undefined),
    now: () => 1,
  };

  it('answers the business page, filed under its cache tags, once the handle names no person', async () => {
    const answer = await shellFor('/somewhere-nowhere', {
      ...deps,
      readBusiness: (handle, slug) =>
        Promise.resolve(handle === 'somewhere-nowhere' && slug === undefined ? PAGE : undefined),
    });
    expect(answer).toMatchObject({ status: 200, outcome: 'business', tags: PAGE.tags });
  });

  it('reads a place by its slug once no booking page has it', async () => {
    const asked: (string | undefined)[] = [];
    const answer = await shellFor('/somewhere-nowhere/indiranagar', {
      ...deps,
      readBusiness: (_handle, slug) => {
        asked.push(slug);
        return Promise.resolve(PAGE);
      },
    });
    expect(asked).toEqual(['indiranagar']);
    expect(answer.outcome).toBe('business');
  });

  it('keeps the 404 for a handle that names nobody and no business', async () => {
    const answer = await shellFor('/nobody-here', { ...deps, readBusiness: () => Promise.resolve(undefined) });
    expect(answer).toMatchObject({ status: 404, outcome: 'unknown' });
  });
});
