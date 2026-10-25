// The link page's blocks as `/<handle>` draws them (spec 0051): each public block mapped onto the library's
// LinkPage block, and any kind this bundle doesn't know skipped, so a page with a newer kind of block still draws
// everything else. A booking page block opens `/<handle>/<slug>`; a link opens its owner's address as stored; the
// contact card downloads its vCard.
import type { PublicProfileItem } from '@crm/data/booking';
import type { LinkPageBlock } from '@crm/ui/public-booking';
import { strings } from './strings.ts';

/** The blocks of one page of a profile, in order, as LinkPage draws them. A contact card shows its full name. */
export function blocksOf(handle: string, items: readonly PublicProfileItem[]): readonly LinkPageBlock[] {
  return items.flatMap((item): LinkPageBlock[] => {
    switch (item.kind) {
      case 'link':
        return [
          {
            kind: 'link',
            id: item.id,
            title: item.title,
            href: item.url,
            hue: item.hue,
            ...(item.note === undefined ? {} : { note: item.note }),
            ...(item.mark === undefined ? {} : { mark: item.mark }),
            ...(item.icon === undefined ? {} : { icon: item.icon }),
          },
        ];
      case 'heading':
        return [{ kind: 'heading', id: item.id, title: item.title }];
      case 'text':
        return [
          { kind: 'text', id: item.id, body: item.body, ...(item.title === undefined ? {} : { title: item.title }) },
        ];
      case 'form':
        // Our own origin, in the same tab: an ordinary navigation, no frame and no new policy (AC-5215).
        return [{ kind: 'form', id: item.id, title: item.title, href: `/f/${encodeURIComponent(item.key)}` }];
      case 'faq':
        return [
          {
            kind: 'faq',
            id: item.id,
            items: item.items,
            ...(item.title === undefined ? {} : { title: item.title }),
          },
        ];
      case 'page':
        return [
          {
            kind: 'page',
            id: item.id,
            title: item.title,
            href: `/${encodeURIComponent(handle)}/${encodeURIComponent(item.slug)}`,
            facts: [
              ...item.durations.map((minutes) => strings.minutesShort(minutes)),
              ...(item.isTeam ? [strings.team] : []),
            ].join(' · '),
          },
        ];
      case 'contact': {
        const line = [item.jobTitle, item.company].filter((part) => part !== undefined && part !== '').join(' · ');
        return [
          {
            kind: 'contact',
            id: item.id,
            title: item.fullName,
            ...(line === '' ? {} : { line }),
            // The card as a vCard, from the api on this origin: a plain link a phone offers to add (AC-5115).
            href: `/api/public/handles/${encodeURIComponent(handle)}/contact.vcf`,
          },
        ];
      }
      default:
        // A kind this bundle was built before: skipped, never a crash.
        return [];
    }
  });
}
