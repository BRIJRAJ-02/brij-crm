// A profile's sections (22 Oct 2026): its links grouped under the small headings their owner gave them.
import { profileSections } from '@crm/contracts/handles';
import type { PublicProfileLink } from '@crm/data/booking';

/**
 * The links grouped by their section, in the owner's order: each section where its first link is. Sections compare
 * trimmed and ignoring case, so "Sales", "sales" and "Sales " are one heading, spelled as the first one is. The rule
 * is `profileSections`, the one Settings › Profile's order list uses too.
 */
export function sectionsOf(
  links: readonly PublicProfileLink[],
): readonly { readonly title?: string; readonly links: readonly PublicProfileLink[] }[] {
  return profileSections(links, (link) => link.section).map((section) => ({
    ...(section.title === undefined ? {} : { title: section.title }),
    links: section.items,
  }));
}
