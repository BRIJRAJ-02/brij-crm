// The sidebar's model on screen (spec 0034): where each page it links to lives and how it is named, what each
// section may show the member (`universeOf`, from what the data layer already let them see), and the sections
// in the member's order. Plain functions with no React, so the route walking test (AC-944) reads the very list
// the frame draws.
import type { NavEntry, NavPage, NavPrefs, NavSectionKey, NavState, NavUniverse, ObjectSummary } from '@crm/data';
import { navKey, sectionItems, sectionOrder } from '@crm/data/navigation';
import type { IconName } from '@crm/ui';
import { bookingsHref, capturesHref, inboxHref, navObjects, tasksHref } from './objects.ts';
import { strings } from './strings.ts';

/** A page the sidebar marks current that isn't an object's: Tasks, Bookings, Captures and the trash. */
export type SidebarPage = 'home' | 'inbox' | 'tasks' | 'bookings' | 'captures' | 'trash';

/** One page the sidebar links to: its name, its icon and its address. */
export interface SidebarPageLink {
  readonly label: string;
  readonly icon: IconName;
  readonly href: (slug: string) => string;
}

/**
 * The pages the sidebar can link to today, by key (AC-924, AC-928). Each address names the page itself, never an
 * address that redirects, so a pointer resting on the item preloads that page's code and data. Inbox joins once
 * notifications (#28) exist; until then the server never offers it.
 */
export const PAGE_LINKS: { readonly [Page in NavPage]?: SidebarPageLink } = {
  // The inbox (spec 0038) had a page and an unread count but no row, so a mention reached nobody (QA, 22 October 2026).
  inbox: { label: strings.inbox, icon: 'inbox', href: inboxHref },
  tasks: { label: strings.tasks, icon: 'square-check', href: tasksHref },
  bookings: { label: strings.bookings, icon: 'calendar-days', href: bookingsHref },
  captures: { label: strings.captures, icon: 'link', href: capturesHref },
};

/** Each section's title. */
export const SECTION_TITLES: Readonly<Record<NavSectionKey, string>> = {
  favourites: strings.favourites,
  records: strings.records,
  lists: strings.lists,
  scheduling: strings.scheduling,
};

/** The member's stored choices out of their sidebar state, for the pure rule. */
export const prefsOf = (nav: NavState): NavPrefs => ({
  items: nav.items,
  sections: nav.sections,
  rail: nav.rail,
});

/**
 * What the member's sidebar may show (the same universe the server's rule indexes into): their live objects in
 * the workspace's order, the pages they have, and the favourites the server resolved for them.
 */
export function universeOf(objects: readonly ObjectSummary[] | undefined, nav: NavState): NavUniverse {
  return {
    top: nav.top,
    records: objects === undefined ? [] : navObjects(objects).map((object) => object.id),
    lists: [],
    scheduling: nav.scheduling,
    favourites: new Set(nav.favourites.map(navKey)),
  };
}

/** One section as the frame draws it: its key, its items in order (hidden ones included), and whether it is folded. */
export interface DrawnSection {
  readonly key: NavSectionKey;
  readonly title: string;
  readonly entries: readonly NavEntry[];
  readonly isFolded: boolean;
}

/**
 * The sections the sidebar draws, in the member's order: Records always (it has loading and empty states of its
 * own), Scheduling while the member has its pages (AC-928; never for a guest), Lists once lists exist (AC-927),
 * and Favourites once the member has starred something (AC-925).
 */
export function drawnSections(nav: NavState, universe: NavUniverse): DrawnSection[] {
  const prefs = prefsOf(nav);
  return sectionOrder(prefs).flatMap((key): DrawnSection[] => {
    const entries = sectionItems(prefs, universe, key);
    if (key !== 'records' && entries.length === 0) return [];
    return [{ key, title: SECTION_TITLES[key], entries, isFolded: prefs.sections.folded.includes(key) }];
  });
}

/** The pages above the sections (Tasks, and Inbox once it exists) in the member's order, hidden ones included. */
export const topEntries = (nav: NavState, universe: NavUniverse): NavEntry[] =>
  sectionItems(prefsOf(nav), universe, 'top');

/**
 * The `toIndex` a section move takes when the member drops it at `visibleIndex` among the sections drawn: next to
 * the drawn section it was dropped beside, the sections not drawn (empty Favourites, Lists) keeping their places.
 */
export function sectionMoveIndex(
  order: readonly NavSectionKey[],
  drawn: readonly NavSectionKey[],
  key: NavSectionKey,
  visibleIndex: number,
): number {
  const rest = drawn.filter((each) => each !== key);
  const remaining = order.filter((each) => each !== key);
  const at = Math.min(Math.max(visibleIndex, 0), rest.length);
  const before = rest[at - 1];
  const after = rest[at];
  if (before !== undefined) return remaining.indexOf(before) + 1;
  if (after !== undefined) return remaining.indexOf(after);
  return 0;
}
