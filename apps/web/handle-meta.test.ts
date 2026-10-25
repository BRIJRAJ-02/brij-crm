// The meta block a handle address's shell carries (spec 0055): what it says, and that nothing a person typed can
// leave the value it was written into.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRAND_TITLE,
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_DESCRIPTION,
  DESCRIPTION_MAX,
  describe as describeText,
  escapeHtml,
  metaTags,
  titleOf,
  withMeta,
} from './handle-meta.ts';
import type { MetaSource } from './handle-meta.ts';

const shell = readFileSync(path.join(import.meta.dirname, 'book.html'), 'utf8');

const source: MetaSource = {
  name: 'Anish Rao',
  description: 'Designer in Bangalore. Book a time, or take a link.',
  canonical: 'https://timefix.com/anish',
  card: 'https://timefix.com/api/public/handles/anish/card.png?v=a1b2c3',
  kind: 'profile',
  indexable: true,
};

describe('describe', () => {
  it('falls back to the product’s own line for an empty bio', () => {
    expect(describeText(undefined)).toBe(DEFAULT_DESCRIPTION);
    expect(describeText('   \n  ')).toBe(DEFAULT_DESCRIPTION);
  });

  it('reads a bio written over several lines as one sentence', () => {
    expect(describeText('Designer\n\nin   Bangalore.')).toBe('Designer in Bangalore.');
  });

  it('cuts a long bio on a word, inside the limit', () => {
    const long = `${'word '.repeat(60)}end`;
    const cut = describeText(long);
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/wor…$/);
  });

  it('cuts inside one long word rather than answering an ellipsis alone', () => {
    const cut = describeText('a'.repeat(400));
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut.length).toBeGreaterThan(DESCRIPTION_MAX / 2);
  });
});

describe('titleOf', () => {
  it('names the person and the product', () => {
    expect(titleOf('Anish Rao')).toBe(`Anish Rao · ${BRAND_TITLE}`);
  });

  it('is the product alone when there is no name', () => {
    expect(titleOf('  ')).toBe(BRAND_TITLE);
  });
});

describe('metaTags', () => {
  it('writes every tag the spec names for a profile', () => {
    const tags = metaTags(source);
    expect(tags).toContain('<title>Anish Rao · Timefix</title>');
    expect(tags).toContain('<meta name="description" content="Designer in Bangalore. Book a time, or take a link." />');
    expect(tags).toContain('<meta name="robots" content="index, follow" />');
    expect(tags).toContain('<link rel="canonical" href="https://timefix.com/anish" />');
    expect(tags).toContain('<meta property="og:type" content="profile" />');
    expect(tags).toContain('<meta property="og:title" content="Anish Rao · Timefix" />');
    expect(tags).toContain('<meta property="og:url" content="https://timefix.com/anish" />');
    expect(tags).toContain(`<meta property="og:image" content="${source.card ?? ''}" />`);
    expect(tags).toContain(`<meta property="og:image:width" content="${String(CARD_WIDTH)}" />`);
    expect(tags).toContain(`<meta property="og:image:height" content="${String(CARD_HEIGHT)}" />`);
    expect(tags).toContain('<meta property="og:image:alt" content="Anish Rao · Timefix" />');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('says a booking page is a website, and keeps its own note', () => {
    const tags = metaTags({ ...source, kind: 'website', name: 'Intro call', description: 'Fifteen minutes.' });
    expect(tags).toContain('<meta property="og:type" content="website" />');
    expect(tags).toContain('<title>Intro call · Timefix</title>');
    expect(tags).toContain('<meta name="description" content="Fifteen minutes." />');
  });

  it('turns indexing off without turning following off', () => {
    expect(metaTags({ ...source, indexable: false })).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('claims no card when there is none, and asks for the small preview', () => {
    const tags = metaTags({ ...source, card: undefined });
    expect(tags).not.toContain('og:image');
    expect(tags).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('escapes every value, so nothing typed can end its attribute or open a tag', () => {
    const tags = metaTags({
      ...source,
      name: 'Ada "><script>alert(1)</script>',
      description: "Bio with <b>markup</b> & an 'apostrophe'",
    });
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&lt;script&gt;');
    expect(tags).toContain('&quot;');
    expect(tags).toContain('&amp;');
    expect(tags).toContain('&#39;');
    // Exactly the tags it writes, and no tag the values smuggled in.
    expect(tags.match(/<meta|<title|<link/g)?.length).toBe(tags.split('\n').filter((line) => line !== '').length);
  });
});

describe('escapeHtml', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Designer in Bangalore')).toBe('Designer in Bangalore');
  });
});

describe('withMeta', () => {
  it('writes the block into the built shell and takes the shell’s own title and noindex out', () => {
    const page = withMeta(shell, source);
    expect(page.match(/<title>/g)).toHaveLength(1);
    expect(page).toContain('<title>Anish Rao · Timefix</title>');
    expect(page).not.toContain('content="noindex"');
    expect(page).toContain('<meta name="robots" content="index, follow" />');
    expect(page.indexOf('<meta name="robots"')).toBeLessThan(page.indexOf('</head>'));
  });

  it('changes nothing but the head', () => {
    const page = withMeta(shell, source);
    const bodyOf = (html: string) => html.slice(html.indexOf('</head>'));
    expect(bodyOf(page)).toBe(bodyOf(shell));
  });

  it('writes the owner’s look onto the page root, as the module draws it', () => {
    const page = withMeta(shell, {
      ...source,
      look: { ground: 'ink', hue: 'purple', mode: 'dark', shape: 'pill', fill: 'solid', font: 'mono' },
    });
    expect(page).toContain('data-theme="dark"');
    expect(page).toContain('data-page-ground="ink"');
    expect(page).toContain('data-page-hue="purple"');
    expect(page).toContain('data-page-shape="pill"');
    expect(page).toContain('data-page-fill="solid"');
    expect(page).toContain('data-page-font="mono"');
    expect(page).toContain('data-public-page="booking"');
  });

  it('carries no look when the read missed, so the page behaves as it does today', () => {
    expect(withMeta(shell, source)).not.toContain('data-page-ground');
  });

  it('hands back a shell it cannot find its way into, rather than half rewriting it', () => {
    expect(withMeta('<p>not a page</p>', source)).toBe('<p>not a page</p>');
  });
});
