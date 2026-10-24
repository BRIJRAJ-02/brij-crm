// A profile's sections (22 Oct 2026): its links grouped under the small headings their owner gave them, and never
// across workspaces (owner ask, 24 Oct 2026).
import { profileSections } from '@crm/contracts/handles';
import type { PublicProfileLink } from '@crm/data/booking';

/** One card of a profile: its React key, its heading (none for links without one), and its links. */
export interface ProfileCard {
  /** The link's workspace group and section key: unique on the page. */
  readonly key: string;
  readonly title?: string;
  readonly links: readonly PublicProfileLink[];
}

/**
 * The links as cards, in the owner's order: first by workspace (each `group` where its first link is), then by
 * section inside it (each section where its first link is). Pages from two workspaces never share a card, even
 * under the same heading or with none. Sections compare trimmed and ignoring case, so "Sales", "sales" and "Sales "
 * are one heading, spelled as the first one is: the rule is `profileSections`, the one Settings › Profile's order
 * list uses too. Links read on a later page join their group's cards, so a group continues across pages.
 *
 * With pages from more than one workspace, the cards with no heading come first, one per workspace, then the headed
 * ones: a headless card under another workspace's heading would read as part of that section. With one workspace,
 * the cards stand exactly as Settings › Profile arranged them.
 */
export function sectionsOf(links: readonly PublicProfileLink[]): readonly ProfileCard[] {
  const groups = new Map<string, PublicProfileLink[]>();
  for (const link of links) {
    const group = groups.get(link.group);
    if (group === undefined) groups.set(link.group, [link]);
    else group.push(link);
  }
  const cards = [...groups].flatMap(([group, members]) =>
    profileSections(members, (link) => link.section).map((section): ProfileCard => ({
      key: `${group}:${section.key}`,
      ...(section.title === undefined ? {} : { title: section.title }),
      links: section.items,
    })),
  );
  if (groups.size < 2) return cards;
  return [...cards.filter((card) => card.title === undefined), ...cards.filter((card) => card.title !== undefined)];
}
