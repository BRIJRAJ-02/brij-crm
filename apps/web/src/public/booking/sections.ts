// A profile's sections (22 Oct 2026): its links grouped under the small headings their owner gave them.
import type { PublicProfileLink } from '@crm/data/booking';

/**
 * The links grouped by their section, in the owner's order: each section where its first link is. Sections compare
 * trimmed and ignoring case, so "Sales", "sales" and "Sales " are one heading, spelled as the first one is.
 */
export function sectionsOf(
  links: readonly PublicProfileLink[],
): readonly { readonly title?: string; readonly links: readonly PublicProfileLink[] }[] {
  const groups = new Map<string, { title?: string; links: PublicProfileLink[] }>();
  for (const link of links) {
    const title = link.section?.trim() ?? '';
    const key = title.toLocaleLowerCase();
    const group = groups.get(key) ?? { ...(title === '' ? {} : { title }), links: [] };
    group.links.push(link);
    groups.set(key, group);
  }
  return [...groups.values()];
}
