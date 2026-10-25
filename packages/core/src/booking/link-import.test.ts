// Reading somebody else's link in bio page (spec 0055, AC-5525 to AC-5528): what it keeps, what it lists with a
// reason, and that nothing in a page it read can become anything but a title and an address.
import { describe, expect, it } from 'vitest';
import { isImportableHost, LINK_IMPORT_HOSTS, readImportedPage } from './link-import.ts';

const SOURCE = new URL('https://linktr.ee/ada');

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe('isImportableHost', () => {
  it.each(LINK_IMPORT_HOSTS)('takes %s', (host) => {
    expect(isImportableHost(new URL(`https://${host}/ada`))).toBe(true);
  });

  it('takes a subdomain of one', () => {
    expect(isImportableHost(new URL('https://ada.bio.link/'))).toBe(true);
  });

  it.each(['https://example.com/ada', 'https://linktr.ee.example.com/ada', 'https://notlinktr.ee/ada'])(
    'refuses %s',
    (href) => {
      expect(isImportableHost(new URL(href))).toBe(false);
    },
  );
});

describe('readImportedPage', () => {
  it('keeps a row’s words and where it goes, in the page’s own order', () => {
    const { rows } = readImportedPage(
      page(`
        <a href="https://example.com/one">My newsletter</a>
        <a href="https://example.org/two"><span>My </span><b>shop</b></a>
      `),
      SOURCE,
    );
    expect(rows).toEqual([
      { title: 'My newsletter', url: 'https://example.com/one' },
      { title: 'My shop', url: 'https://example.org/two' },
    ]);
  });

  it('reads entities and collapses whitespace in a title', () => {
    const { rows } = readImportedPage(page('<a href="https://example.com/">Tea &amp;\n  Cake &#39;24</a>'), SOURCE);
    expect(rows[0]?.title).toBe("Tea & Cake '24");
  });

  it('never lets markup, or what a script said, out of a title', () => {
    const { rows } = readImportedPage(
      page('<a href="https://example.com/"><script>alert(1)</script>Shop<style>a{}</style></a>'),
      SOURCE,
    );
    expect(rows[0]?.title).toBe('Shop');
    expect(rows[0]?.title).not.toContain('<');
  });

  it('cuts a very long title to what a link block holds', () => {
    const { rows } = readImportedPage(page(`<a href="https://example.com/">${'word '.repeat(40)}</a>`), SOURCE);
    expect((rows[0]?.title ?? '').length).toBeLessThanOrEqual(60);
  });

  it('reads an href in single quotes or with none at all', () => {
    const { rows } = readImportedPage(
      page(`<a href='https://example.com/one'>One</a><a href=https://example.com/two >Two</a>`),
      SOURCE,
    );
    expect(rows.map((row) => row.url)).toEqual(['https://example.com/one', 'https://example.com/two']);
  });

  it('makes a relative address absolute against the page it read', () => {
    const { skipped } = readImportedPage(page('<a href="/about">About</a>'), SOURCE);
    // Relative means the page's own host, which is its navigation rather than somebody's link.
    expect(skipped[0]).toEqual({ reason: 'the-page-itself', title: 'About', url: 'https://linktr.ee/about' });
  });

  it.each([
    ['<a>Nowhere</a>', 'no-address'],
    ['<a href="javascript:alert(1)">Press</a>', 'not-web'],
    ['<a href="mailto:ada@example.com">Email</a>', 'not-web'],
    ['<a href="https://linktr.ee/ada">Me</a>', 'the-page-itself'],
    ['<a href="https://example.com/x"></a>', 'no-title'],
  ])('lists %s as %s rather than dropping it', (body, reason) => {
    const { rows, skipped } = readImportedPage(page(body), SOURCE);
    expect(rows).toEqual([]);
    expect(skipped[0]?.reason).toBe(reason);
  });

  it('never runs or keeps a javascript address', () => {
    const { rows, skipped } = readImportedPage(page('<a href="JavaScript:alert(1)">Press</a>'), SOURCE);
    expect(rows).toEqual([]);
    expect(skipped[0]?.reason).toBe('not-web');
  });

  it('keeps the first of a repeated address and lists the rest', () => {
    const { rows, skipped } = readImportedPage(
      page('<a href="https://example.com/">One</a><a href="https://example.com/">Again</a>'),
      SOURCE,
    );
    expect(rows).toHaveLength(1);
    expect(skipped[0]).toEqual({ reason: 'repeated', title: 'Again', url: 'https://example.com/' });
  });

  it('keeps at most the limit and lists what is past it, so nothing is silently lost', () => {
    const many = Array.from({ length: 6 }, (_, at) => `<a href="https://example.com/${String(at)}">Row</a>`).join('');
    const { rows, skipped } = readImportedPage(page(many), SOURCE, 4);
    expect(rows).toHaveLength(4);
    expect(skipped).toHaveLength(2);
    expect(skipped.every((row) => row.reason === 'past-limit')).toBe(true);
  });

  it('finds nothing in a page with no anchors, and says so without failing', () => {
    expect(readImportedPage(page('<p>Nothing here</p>'), SOURCE)).toEqual({ rows: [], skipped: [] });
  });

  it('reads a page whose markup is broken without throwing', () => {
    const { rows } = readImportedPage('<a href="https://example.com/">Open<div></a><a href=', SOURCE);
    expect(rows).toEqual([{ title: 'Open', url: 'https://example.com/' }]);
  });
});
