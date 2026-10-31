// A public page's own stylesheet (stylesheet.ts, spec 0060): the paths it builds, and one link that loads, moves to
// a new version or goes, against a stand in document.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookHref } from './booking/link-page.ts';
import { brandHref, LOOK_LINK_ID, wearStylesheet, type StylesheetDocument } from './stylesheet.ts';

interface FakeLink {
  id: string;
  rel: string;
  href: string;
  listeners: Map<string, () => void>;
  removed: boolean;
}

/** A head holding links, with just the calls `wearStylesheet` makes. */
function fakeDocument() {
  const links: FakeLink[] = [];
  const wrap = (link: FakeLink) => ({
    get id() {
      return link.id;
    },
    set id(value: string) {
      link.id = value;
    },
    set rel(value: string) {
      link.rel = value;
    },
    set href(value: string) {
      link.href = value;
    },
    getAttribute: (name: string) => (name === 'href' ? link.href : null),
    addEventListener: (type: string, listener: () => void) => link.listeners.set(type, listener),
    remove: () => {
      link.removed = true;
      links.splice(links.indexOf(link), 1);
    },
    replaceWith: (next: { readonly raw: FakeLink }) => {
      link.removed = true;
      links.splice(links.indexOf(link), 1, next.raw);
    },
    raw: link,
  });
  const document = {
    head: { append: (node: { readonly raw: FakeLink }) => links.push(node.raw) },
    getElementById: (id: string) => {
      const found = links.find((link) => link.id === id);
      return found === undefined ? null : wrap(found);
    },
    createElement: () => wrap({ id: '', rel: '', href: '', listeners: new Map(), removed: false }),
  };
  return { document: document as unknown as StylesheetDocument, links };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('lookHref and brandHref', () => {
  it('builds our own api’s paths from checked parts', () => {
    expect(lookHref('anish-rao', 'abcdef012345')).toBe('/api/public/handles/anish-rao/look.css?v=abcdef012345');
    expect(brandHref('booking', 'AbCdEfGhIjKlMnOp', 'abcdef012345')).toBe(
      '/api/public/booking/AbCdEfGhIjKlMnOp/brand.css?v=abcdef012345',
    );
    // A form is named by its address, the slug its door takes (spec 0060, AC-4).
    expect(brandHref('forms', 'project-enquiry', 'abcdef012345')).toBe(
      '/api/public/forms/project-enquiry/brand.css?v=abcdef012345',
    );
  });

  it('is nothing without a version, or for a part that could leave its path', () => {
    expect(lookHref('anish', undefined)).toBeUndefined();
    expect(lookHref('../x', 'abcdef012345')).toBeUndefined();
    expect(lookHref('anish', 'abc"><b>')).toBeUndefined();
    expect(brandHref('booking', 'short', 'abcdef012345')).toBeUndefined();
    expect(brandHref('forms', 'project-enquiry', undefined)).toBeUndefined();
    expect(brandHref('forms', '../x', 'abcdef012345')).toBeUndefined();
    expect(brandHref('forms', 'Project_Enquiry', 'abcdef012345')).toBeUndefined();
  });
});

describe('wearStylesheet', () => {
  it('links the stylesheet and resolves once it has loaded', async () => {
    const { document, links } = fakeDocument();
    let settled = false;
    const worn = wearStylesheet(document, '/api/public/booking/k/brand.css?v=1').then(() => {
      settled = true;
    });
    expect(links).toMatchObject([{ id: LOOK_LINK_ID, rel: 'stylesheet', href: '/api/public/booking/k/brand.css?v=1' }]);
    await Promise.resolve();
    expect(settled).toBe(false);
    links[0]?.listeners.get('load')?.();
    await worn;
    expect(settled).toBe(true);
  });

  it('draws anyway once the wait is over, or the stylesheet failed', async () => {
    vi.useFakeTimers();
    const slow = fakeDocument();
    const late = wearStylesheet(slow.document, '/a.css', 600);
    vi.advanceTimersByTime(600);
    await late;
    const failed = fakeDocument();
    const broken = wearStylesheet(failed.document, '/a.css');
    failed.links[0]?.listeners.get('error')?.();
    await broken;
  });

  it('keeps the link the shell wrote when it is the same address, and replaces it for a new version', async () => {
    const { document, links } = fakeDocument();
    links.push({ id: LOOK_LINK_ID, rel: 'stylesheet', href: '/v1.css', listeners: new Map(), removed: false });
    await wearStylesheet(document, '/v1.css');
    expect(links.map((link) => link.href)).toEqual(['/v1.css']);
    const next = wearStylesheet(document, '/v2.css');
    expect(links.map((link) => link.href)).toEqual(['/v2.css']);
    links[0]?.listeners.get('load')?.();
    await next;
  });

  it('removes the link once the page wears no look of its own', async () => {
    const { document, links } = fakeDocument();
    links.push({ id: LOOK_LINK_ID, rel: 'stylesheet', href: '/v1.css', listeners: new Map(), removed: false });
    await wearStylesheet(document, undefined);
    expect(links).toEqual([]);
  });
});
