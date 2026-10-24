// Who heads the rail (spec 0037, AC-1339): a personal page's host by name, with
// their account picture from our origin when they have one (23 Oct 2026); a team
// page's faces (initials only, never names) stacked over "Intro call with Acme",
// and named "Team of 6" for screen readers.
import type { PublicBookingPage } from '@crm/data/booking';
import type { BookingHost } from '@crm/ui/public-booking';
import { strings } from './strings.ts';

/**
 * The rail's host. A personal page gets `{ name }`, `image` when the host has a picture (initials if it fails), and
 * `socials` when the page shows the host's social links (booking socials, 25 Oct 2026).
 */
export function railHost(page: Pick<PublicBookingPage, 'hostName' | 'hostImage' | 'team' | 'socials'>): BookingHost {
  if (page.team === undefined) {
    return {
      name: page.hostName,
      ...(page.hostImage === undefined ? {} : { image: page.hostImage }),
      ...(page.socials === undefined || page.socials.length === 0 ? {} : { socials: page.socials }),
    };
  }
  const total = page.team.avatars.length + page.team.more;
  return {
    name: page.hostName,
    team: {
      // Spaced initials ("S L") draw as "SL": the stack takes names, and the page has none to give.
      people: page.team.avatars.map((avatar, index) => ({
        id: `${String(index)}-${avatar.initials}`,
        name: spaced(avatar.initials),
        ...(avatar.image === undefined ? {} : { src: avatar.image }),
      })),
      total,
      label: strings.teamOf(total),
    },
  };
}

/** The rail's title: a team page's names the workspace ("Intro call with Acme"); a personal page's is its own. */
export function railTitle(page: Pick<PublicBookingPage, 'title' | 'hostName' | 'team'>): string {
  return page.team === undefined ? page.title : strings.teamTitle(page.title, page.hostName);
}

/** "SL" as "S L", by grapheme, so the stack's initials come out as the server gave them. */
function spaced(initials: string): string {
  return Array.from(new Intl.Segmenter().segment(initials), (part) => part.segment).join(' ');
}
