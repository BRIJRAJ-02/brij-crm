// What a booking page's card says (Bookings › Pages, the owner's mock of 9 November 2026): one line of facts
// ("45 min · Zoom · Team, taking turns"), who it books with, and the icon of its kind. Pure, from what the list and
// the groups already hold.
import type { BookingPageView, RotationView } from '@crm/data';
import type { IconName } from '@crm/ui';
import { providerOf } from '../bookings/provider.ts';
import { strings as bookingsStrings } from '../bookings/strings.ts';
import { strings } from './strings.ts';
import { followsEveryone } from './team-readiness.ts';

/** Where the meeting happens, in a word or two: the video provider by its link, else the kind of place. */
export function placeWord(location: BookingPageView['location']): string {
  if (location.type === 'video') {
    const provider = location.link === undefined ? undefined : providerOf(location.link);
    return provider === undefined || provider === bookingsStrings.providers.other ? strings.pageCard.video : provider;
  }
  return strings.pageCard.place[location.type];
}

/** What kind of page it is, as the card says it: the workspace link, a team page, or a one-on-one. */
export function kindWord(page: BookingPageView, rotations: readonly Pick<RotationView, 'id' | 'follows'>[]): string {
  if (followsEveryone(page, rotations)) return strings.workspaceLink;
  return strings.pageCard.kind[page.kind];
}

/** The card's one line of facts: its lengths, where, and its kind. */
export function cardFacts(
  page: BookingPageView,
  rotations: readonly Pick<RotationView, 'id' | 'follows'>[],
): readonly string[] {
  return [
    ...(page.durations.length === 0 ? [] : [strings.minutesChoice(page.durations)]),
    placeWord(page.location),
    kindWord(page, rotations),
  ];
}

/** The icon of a page's kind on its card's tile. */
export function cardIcon(page: BookingPageView, rotations: readonly Pick<RotationView, 'id' | 'follows'>[]): IconName {
  if (followsEveryone(page, rotations)) return 'globe';
  if (page.kind === 'round_robin') return 'refresh-cw';
  if (page.kind === 'collective') return 'users';
  return 'user';
}

/** One face on a card. */
export interface CardPerson {
  readonly id: string;
  readonly name: string;
}

/**
 * Who a page books with: a team page's people (its groups' members who are on, then its fixed hosts the groups
 * name), a colleague's page its owner, the reader's own page the reader. Undefined while it can't be said (a team
 * page whose groups the reader can't see).
 */
export function cardPeople(
  page: BookingPageView,
  rotations: readonly Pick<RotationView, 'id' | 'follows' | 'members'>[],
  me: CardPerson | undefined,
): { readonly people: readonly CardPerson[]; readonly label: string } | undefined {
  if (page.kind === 'personal') {
    if (page.ownerName !== undefined) {
      return { people: [{ id: page.ownerMemberId, name: page.ownerName }], label: page.ownerName };
    }
    return me === undefined ? undefined : { people: [me], label: me.name };
  }
  if (page.hosts === undefined) return undefined;
  const linked = page.hosts.rotations.flatMap((id) => {
    const found = rotations.find((rotation) => rotation.id === id);
    return found === undefined ? [] : [found];
  });
  const named = new Map<string, string>();
  for (const rotation of rotations) {
    for (const member of rotation.members) named.set(member.memberId, member.name);
  }
  const seen = new Set<string>();
  const people: CardPerson[] = [];
  const add = (id: string) => {
    const name = named.get(id);
    if (name === undefined || seen.has(id)) return;
    seen.add(id);
    people.push({ id, name });
  };
  for (const id of page.hosts.fixed) add(id);
  for (const rotation of linked) {
    for (const member of rotation.members) if (member.isOn) add(member.memberId);
  }
  if (people.length === 0) return undefined;
  const first = people[0];
  if (followsEveryone(page, rotations)) return { people, label: strings.pageCard.everyone(people.length) };
  return {
    people,
    label: people.length === 1 && first !== undefined ? first.name : strings.pageCard.hosts(people.length),
  };
}
