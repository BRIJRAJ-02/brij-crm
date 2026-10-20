// `@crm/contracts/navigation` (spec 0034): the sidebar's item model, a
// member's stored choices (`NavPrefs`) and the one pure function that applies
// a change to them (`applyNavOp`), with no Zod, so the engine (under the row
// lock) and the browser's data layer (optimistically, before the answer) run
// the same rule and agree on the result.
//
// The order of a section is the order of its items in `prefs.items`, then the
// items it may show that the member never placed, in their default order (the
// workspace's object order, the Scheduling pages' order). What a section may
// show is the `NavUniverse`: the server builds it through the access door, and
// the browser from what the door already let it hold. An item stored for
// something the member can't read today keeps its place in the row (it comes
// back when access returns, AC-939); only an id that points at nothing at all
// is pruned (AC-940).

/** The sections that fold, reorder and hold items, in their default order. */
export const NAV_SECTIONS = ['favourites', 'records', 'lists', 'scheduling'] as const;
/** One of the sidebar's sections. */
export type NavSectionKey = (typeof NAV_SECTIONS)[number];

/** Inbox and Tasks, above the sections. */
export const NAV_TOP_PAGES = ['inbox', 'tasks'] as const;
/** The Scheduling section's pages, in their default order (AC-928). */
export const NAV_SCHEDULING_PAGES = ['bookings', 'availability', 'booking_pages', 'forms'] as const;
/** Every page the sidebar may store a choice for. Fixed items (Trash, Settings) are never stored. */
export const NAV_PAGES = [...NAV_TOP_PAGES, ...NAV_SCHEDULING_PAGES] as const;
/** A page the sidebar stores choices for. */
export type NavPage = (typeof NAV_PAGES)[number];

/** What a stored item points at (spec 0034, the item model). */
export const NAV_ITEM_KINDS = ['page', 'object', 'list', 'view', 'record'] as const;
/** What a stored item points at. */
export type NavItemKind = (typeof NAV_ITEM_KINDS)[number];

/** The kinds a member may star: favourites hold views and records only. */
export const NAV_STARRABLE_KINDS = ['view', 'record'] as const;
/** The kinds a member may hide: pages, objects and lists (a favourite is unstarred instead). */
export const NAV_HIDEABLE_KINDS = ['page', 'object', 'list'] as const;

/** The most favourites a member keeps (AC-934). */
export const MAX_NAV_FAVOURITES = 50;
/** The most items one stored row holds (spec 0034, data model). */
export const MAX_NAV_ITEMS = 400;

/** The refusal for the 51st favourite (AC-934), with code `NAV_LIMIT`. */
export const NAV_FAVOURITES_LIMIT_MESSAGE = `You have ${String(MAX_NAV_FAVOURITES)} favourites. Remove one first.`;
/** The refusal for a row past `MAX_NAV_ITEMS`, with code `NAV_LIMIT`. */
export const NAV_ITEMS_LIMIT_MESSAGE = 'Your sidebar holds as many items as it can. Reset it, or unstar some, first.';

/** One stored item: its kind and id, starred (`pinned`), hidden. Order in the array is the order in its section. */
export interface NavItemPref {
  readonly kind: NavItemKind;
  readonly id: string;
  readonly pinned?: boolean;
  readonly hidden?: boolean;
}

/** The order of the sections and which are folded. */
export interface NavSectionPrefs {
  readonly order: readonly NavSectionKey[];
  readonly folded: readonly NavSectionKey[];
}

/** A member's stored sidebar in one workspace (`member_nav_prefs`), or the defaults when they have none. */
export interface NavPrefs {
  readonly items: readonly NavItemPref[];
  readonly sections: NavSectionPrefs;
  /** The 48px rail (AC-935). */
  readonly rail: boolean;
}

/** What a member with nothing stored sees (AC-936): every section open in the default order, nothing hidden. */
export const DEFAULT_NAV_PREFS: NavPrefs = {
  items: [],
  sections: { order: NAV_SECTIONS, folded: [] },
  rail: false,
};

/** One change to the stored sidebar (AC-938): small, so two tabs changing different things both keep theirs. */
export type NavOperation =
  | {
      readonly op: 'move';
      readonly kind: NavItemKind;
      readonly id: string;
      /** Its place among the section's items, hidden ones included (`sectionItems`), after the move. */
      readonly toIndex: number;
    }
  | { readonly op: 'hide'; readonly kind: NavItemKind; readonly id: string }
  | { readonly op: 'show'; readonly kind: NavItemKind; readonly id: string }
  | { readonly op: 'star'; readonly kind: 'view' | 'record'; readonly id: string }
  | { readonly op: 'unstar'; readonly kind: 'view' | 'record'; readonly id: string }
  | { readonly op: 'fold'; readonly section: NavSectionKey; readonly folded: boolean }
  | { readonly op: 'moveSection'; readonly section: NavSectionKey; readonly toIndex: number }
  | { readonly op: 'rail'; readonly on: boolean }
  | { readonly op: 'reset' };

/** The names of the operations, for the contract's union. */
export const NAV_OPS = ['move', 'hide', 'show', 'star', 'unstar', 'fold', 'moveSection', 'rail', 'reset'] as const;

/**
 * What the sidebar may show the member, by section, in default order: built
 * through the access door, so nothing here is something they can't read.
 * `favourites` holds the starred views and records that resolve (readable,
 * live), keyed `kind:id`.
 */
export interface NavUniverse {
  /** Inbox and Tasks, where those features exist. */
  readonly top: readonly NavPage[];
  /** Readable live objects, in the workspace's order. */
  readonly records: readonly string[];
  /** Readable lists (#51), in the workspace's order. */
  readonly lists: readonly string[];
  /** The Scheduling pages the member's role may open (none for a guest). */
  readonly scheduling: readonly NavPage[];
  /** `view:<id>` and `record:<id>` of starred items that resolve. */
  readonly favourites: ReadonlySet<string>;
}

/** The universe with nothing in it but the pages, before anything is known. */
export const EMPTY_NAV_UNIVERSE: NavUniverse = {
  top: [],
  records: [],
  lists: [],
  scheduling: [],
  favourites: new Set(),
};

/** An item's key in sets and maps: `kind:id`. */
export const navKey = (item: { readonly kind: NavItemKind; readonly id: string }): string => `${item.kind}:${item.id}`;

/** The section a stored item belongs to; Inbox and Tasks sit above the sections (`top`). */
export function sectionOf(item: { readonly kind: NavItemKind; readonly id: string }): NavSectionKey | 'top' {
  switch (item.kind) {
    case 'view':
    case 'record':
      return 'favourites';
    case 'object':
      return 'records';
    case 'list':
      return 'lists';
    case 'page':
      return (NAV_TOP_PAGES as readonly string[]).includes(item.id) ? 'top' : 'scheduling';
  }
}

/** One item of a section as the sidebar draws it: what it points at, and whether the member hid it. */
export interface NavEntry {
  readonly kind: NavItemKind;
  readonly id: string;
  readonly hidden: boolean;
}

/** A section's default items: what the universe holds for it, in its order. */
function defaultsOf(universe: NavUniverse, section: NavSectionKey | 'top'): readonly NavEntry[] {
  const page = (id: string): NavEntry => ({ kind: 'page', id, hidden: false });
  switch (section) {
    case 'top':
      return universe.top.map(page);
    case 'scheduling':
      return universe.scheduling.map(page);
    case 'records':
      return universe.records.map((id) => ({ kind: 'object', id, hidden: false }));
    case 'lists':
      return universe.lists.map((id) => ({ kind: 'list', id, hidden: false }));
    case 'favourites':
      return [];
  }
}

/** Whether a stored item resolves in the universe (something the member may see today). */
function resolves(universe: NavUniverse, item: NavItemPref): boolean {
  switch (item.kind) {
    case 'view':
    case 'record':
      return item.pinned === true && universe.favourites.has(navKey(item));
    case 'object':
      return universe.records.includes(item.id);
    case 'list':
      return universe.lists.includes(item.id);
    case 'page':
      return universe.top.includes(item.id as NavPage) || universe.scheduling.includes(item.id as NavPage);
  }
}

/**
 * A section's items in the member's order, hidden ones included (the
 * Customise dialog lists them; the sidebar leaves them out): the stored ones
 * that resolve, in stored order, then the ones never placed, in default
 * order. Favourites are only the starred items that resolve.
 */
export function sectionItems(prefs: NavPrefs, universe: NavUniverse, section: NavSectionKey | 'top'): NavEntry[] {
  const stored = prefs.items.filter((item) => sectionOf(item) === section && resolves(universe, item));
  const seen = new Set(stored.map(navKey));
  const placed = stored.map((item): NavEntry => ({ kind: item.kind, id: item.id, hidden: item.hidden === true }));
  const rest = defaultsOf(universe, section).filter((entry) => !seen.has(navKey(entry)));
  return [...placed, ...rest];
}

/** The section order: the stored one, any section it misses at the end, each once. */
export function sectionOrder(prefs: NavPrefs): NavSectionKey[] {
  const order = prefs.sections.order.filter(
    (key, index, all) => NAV_SECTIONS.includes(key) && all.indexOf(key) === index,
  );
  return [...order, ...NAV_SECTIONS.filter((key) => !order.includes(key))];
}

/** A refusal `applyNavOp` gives: the code the API answers with, and its sentence. */
export interface NavRefusal {
  readonly code: 'NAV_LIMIT' | 'CONFIG_INVALID';
  readonly message: string;
}

/** What `applyNavOp` answers: the new choices, or why the change can't be made. */
export type NavApplied =
  { readonly ok: true; readonly prefs: NavPrefs } | { readonly ok: false; readonly refusal: NavRefusal };

const clamp = (value: number, max: number) => Math.min(Math.max(Math.trunc(value), 0), Math.max(max, 0));

const matches = (kind: NavItemKind, id: string) => (item: NavItemPref) => item.kind === kind && item.id === id;

/** An item with only the flags it carries, so a shown item stores no `hidden: false`. */
function itemOf(
  kind: NavItemKind,
  id: string,
  flags: { readonly pinned?: boolean; readonly hidden?: boolean },
): NavItemPref {
  return {
    kind,
    id,
    ...(flags.pinned === true ? { pinned: true } : {}),
    ...(flags.hidden === true ? { hidden: true } : {}),
  };
}

/**
 * The row with `section`'s items stored in `ordered` (its resolvable items,
 * flags kept), then what it stores that doesn't resolve today, in stored
 * order, so an item the member can't read comes back where it was.
 */
function storeSection(prefs: NavPrefs, section: NavSectionKey | 'top', ordered: readonly NavEntry[]): NavPrefs {
  const storedOf = new Map(prefs.items.map((item) => [navKey(item), item]));
  const placed = ordered.map((entry) => {
    const stored = storedOf.get(navKey(entry));
    return itemOf(entry.kind, entry.id, { pinned: stored?.pinned === true, hidden: entry.hidden });
  });
  const placedKeys = new Set(placed.map(navKey));
  const unresolved = prefs.items.filter((item) => sectionOf(item) === section && !placedKeys.has(navKey(item)));
  const others = prefs.items.filter((item) => sectionOf(item) !== section);
  return { ...prefs, items: [...others, ...placed, ...unresolved] };
}

/** The row with `item` placed in its section at `toIndex`, materialising that section's order. */
function moveWithin(prefs: NavPrefs, universe: NavUniverse, kind: NavItemKind, id: string, toIndex: number): NavPrefs {
  const section = sectionOf({ kind, id });
  const entries = sectionItems(prefs, universe, section);
  const from = entries.findIndex((entry) => entry.kind === kind && entry.id === id);
  const moving = entries[from];
  if (moving === undefined) return prefs;
  const without = entries.filter((_, index) => index !== from);
  const at = clamp(toIndex, without.length);
  return storeSection(prefs, section, [...without.slice(0, at), moving, ...without.slice(at)]);
}

/**
 * The row with `item`'s hidden flag set. An item never placed has its
 * section's order stored first, so hiding it moves nothing; one that doesn't
 * resolve is stored at its section's end.
 */
function setHidden(prefs: NavPrefs, universe: NavUniverse, kind: NavItemKind, id: string, hidden: boolean): NavPrefs {
  const found = prefs.items.find(matches(kind, id));
  if (found === undefined) {
    if (!hidden) return prefs;
    const section = sectionOf({ kind, id });
    const entries = sectionItems(prefs, universe, section);
    if (!entries.some((entry) => entry.kind === kind && entry.id === id)) {
      return { ...prefs, items: [...prefs.items, itemOf(kind, id, { hidden: true })] };
    }
    const ordered = entries.map((entry) =>
      entry.kind === kind && entry.id === id ? { ...entry, hidden: true } : entry,
    );
    return storeSection(prefs, section, ordered);
  }
  if ((found.hidden === true) === hidden) return prefs;
  return {
    ...prefs,
    items: prefs.items.map((item) =>
      item === found ? itemOf(kind, id, { pinned: item.pinned === true, hidden }) : item,
    ),
  };
}

/**
 * The member's choices with one change applied (AC-938): pure, so the engine
 * runs it under the row lock and the browser runs it before the answer, and
 * both reach the same row. `universe` says what each section may show, which
 * a move indexes into. Refuses (never throws) a favourite past
 * `MAX_NAV_FAVOURITES` or a row past `MAX_NAV_ITEMS` (`NAV_LIMIT`), and
 * hiding or starring a kind that can't be (`CONFIG_INVALID`). A change that
 * changes nothing answers the same row.
 */
export function applyNavOp(prefs: NavPrefs, op: NavOperation, universe: NavUniverse): NavApplied {
  const ok = (next: NavPrefs): NavApplied => {
    if (next.items.length > MAX_NAV_ITEMS && next.items.length > prefs.items.length) {
      return { ok: false, refusal: { code: 'NAV_LIMIT', message: NAV_ITEMS_LIMIT_MESSAGE } };
    }
    return { ok: true, prefs: next };
  };
  const invalid = (message: string): NavApplied => ({ ok: false, refusal: { code: 'CONFIG_INVALID', message } });
  switch (op.op) {
    case 'move':
      return ok(moveWithin(prefs, universe, op.kind, op.id, op.toIndex));
    case 'hide':
    case 'show':
      if (!(NAV_HIDEABLE_KINDS as readonly string[]).includes(op.kind)) {
        return invalid('Only pages, objects and lists can be hidden. Remove a favourite instead.');
      }
      return ok(setHidden(prefs, universe, op.kind, op.id, op.op === 'hide'));
    case 'star': {
      if (!(NAV_STARRABLE_KINDS as readonly string[]).includes(op.kind))
        return invalid('Only views and records can be favourites.');
      if (prefs.items.some((item) => matches(op.kind, op.id)(item) && item.pinned === true)) return ok(prefs);
      const starred = prefs.items.filter((item) => item.pinned === true).length;
      if (starred >= MAX_NAV_FAVOURITES) {
        return { ok: false, refusal: { code: 'NAV_LIMIT', message: NAV_FAVOURITES_LIMIT_MESSAGE } };
      }
      // A new favourite goes last among the favourites.
      return ok({
        ...prefs,
        items: [
          ...prefs.items.filter((item) => !matches(op.kind, op.id)(item)),
          itemOf(op.kind, op.id, { pinned: true }),
        ],
      });
    }
    case 'unstar':
      return ok({ ...prefs, items: prefs.items.filter((item) => !matches(op.kind, op.id)(item)) });
    case 'fold': {
      const isFolded = prefs.sections.folded.includes(op.section);
      if (isFolded === op.folded) return ok(prefs);
      const folded = op.folded
        ? [...prefs.sections.folded, op.section]
        : prefs.sections.folded.filter((key) => key !== op.section);
      return ok({ ...prefs, sections: { ...prefs.sections, folded } });
    }
    case 'moveSection': {
      const order = sectionOrder(prefs).filter((key) => key !== op.section);
      const at = clamp(op.toIndex, order.length);
      return ok({
        ...prefs,
        sections: { ...prefs.sections, order: [...order.slice(0, at), op.section, ...order.slice(at)] },
      });
    }
    case 'rail':
      return ok(prefs.rail === op.on ? prefs : { ...prefs, rail: op.on });
    case 'reset':
      // Back to the default order, nothing hidden and every section open; favourites (and their order) and the
      // rail are the member's own choices, which the Customise dialog doesn't show, so they stay.
      return ok({
        items: prefs.items
          .filter((item) => item.pinned === true)
          .map((item) => itemOf(item.kind, item.id, { pinned: true })),
        sections: DEFAULT_NAV_PREFS.sections,
        rail: prefs.rail,
      });
  }
}

/**
 * The `toIndex` a move takes when the member drops an item at `visibleIndex`
 * among the section's shown (not hidden) items: hidden items keep their
 * places, and the item lands next to the shown item it was dropped beside.
 */
export function moveIndexFor(entries: readonly NavEntry[], key: string, visibleIndex: number): number {
  const shown = entries.filter((entry) => !entry.hidden);
  const fromShown = shown.findIndex((entry) => navKey(entry) === key);
  if (fromShown < 0) return entries.findIndex((entry) => navKey(entry) === key);
  const rest = shown.filter((_, index) => index !== fromShown);
  const at = clamp(visibleIndex, rest.length);
  const without = entries.filter((entry) => navKey(entry) !== key);
  const before = rest[at - 1];
  const after = rest[at];
  if (before !== undefined) return without.findIndex((entry) => navKey(entry) === navKey(before)) + 1;
  if (after !== undefined) return without.findIndex((entry) => navKey(entry) === navKey(after));
  return 0;
}

/** The items whose ids `exists` says point at something: a purged view or record is dropped (AC-940). */
export function pruneNavItems(prefs: NavPrefs, exists: (item: NavItemPref) => boolean): NavPrefs {
  const items = prefs.items.filter(exists);
  return items.length === prefs.items.length ? prefs : { ...prefs, items };
}
