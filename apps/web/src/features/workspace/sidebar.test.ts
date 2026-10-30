// The sidebar's model (spec 0034): every page it links to is a route (AC-944), so a renamed route can't leave a
// dead item; every address round 7 moved keeps a route that redirects; the sections it draws, in the member's
// order and folds (AC-921, AC-931), never Favourites; and the first paint's rail hint (AC-935).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavFavourite, NavState, ObjectSummary } from '@crm/data';
import { movedHref, movedPath } from './moved.ts';
import { settingsHomeHref, trashHref } from './objects.ts';
import { keepRailHint, readRailHint } from './rail.ts';
import { drawnSections, PAGE_LINKS, sectionMoveIndex, topEntries, universeOf } from './sidebar.ts';

const tree = readFileSync(new URL('../../routeTree.gen.ts', import.meta.url), 'utf8');
/** Every route's full path, as the generated tree states them. */
const fullPaths = new Set([...tree.matchAll(/fullPath: '([^']+)'/g)].map((match) => match[1]));
/**
 * Whether an address the sidebar links to (with `$slug`) is a route, with or without the trailing slash. A query is a
 * view of its route.
 */
const isRoute = (link: string) => {
  const href = link.split('?')[0] ?? link;
  return fullPaths.has(href) || fullPaths.has(`${href}/`);
};

describe('the sidebar’s routes (AC-944)', () => {
  it('reads the generated tree', () => {
    expect(fullPaths.size).toBeGreaterThan(10);
  });

  it.each(Object.entries(PAGE_LINKS))('links %s to a route of its own', (_page, link) => {
    expect(isRoute(link.href('$slug')), link.href('$slug')).toBe(true);
  });

  it('links each page to the page itself, never to an address that redirects, so hovering preloads it', () => {
    const redirects = ['/w/$slug/bookings', '/w/$slug/captures', '/w/$slug/forms', '/w/$slug/booking-pages'];
    for (const link of Object.values(PAGE_LINKS)) expect(redirects).not.toContain(link.href('$slug'));
  });

  it('links Trash (in Settings since A120) and Settings to routes', () => {
    expect(trashHref('$slug')).toBe('/w/$slug/settings/trash');
    expect(isRoute(trashHref('$slug'))).toBe(true);
    // The old address stays a route, which redirects there.
    expect(isRoute('/w/$slug/trash')).toBe(true);
    expect(isRoute(settingsHomeHref('$slug'))).toBe(true);
  });

  it('draws one Bookings row and one Captures row, as round 6 did (the owner, 22 October 2026)', () => {
    // Link page leads: it is the surface a member opens most, and it answered inside Settings › Account › Profile
    // until 25 October 2026 (the owner). The inbox follows: a mention or an assignment lands there (spec 0038).
    // The Roster is a Bookings tab (31 October 2026), never a row of its own.
    expect(Object.keys(PAGE_LINKS)).toEqual(['linkPage', 'inbox', 'tasks', 'notes', 'bookings', 'captures']);
    expect(PAGE_LINKS.linkPage?.href('acme')).toBe('/w/acme/link-page');
    expect(PAGE_LINKS.inbox?.href('acme')).toBe('/w/acme/inbox');
    expect(PAGE_LINKS.bookings?.href('acme')).toBe('/w/acme/bookings/calendar');
    expect(PAGE_LINKS.captures?.href('acme')).toBe('/w/acme/captures/links');
  });

  it('keeps Availability inside Bookings and Booking pages and Forms inside Captures', () => {
    for (const path of [
      '/w/$slug/bookings/availability',
      '/w/$slug/bookings/availability/$scheduleId',
      '/w/$slug/captures/links',
      '/w/$slug/captures/links/$pageId',
      '/w/$slug/captures/forms',
      '/w/$slug/captures/forms/$formId',
      '/w/$slug/captures/forms/$formId/preview',
    ]) {
      expect(isRoute(path), path).toBe(true);
    }
  });

  it('keeps the link page reachable at the address Settings used, which redirects', () => {
    // A bookmark, an email or a link somebody sent still opens the editor (25 October 2026).
    expect(isRoute('/w/$slug/settings/account/profile')).toBe(true);
    expect(isRoute('/w/$slug/link-page')).toBe(true);
  });

  it('keeps a route at each address round 7 used, which redirects', () => {
    for (const old of ['/w/$slug/availability/$', '/w/$slug/booking-pages/$', '/w/$slug/forms/$']) {
      expect(isRoute(old), old).toBe(true);
    }
  });
});

describe('a round 7 address', () => {
  it('goes back to its place inside Bookings or Captures', () => {
    expect(movedPath('availability', '')).toBe('/bookings/availability');
    expect(movedPath('availability', 'default')).toBe('/bookings/availability/default');
    expect(movedPath('booking-pages', '')).toBe('/captures/links');
    expect(movedPath('booking-pages', '/')).toBe('/captures/links');
    expect(movedPath('booking-pages', 'p1')).toBe('/captures/links/p1');
    expect(movedPath('forms', '')).toBe('/captures/forms');
    expect(movedPath('forms', 'f1')).toBe('/captures/forms/f1');
    expect(movedPath('forms', 'f1/preview')).toBe('/captures/forms/f1/preview');
  });

  it('keeps an id one segment, whatever was typed', () => {
    expect(movedPath('forms', 'a b')).toBe('/captures/forms/a%20b');
    expect(movedPath('booking-pages', 'a?b')).toBe('/captures/links/a%3Fb');
  });

  it('keeps the query', () => {
    expect(movedHref('acme', '/captures/forms/f1', '?tab=install&state=held')).toBe(
      '/w/acme/captures/forms/f1?tab=install&state=held',
    );
    expect(movedHref('acme', '/bookings/availability', '')).toBe('/w/acme/bookings/availability');
  });
});

const PEOPLE = '01900000-0000-7000-8000-000000000001';
const COMPANIES = '01900000-0000-7000-8000-000000000002';
const DEALS = '01900000-0000-7000-8000-000000000003';

const VIEW = '01900000-0000-7000-8000-000000000010';
const FAVOURITE: NavFavourite = {
  kind: 'view',
  id: VIEW,
  label: 'Hot leads',
  objectId: PEOPLE,
  objectSlug: 'people',
  objectName: 'People',
  objectSingularName: 'Person',
  icon: 'user',
  hue: 'blue',
};

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
  scheduling: ['bookings', 'captures'],
  ...over,
});

describe('the sections the sidebar draws (AC-921, AC-928, AC-931)', () => {
  it('draws Records then Scheduling by default, leaving out an empty Lists', () => {
    const nav = navOf();
    const sections = drawnSections(nav, universeOf(OBJECTS, nav));
    expect(sections.map((section) => section.key)).toEqual(['records', 'scheduling']);
    // The live objects in the workspace's order; an archived one isn't in the sidebar.
    expect(sections[0]?.entries.map((entry) => entry.id)).toEqual([PEOPLE, COMPANIES]);
    expect(sections[1]?.entries.map((entry) => entry.id)).toEqual(['bookings', 'captures']);
  });

  it('never draws Favourites, even with a starred view the server resolved (owner, 30 October 2026)', () => {
    const nav = navOf({ items: [{ kind: 'view', id: VIEW, pinned: true }], favourites: [FAVOURITE] });
    expect(drawnSections(nav, universeOf(OBJECTS, nav)).map((section) => section.key)).toEqual([
      'records',
      'scheduling',
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
