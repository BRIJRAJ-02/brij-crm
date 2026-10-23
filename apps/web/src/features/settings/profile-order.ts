// Settings › Profile's order (owner ask A102): which pages a person's profile lists from this workspace, under which
// sections, and the whole order a move sends. Plain functions, no React.
import { profileSections, type ProfileSection } from '@crm/contracts/handles';
import type { BookingPageView } from '@crm/data';

/** A page's place as the server orders a profile: by position, then by id (UUIDs compare as their text does). */
function byPlace(left: BookingPageView, right: BookingPageView): number {
  if (left.profilePosition !== right.profilePosition) return left.profilePosition - right.profilePosition;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The pages this person's profile lists from here, in its order: their own Public pages, live or paused (a paused
 * page is hidden from visitors but keeps its place). Link only pages are never listed, and a colleague's page an
 * admin sees here is the colleague's to place.
 */
export function profilePagesOf(pages: readonly BookingPageView[], memberId: string): readonly BookingPageView[] {
  return pages.filter((page) => page.ownerMemberId === memberId && !page.isPrivate).sort(byPlace);
}

/** The profile's sections, each where its first page is: the rule `/<handle>` draws with (`profileSections`). */
export function profileGroupsOf(pages: readonly BookingPageView[]): readonly ProfileSection<BookingPageView>[] {
  return profileSections(pages, (page) => page.profileSection);
}

/** The whole order the sections stand in: each section's pages in turn, which a move sends. */
export function orderOf(groups: readonly ProfileSection<BookingPageView>[]): readonly string[] {
  return groups.flatMap((group) => group.items.map((page) => page.id));
}

/** The list with the item at `from` taken to `to`; the same list when either is out of range. */
function moved<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

/** The order with one page at `toIndex` within its own section; a page moves only inside its section. */
export function withPageMoved(
  groups: readonly ProfileSection<BookingPageView>[],
  pageId: string,
  toIndex: number,
): readonly string[] {
  return orderOf(
    groups.map((group) => {
      const from = group.items.findIndex((page) => page.id === pageId);
      return from < 0 ? group : { ...group, items: moved(group.items, from, toIndex) };
    }),
  );
}

/** The order with the section keyed `key` at `toIndex` among the sections, its pages going with it. */
export function withSectionMoved(
  groups: readonly ProfileSection<BookingPageView>[],
  key: string,
  toIndex: number,
): readonly string[] {
  return orderOf(
    moved(
      groups,
      groups.findIndex((group) => group.key === key),
      toIndex,
    ),
  );
}

/**
 * An order wanted earlier, fitted to the pages there are now (Try again after a refusal): pages gone since are left
 * out, and pages that came since go after the rest, in the order they have.
 */
export function fittedOrder(wanted: readonly string[], current: readonly string[]): readonly string[] {
  const now = new Set(current);
  const kept = wanted.filter((id) => now.has(id));
  const placed = new Set(kept);
  return [...kept, ...current.filter((id) => !placed.has(id))];
}

/** What a section is called in the list's ids: its key after a prefix, since the pages with none have key "". */
export const sectionId = (key: string) => `section:${key}`;

/** The key a section's list id holds, or undefined for an id that isn't a section's. */
export const sectionKeyOf = (id: string): string | undefined =>
  id.startsWith('section:') ? id.slice('section:'.length) : undefined;
