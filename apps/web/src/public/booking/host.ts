// Who heads the rail (spec 0037, AC-1339): a personal page's host by name, with
// their account picture from our origin when they have one (23 Oct 2026); a team
// page's faces (initials only, never names) stacked over "Intro call with Acme",
// and named "Team of 6" for screen readers.
import type { PublicBookingPage } from '@crm/data/booking';
import type { BookingHost, PageBrand } from '@crm/ui/public-booking';
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

/** A booking page's public key and an image version, as the brand routes take them. */
const PAGE_KEY = /^[A-Za-z0-9_-]{16}$/;
const IMAGE_VERSION = /^[0-9a-f]{12}$/;

/**
 * The workspace's logo at the head of the rail (spec 0060, AC-4), from our own origin's `logo?v=` route, when the
 * page's facts name one. Decoration beside the host's name, so it reads as nothing. The accent needs nothing here:
 * the page's brand stylesheet sets it.
 */
export function railBrand(page: Pick<PublicBookingPage, 'publicKey' | 'brand'>): { readonly brand?: PageBrand } {
  const version = page.brand?.logo;
  if (version === undefined || !PAGE_KEY.test(page.publicKey) || !IMAGE_VERSION.test(version)) return {};
  return { brand: { logo: { src: `/api/public/booking/${page.publicKey}/logo?v=${version}`, alt: '' } } };
}
