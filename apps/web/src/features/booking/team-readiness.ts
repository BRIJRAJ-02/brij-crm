// Whether a team page can take a booking, as far as its hosts say (6 November 2026): the owner saw "Live" on a page
// nobody could book. Pure, from what the editor and the list already hold; a page's open times are a separate read.
import type { BookingPageView, RotationView } from '@crm/data';

/** Who a team page's hosts come to: fixed hosts, plus who is switched on in its groups. */
export interface TeamOnPage<Group> {
  /** People who can be booked now. */
  readonly onCount: number;
  /** Groups the reader can see on the page, in the page's order. */
  readonly groups: readonly Group[];
  /** The reader can't see every group on the page, so a count of nobody proves nothing. */
  readonly isPartial: boolean;
}

/** Who a team page books right now, read from its hosts and the groups the reader can see. */
export function teamOnPage<Group extends Pick<RotationView, 'id' | 'members'>>(
  page: Pick<BookingPageView, 'hosts'>,
  rotations: readonly Group[],
): TeamOnPage<Group> {
  const linked = page.hosts?.rotations ?? [];
  const fixed = page.hosts?.fixed ?? [];
  const groups = linked.flatMap((id) => {
    const found = rotations.find((rotation) => rotation.id === id);
    return found === undefined ? [] : [found];
  });
  const on = new Set([
    ...fixed,
    ...groups.flatMap((group) => group.members.filter((member) => member.isOn).map((member) => member.memberId)),
  ]);
  return { onCount: on.size, groups, isPartial: groups.length < linked.length };
}

/**
 * A team page nobody can be booked on: no fixed host, and nobody on in any group. False for any other page, and while
 * the groups aren't all readable: an unknown is never said as a fault.
 */
export function hasNoHostsOn(
  page: Pick<BookingPageView, 'kind' | 'hosts'>,
  rotations: readonly Pick<RotationView, 'id' | 'members'>[] | undefined,
): boolean {
  // Hosts are absent for whoever may only see the page: they can't know, so nothing is said.
  if (page.kind !== 'round_robin' || rotations === undefined || page.hosts === undefined) return false;
  const { onCount, isPartial } = teamOnPage(page, rotations);
  return onCount === 0 && !isPartial;
}

/**
 * The page books "Everyone on the roster" and nothing else: the workspace's link, as against a team page that books
 * one named group. Every round robin page has workspace scope now, so scope alone doesn't say which it is.
 */
export function followsEveryone(
  page: Pick<BookingPageView, 'scope' | 'hosts'>,
  rotations: readonly Pick<RotationView, 'id' | 'follows'>[],
): boolean {
  if (page.scope !== 'workspace') return false;
  // A member reads no hosts: a workspace page is the link to copy, as they have always read it.
  if (page.hosts === undefined) return true;
  const roster = rotations.find((rotation) => rotation.follows === 'everyone');
  const { fixed, rotations: linked } = page.hosts;
  return roster !== undefined && fixed.length === 0 && linked.length === 1 && linked[0] === roster.id;
}
