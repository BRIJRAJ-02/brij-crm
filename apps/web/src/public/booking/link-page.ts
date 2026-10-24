// The link page's blocks as `/<handle>` draws them (spec 0051): each public block mapped onto the library's
// LinkPage block, and any kind this bundle doesn't know skipped, so a page with a newer kind of block still draws
// everything else. A booking page block opens `/<handle>/<slug>`; a link opens its owner's address as stored.
import type { PublicProfileItem } from '@crm/data/booking';
import type { LinkPageBlock } from '@crm/ui/public-booking';
import { strings } from './strings.ts';

/** The blocks of one page of a profile, in order, as LinkPage draws them. */
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
      default:
        // A kind this bundle was built before: skipped, never a crash.
        return [];
    }
  });
}
