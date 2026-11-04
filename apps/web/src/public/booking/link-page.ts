// The link page's blocks as `/<handle>` draws them (spec 0051): each public block mapped onto the library's
// LinkPage block, and any kind this bundle doesn't know skipped, so a page with a newer kind of block still draws
// everything else. A booking page block opens `/<handle>/<slug>`; a link opens its owner's address as stored; the
// contact card downloads its vCard.
import type { PublicProfileItem, PublicSocialLink } from '@crm/data/booking';
import type { LinkPageBlock, LinkPageTimes } from '@crm/ui/public-booking';
import { strings } from './strings.ts';

/** The parts a look's path takes, as the api makes them (`lookStylesheetPath` in contracts). */
const LOOK_VERSION = /^[0-9a-f]{12}$/;
const LOOK_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A link page's own stylesheet (spec 0060, AC-14), or undefined when it has none or a part is malformed. Here, not
 * beside `wearStylesheet`, so the booking page and the form never carry it.
 */
export function lookHref(handle: string, version: string | undefined): string | undefined {
  if (version === undefined || !LOOK_VERSION.test(version) || !LOOK_HANDLE.test(handle) || handle.length > 40) {
    return undefined;
  }
  return `/api/public/handles/${handle}/look.css?v=${version}`;
}

/** What the page knows beside its blocks: the person's own social links, and the times each times block has read. */
export interface BlocksContext {
  /** The person's social links (AC-6104): the socials block draws this same set, wherever the owner put it. */
  readonly socials?: readonly PublicSocialLink[];
  /** Each times block's next open times by its id (AC-6110); absent is not read yet, and the block asks. */
  readonly times?: ReadonlyMap<string, LinkPageTimes>;
}

/** The blocks of one page of a profile, in order, as LinkPage draws them. A contact card shows its full name. */
export function blocksOf(
  handle: string,
  items: readonly PublicProfileItem[],
  context: BlocksContext = {},
): readonly LinkPageBlock[] {
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
            ...(item.siteIcon === undefined ? {} : { siteIcon: item.siteIcon }),
            // Its picture, its card and its notice (spec 0061, AC-6101, AC-6102, AC-6113), each drawn by the library.
            ...(item.thumb === undefined ? {} : { thumb: item.thumb }),
            ...(item.style === undefined ? {} : { style: item.style }),
            ...(item.notice === undefined ? {} : { notice: item.notice }),
            ...(item.size === undefined ? {} : { size: item.size }),
          },
        ];
      case 'testimonial':
        return [
          {
            kind: 'testimonial',
            id: item.id,
            quote: item.quote,
            author: item.author,
            ...(item.role === undefined ? {} : { role: item.role }),
          },
        ];
      case 'heading':
        return [
          {
            kind: 'heading',
            id: item.id,
            title: item.title,
            ...(item.group === undefined ? {} : { group: item.group }),
          },
        ];
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
            ...(item.size === undefined ? {} : { size: item.size }),
          },
        ];
      case 'socials': {
        // The person's own set, as a block wherever they put it (AC-6104). With none, the block simply isn't drawn.
        const links = context.socials ?? [];
        return links.length === 0 ? [] : [{ kind: 'socials', id: item.id, links }];
      }
      case 'media':
        // The frame's address comes from the server, built from the parsed provider and id (AC-6106): nothing here
        // touches what was pasted, and nothing is asked of the provider until Play (AC-6127).
        return [
          {
            kind: 'media',
            id: item.id,
            provider: item.provider,
            title: item.title,
            frame: item.frame,
            ...(item.poster === undefined ? {} : { poster: item.poster }),
            ...(item.size === undefined ? {} : { size: item.size }),
          },
        ];
      case 'image':
        return [
          {
            kind: 'image',
            id: item.id,
            image: item.image,
            alt: item.alt,
            ...(item.caption === undefined ? {} : { caption: item.caption }),
            ...(item.url === undefined ? {} : { href: item.url }),
            ...(item.size === undefined ? {} : { size: item.size }),
          },
        ];
      case 'gallery':
        return [
          {
            kind: 'gallery',
            id: item.id,
            images: item.images,
            display: item.display,
            ...(item.size === undefined ? {} : { size: item.size }),
          },
        ];
      case 'times': {
        // The booking page in the same tab, as a page block opens it (AC-6110); each chip adds `?at=` and `&len=`.
        const read = context.times?.get(item.id);
        return [
          {
            kind: 'times',
            id: item.id,
            title: item.title,
            href: `/${encodeURIComponent(handle)}/${encodeURIComponent(item.slug)}`,
            duration: item.duration,
            ...(read === undefined ? {} : { times: read }),
          },
        ];
      }
      case 'banner':
        return [
          { kind: 'banner', id: item.id, text: item.text, ...(item.url === undefined ? {} : { href: item.url }) },
        ];
      // A place's guest menu with its first dishes, and its reservation page (spec 0065, AC-6528): our own paths.
      case 'menu':
        return [{ kind: 'menu', id: item.id, title: item.title, href: item.path, dishes: item.dishes }];
      case 'reserve':
        return [{ kind: 'reserve', id: item.id, title: item.title, href: item.path }];
      case 'contact': {
        const line = [item.jobTitle, item.company].filter((part) => part !== undefined && part !== '').join(' · ');
        return [
          {
            kind: 'contact',
            id: item.id,
            title: item.fullName,
            ...(line === '' ? {} : { line }),
            // The card as a vCard, from the api on this origin: a plain link a phone offers to add (AC-5115).
            // `card` names which of the page's cards this is (AC-6114); an older link with none still answers the first.
            href: `/api/public/handles/${encodeURIComponent(handle)}/contact.vcf?card=${encodeURIComponent(item.id)}`,
          },
        ];
      }
      default:
        // A kind this bundle was built before: skipped, never a crash.
        return [];
    }
  });
}

/** A `utm_source` as the page sends it (spec 0061, AC-6116), as `sourceFact` keeps it: the server checks it again. */
const SOURCE = /^[a-z0-9_.-]+$/;
/** The longest `utm_source` and referring host sent, as the figures keep them. */
const SOURCE_MAX = 60;
const REFERRER_MAX = 120;

/** The two facts the page itself knows about a view: the referring site's host and the `utm_source`. */
export interface ViewFacts {
  readonly ref?: string;
  readonly src?: string;
}

/**
 * What a counted view carries from the page (AC-6116): the referring site's **host** only, never the whole address
 * and never a path, and the `utm_source` as it is kept. Our own origin, a referrer that names no web host, and a
 * source outside its shape are all left out, which the server reads as `Direct` and as no source. The country and
 * the device are the server's own; nothing else about the visitor is sent, and nothing is stored in this browser.
 */
export function viewFactsOf(input: {
  readonly referrer: string;
  readonly search: string;
  readonly origin: string;
}): ViewFacts {
  let host: string | undefined;
  try {
    const url = new URL(input.referrer);
    // Our own site is `Direct`, by the name without `www.`: the marketing site and the handle pages are one site
    // (`www.timefix.com` and `timefix.com`), and a visit from one to the other is not a referral.
    const bare = (name: string) => name.toLowerCase().replace(/^www\./, '');
    const own = bare(new URL(input.origin).hostname);
    const found = url.hostname.toLowerCase();
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      bare(found) !== own &&
      found.length <= REFERRER_MAX
    ) {
      host = found;
    }
  } catch {
    // No referrer, or one that is no web address (an `android-app:` referrer): the view is `Direct`.
  }
  const given = new URLSearchParams(input.search).get('utm_source')?.trim().toLowerCase() ?? '';
  const src = given.length >= 1 && given.length <= SOURCE_MAX && SOURCE.test(given) ? given : undefined;
  return { ...(host === undefined ? {} : { ref: host }), ...(src === undefined ? {} : { src }) };
}

/**
 * What the tab's session holds, and all it holds (AC-6127): a banner this visitor closed, and the noticed links
 * they said Continue to. No cookie, no address, nothing about the visitor. Storage that is missing or refuses
 * simply keeps nothing, and the page draws as a first visit.
 */
export type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Where a closed banner is kept: by the block's id, so a new banner shows again. */
const bannerKey = (id: string) => `crm.banner.${id}`;
/** Where the links a visitor said Continue to are kept, for one page. */
const noticeKey = (handle: string) => `crm.notice.${handle}`;

/** Whether this visitor closed this banner in this tab (AC-6112). */
export function isBannerClosed(storage: VisitStorage | undefined, id: string): boolean {
  try {
    return storage?.getItem(bannerKey(id)) === '1';
  } catch {
    return false;
  }
}

/** Keeps a closed banner for the tab's session. */
export function keepClosedBanner(storage: VisitStorage | undefined, id: string): void {
  try {
    storage?.setItem(bannerKey(id), '1');
  } catch {
    // Storage refused: the banner stays closed for this page only, which is this visit.
  }
}

/** The noticed links this visitor already said Continue to in this tab (AC-6113). */
export function continuedNotices(storage: VisitStorage | undefined, handle: string): readonly string[] {
  try {
    const kept = storage?.getItem(noticeKey(handle)) ?? '';
    return kept === '' ? [] : kept.split(' ').filter((id) => id !== '');
  } catch {
    return [];
  }
}

/** Keeps one more continued notice, and answers the whole set. */
export function keepContinuedNotice(storage: VisitStorage | undefined, handle: string, id: string): readonly string[] {
  const next = [...new Set([...continuedNotices(storage, handle), id])];
  try {
    storage?.setItem(noticeKey(handle), next.join(' '));
  } catch {
    // Storage refused: the link opens, and this visit asks again if it comes back to it.
  }
  return next;
}
