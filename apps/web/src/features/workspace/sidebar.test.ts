// The sidebar's model (spec 0034): every page it links to is a route (AC-944), so a renamed route can't leave a
// dead item; every moved address keeps a route that redirects (AC-929); the sections it draws, in the member's
// order and folds (AC-921, AC-931); and the first paint's rail hint (AC-935).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavState, ObjectSummary } from '@crm/data';
import { capturesPath, movedHref } from './moved.ts';
import { settingsHomeHref, trashHref } from './objects.ts';
import { keepRailHint, readRailHint } from './rail.ts';
import { drawnSections, PAGE_LINKS, sectionMoveIndex, topEntries, universeOf } from './sidebar.ts';

const tree = readFileSync(new URL('../../routeTree.gen.ts', import.meta.url), 'utf8');
/** Every route's full path, as the generated tree states them. */
const fullPaths = new Set([...tree.matchAll(/fullPath: '([^']+)'/g)].map((match) => match[1]));
/** Whether an address the sidebar links to (with `$slug`) is a route, with or without the trailing slash. */
const isRoute = (href: string) => fullPaths.has(href) || fullPaths.has(`${href}/`);

describe('the sidebar’s routes (AC-944)', () => {
  it('reads the generated tree', () => {
    expect(fullPaths.size).toBeGreaterThan(10);
  });

  it.each(Object.entries(PAGE_LINKS))('links %s to a route of its own', (_page, link) => {
    expect(isRoute(link.href('$slug')), link.href('$slug')).toBe(true);
  });

  it('links each page to the page itself, never to an address that redirects, so hovering preloads it', () => {
    const redirects = ['/w/$slug/bookings', '/w/$slug/captures/links', '/w/$slug/captures/forms'];
    for (const link of Object.values(PAGE_LINKS)) expect(redirects).not.toContain(link.href('$slug'));
  });

  it('links the foot’s Trash and Settings to routes', () => {
    expect(isRoute(trashHref('$slug'))).toBe(true);
    expect(isRoute(settingsHomeHref('$slug'))).toBe(true);
  });

  it('keeps a route at every moved address, which redirects (AC-929)', () => {
    for (const old of ['/w/$slug/captures/$', '/w/$slug/bookings/availability']) expect(isRoute(old), old).toBe(true);
  });

  it('no longer has the Captures pages or the Availability tab', () => {
    for (const gone of ['/w/$slug/captures/links', '/w/$slug/captures/forms', '/w/$slug/captures']) {
      expect(fullPaths.has(gone), gone).toBe(false);
    }
  });
});

describe('a moved address (AC-929)', () => {
  it('sends each Captures address to its new page', () => {
    expect(capturesPath('')).toBe('/booking-pages');
    expect(capturesPath('links')).toBe('/booking-pages');
    expect(capturesPath('links/')).toBe('/booking-pages');
    expect(capturesPath('links/p1')).toBe('/booking-pages/p1');
    expect(capturesPath('forms')).toBe('/forms');
    expect(capturesPath('forms/')).toBe('/forms');
    expect(capturesPath('forms/f1')).toBe('/forms/f1');
    expect(capturesPath('forms/f1/preview')).toBe('/forms/f1/preview');
    expect(capturesPath('anything/else')).toBe('/booking-pages');
  });

  it('keeps an id one segment, whatever was typed', () => {
    expect(capturesPath('forms/a b')).toBe('/forms/a%20b');
    expect(capturesPath('links/a?b')).toBe('/booking-pages/a%3Fb');
  });

  it('keeps the query', () => {
    expect(movedHref('acme', '/forms/f1', '?tab=install&state=held')).toBe('/w/acme/forms/f1?tab=install&state=held');
    expect(movedHref('acme', '/booking-pages', '')).toBe('/w/acme/booking-pages');
  });
});

const PEOPLE = '01900000-0000-7000-8000-000000000001';
const COMPANIES = '01900000-0000-7000-8000-000000000002';
const DEALS = '01900000-0000-7000-8000-000000000003';

const object = (id: string, pluralName: string, position: number, isArchived = false): ObjectSummary =>
  ({ id, pluralName, position, isArchived }) as ObjectSummary;
const OBJECTS = [object(COMPANIES, 'Companies', 2), object(PEOPLE, 'People', 1), object(DEALS, 'Deals', 3, true)];

const navOf = (over: Partial<NavState> = {}): NavState => ({
  items: [],
  sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
  rail: false,
  version: 0,
  favourites: [],
  top: ['tasks'],
  scheduling: ['bookings', 'availability', 'booking_pages', 'forms'],
  ...over,
});

describe('the sections the sidebar draws (AC-921, AC-928, AC-931)', () => {
  it('draws Records then Scheduling by default, leaving out Favourites and Lists while they are empty', () => {
    const nav = navOf();
    const sections = drawnSections(nav, universeOf(OBJECTS, nav));
    expect(sections.map((section) => section.key)).toEqual(['records', 'scheduling']);
    // The live objects in the workspace's order; an archived one isn't in the sidebar.
    expect(sections[0]?.entries.map((entry) => entry.id)).toEqual([PEOPLE, COMPANIES]);
    expect(sections[1]?.entries.map((entry) => entry.id)).toEqual([
      'bookings',
      'availability',
      'booking_pages',
      'forms',
    ]);
  });

  it('follows the member’s section order and folds', () => {
    const nav = navOf({ sections: { order: ['scheduling', 'records'], folded: ['scheduling'] } });
    const sections = drawnSections(nav, universeOf(OBJECTS, nav));
    expect(sections.map((section) => [section.key, section.isFolded])).toEqual([
      ['scheduling', true],
      ['records', false],
    ]);
  });

  it('leaves Scheduling out for someone with none of its pages (a guest, spec 0031)', () => {
    const nav = navOf({ scheduling: [] });
    expect(drawnSections(nav, universeOf(OBJECTS, nav)).map((section) => section.key)).toEqual(['records']);
  });

  it('draws Records loading or empty, never leaving it out', () => {
    const nav = navOf();
    expect(drawnSections(nav, universeOf(undefined, nav)).map((section) => section.key)).toEqual([
      'records',
      'scheduling',
    ]);
    expect(drawnSections(nav, universeOf([], nav))[0]?.entries).toEqual([]);
  });

  it('puts Tasks above the sections, and nothing there for someone without it', () => {
    const nav = navOf();
    expect(topEntries(nav, universeOf(OBJECTS, nav)).map((entry) => entry.id)).toEqual(['tasks']);
    const none = navOf({ top: [] });
    expect(topEntries(none, universeOf(OBJECTS, none))).toEqual([]);
  });
});

describe('the rail on the first paint (AC-935)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the member’s rail for the next first paint, one workspace at a time', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, value),
      removeItem: (key: string) => kept.delete(key),
    });
    expect(readRailHint('acme')).toBe(false);
    keepRailHint('acme', true);
    expect(readRailHint('acme')).toBe(true);
    expect(readRailHint('other')).toBe(false);
    keepRailHint('acme', false);
    expect(readRailHint('acme')).toBe(false);
  });

  it('reads the open sidebar when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Blocked.');
      },
      setItem: () => {
        throw new Error('Blocked.');
      },
      removeItem: () => {
        throw new Error('Blocked.');
      },
    });
    keepRailHint('acme', true);
    expect(readRailHint('acme')).toBe(false);
  });
});

describe('a section dropped among the drawn sections (AC-932)', () => {
  const order = ['favourites', 'records', 'lists', 'scheduling'] as const;
  it('lands beside the drawn section it was dropped next to, the undrawn ones keeping their places', () => {
    // Drawn: Records, Scheduling (no favourites, no lists).
    expect(sectionMoveIndex(order, ['records', 'scheduling'], 'scheduling', 0)).toBe(1);
    expect(sectionMoveIndex(order, ['records', 'scheduling'], 'records', 1)).toBe(3);
    expect(sectionMoveIndex(order, ['records'], 'records', 0)).toBe(0);
  });
});
