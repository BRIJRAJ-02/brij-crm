import { describe, expect, it } from 'vitest';
import {
  applyNavOp,
  DEFAULT_NAV_PREFS,
  MAX_NAV_FAVOURITES,
  moveIndexFor,
  NAV_FAVOURITES_LIMIT_MESSAGE,
  navKey,
  pruneNavItems,
  sectionItems,
  sectionOrder,
  type NavOperation,
  type NavPrefs,
  type NavUniverse,
} from './nav-model.ts';
import { NavOp } from './navigation.ts';

const PEOPLE = '01900000-0000-7000-8000-000000000001';
const COMPANIES = '01900000-0000-7000-8000-000000000002';
const DEALS = '01900000-0000-7000-8000-000000000003';
const HIDDEN_OBJECT = '01900000-0000-7000-8000-000000000004';
const VIEW = '01900000-0000-7000-8000-000000000010';
const RECORD = '01900000-0000-7000-8000-000000000011';

const universe: NavUniverse = {
  top: [],
  records: [PEOPLE, COMPANIES, DEALS],
  lists: [],
  scheduling: ['bookings', 'availability', 'booking_pages', 'forms'],
  favourites: new Set([`view:${VIEW}`, `record:${RECORD}`]),
};

function apply(prefs: NavPrefs, ...ops: NavOperation[]): NavPrefs {
  return ops.reduce((current, op) => {
    const result = applyNavOp(current, op, universe);
    if (!result.ok) throw new Error(result.refusal.message);
    return result.prefs;
  }, prefs);
}

const ids = (prefs: NavPrefs, section: Parameters<typeof sectionItems>[2]) =>
  sectionItems(prefs, universe, section).map((entry) => entry.id);

describe('the sidebar model', () => {
  it('shows the defaults with nothing stored: the workspace order, every Scheduling page, no favourites', () => {
    expect(ids(DEFAULT_NAV_PREFS, 'records')).toEqual([PEOPLE, COMPANIES, DEALS]);
    expect(ids(DEFAULT_NAV_PREFS, 'scheduling')).toEqual(['bookings', 'availability', 'booking_pages', 'forms']);
    expect(ids(DEFAULT_NAV_PREFS, 'favourites')).toEqual([]);
    expect(sectionOrder(DEFAULT_NAV_PREFS)).toEqual(['favourites', 'records', 'lists', 'scheduling']);
  });

  it('moves an item inside its section, and puts a new object at the end without being asked (AC-926)', () => {
    const moved = apply(DEFAULT_NAV_PREFS, { op: 'move', kind: 'object', id: DEALS, toIndex: 0 });
    expect(ids(moved, 'records')).toEqual([DEALS, PEOPLE, COMPANIES]);
    const grown = { ...universe, records: [...universe.records, HIDDEN_OBJECT] };
    expect(sectionItems(moved, grown, 'records').map((entry) => entry.id)).toEqual([
      DEALS,
      PEOPLE,
      COMPANIES,
      HIDDEN_OBJECT,
    ]);
  });

  it('clamps an index past the end rather than refusing it', () => {
    const moved = apply(DEFAULT_NAV_PREFS, { op: 'move', kind: 'object', id: PEOPLE, toIndex: 99 });
    expect(ids(moved, 'records')).toEqual([COMPANIES, DEALS, PEOPLE]);
  });

  it('keeps an object the member can no longer read in the row, and it comes back in its place (AC-939)', () => {
    const stored = apply(DEFAULT_NAV_PREFS, { op: 'move', kind: 'object', id: DEALS, toIndex: 0 });
    const without = { ...universe, records: [PEOPLE, COMPANIES] };
    const moved = applyNavOp(stored, { op: 'move', kind: 'object', id: COMPANIES, toIndex: 0 }, without);
    if (!moved.ok) throw new Error('refused');
    expect(sectionItems(moved.prefs, without, 'records').map((entry) => entry.id)).toEqual([COMPANIES, PEOPLE]);
    expect(moved.prefs.items.map((item) => item.id)).toContain(DEALS);
    expect(ids(moved.prefs, 'records')).toEqual([COMPANIES, PEOPLE, DEALS]);
  });

  it('hides and shows an object, a page, never a favourite', () => {
    const hidden = apply(
      DEFAULT_NAV_PREFS,
      { op: 'hide', kind: 'object', id: DEALS },
      { op: 'hide', kind: 'page', id: 'forms' },
    );
    expect(sectionItems(hidden, universe, 'records').find((entry) => entry.id === DEALS)?.hidden).toBe(true);
    expect(sectionItems(hidden, universe, 'scheduling').find((entry) => entry.id === 'forms')?.hidden).toBe(true);
    const shown = apply(hidden, { op: 'show', kind: 'object', id: DEALS });
    expect(sectionItems(shown, universe, 'records').every((entry) => !entry.hidden)).toBe(true);
    expect(shown.items.find((item) => item.id === DEALS)).toEqual({ kind: 'object', id: DEALS });
    const refused = applyNavOp(DEFAULT_NAV_PREFS, { op: 'hide', kind: 'view', id: VIEW }, universe);
    expect(refused).toMatchObject({ ok: false, refusal: { code: 'CONFIG_INVALID' } });
  });

  it('stars views and records in the order starred, once each, and unstars them', () => {
    const starred = apply(
      DEFAULT_NAV_PREFS,
      { op: 'star', kind: 'record', id: RECORD },
      { op: 'star', kind: 'view', id: VIEW },
      { op: 'star', kind: 'record', id: RECORD },
    );
    expect(sectionItems(starred, universe, 'favourites').map(navKey)).toEqual([`record:${RECORD}`, `view:${VIEW}`]);
    const moved = apply(starred, { op: 'move', kind: 'view', id: VIEW, toIndex: 0 });
    expect(sectionItems(moved, universe, 'favourites').map(navKey)).toEqual([`view:${VIEW}`, `record:${RECORD}`]);
    expect(moved.items.every((item) => item.pinned === true)).toBe(true);
    const unstarred = apply(moved, { op: 'unstar', kind: 'view', id: VIEW });
    expect(sectionItems(unstarred, universe, 'favourites').map(navKey)).toEqual([`record:${RECORD}`]);
  });

  it('refuses the 51st favourite (AC-934)', () => {
    const full: NavPrefs = {
      ...DEFAULT_NAV_PREFS,
      items: Array.from({ length: MAX_NAV_FAVOURITES }, (_, index) => ({
        kind: 'record' as const,
        id: `01900000-0000-7000-8000-${String(index).padStart(12, '0')}`,
        pinned: true,
      })),
    };
    expect(applyNavOp(full, { op: 'star', kind: 'view', id: VIEW }, universe)).toEqual({
      ok: false,
      refusal: { code: 'NAV_LIMIT', message: NAV_FAVOURITES_LIMIT_MESSAGE },
    });
  });

  it('folds, moves sections, sets the rail, and answers the same row for a change that changes nothing', () => {
    const changed = apply(
      DEFAULT_NAV_PREFS,
      { op: 'fold', section: 'scheduling', folded: true },
      { op: 'moveSection', section: 'scheduling', toIndex: 0 },
      { op: 'rail', on: true },
    );
    expect(changed.sections.folded).toEqual(['scheduling']);
    expect(sectionOrder(changed)).toEqual(['scheduling', 'favourites', 'records', 'lists']);
    expect(changed.rail).toBe(true);
    const again = applyNavOp(changed, { op: 'rail', on: true }, universe);
    expect(again.ok && again.prefs).toBe(changed);
  });

  it('resets order, hiding and folds, and keeps favourites and the rail', () => {
    const changed = apply(
      DEFAULT_NAV_PREFS,
      { op: 'move', kind: 'object', id: DEALS, toIndex: 0 },
      { op: 'hide', kind: 'object', id: PEOPLE },
      { op: 'fold', section: 'records', folded: true },
      { op: 'star', kind: 'view', id: VIEW },
      { op: 'rail', on: true },
    );
    const reset = apply(changed, { op: 'reset' });
    expect(ids(reset, 'records')).toEqual([PEOPLE, COMPANIES, DEALS]);
    expect(reset.sections).toEqual(DEFAULT_NAV_PREFS.sections);
    expect(reset.items).toEqual([{ kind: 'view', id: VIEW, pinned: true }]);
    expect(reset.rail).toBe(true);
  });

  it('two changes to different things, applied in either order, keep both (AC-938)', () => {
    const star: NavOperation = { op: 'star', kind: 'record', id: RECORD };
    const section: NavOperation = { op: 'moveSection', section: 'records', toIndex: 0 };
    expect(apply(DEFAULT_NAV_PREFS, star, section)).toEqual(apply(DEFAULT_NAV_PREFS, section, star));
  });

  it('turns a drop among the shown items into an index among all of them, hidden ones keeping their places', () => {
    const hidden = apply(DEFAULT_NAV_PREFS, { op: 'hide', kind: 'object', id: COMPANIES });
    const entries = sectionItems(hidden, universe, 'records');
    // Shown: People, Deals. Dropping Deals first lands it before People.
    const toIndex = moveIndexFor(entries, `object:${DEALS}`, 0);
    expect(ids(apply(hidden, { op: 'move', kind: 'object', id: DEALS, toIndex }), 'records')).toEqual([
      DEALS,
      PEOPLE,
      COMPANIES,
    ]);
    const last = moveIndexFor(entries, `object:${PEOPLE}`, 1);
    expect(ids(apply(hidden, { op: 'move', kind: 'object', id: PEOPLE, toIndex: last }), 'records')).toEqual([
      COMPANIES,
      DEALS,
      PEOPLE,
    ]);
  });

  it('prunes ids that point at nothing (AC-940)', () => {
    const starred = apply(
      DEFAULT_NAV_PREFS,
      { op: 'star', kind: 'view', id: VIEW },
      { op: 'star', kind: 'record', id: RECORD },
    );
    const pruned = pruneNavItems(starred, (item) => item.id !== RECORD);
    expect(pruned.items).toEqual([{ kind: 'view', id: VIEW, pinned: true }]);
    expect(pruneNavItems(pruned, () => true)).toBe(pruned);
  });
});

describe('the operation schema', () => {
  it('takes a page by its key and anything else by its id', () => {
    expect(NavOp.safeParse({ op: 'hide', kind: 'page', id: 'forms' }).success).toBe(true);
    expect(NavOp.safeParse({ op: 'hide', kind: 'page', id: 'trash' }).success).toBe(false);
    expect(NavOp.safeParse({ op: 'hide', kind: 'object', id: 'people' }).success).toBe(false);
    expect(NavOp.safeParse({ op: 'move', kind: 'object', id: PEOPLE, toIndex: 2 }).success).toBe(true);
    expect(NavOp.safeParse({ op: 'star', kind: 'object', id: PEOPLE }).success).toBe(false);
    expect(NavOp.safeParse({ op: 'erase' }).success).toBe(false);
  });
});
