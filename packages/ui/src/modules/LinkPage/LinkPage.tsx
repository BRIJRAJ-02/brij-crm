import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';
// The link page's font packs (spec 0060, AC-12): faces the browser fetches only once text is drawn in them.
import '@crm/tokens/packs.css';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Disclosure, DisclosureGroup } from '../../molecules/Disclosure/Disclosure.tsx';
import { SocialLinks, type SocialLinkItem } from '../../molecules/SocialLinks/SocialLinks.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Reveal } from '../../atoms/Reveal/Reveal.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { usePageVariables, type PageVariables } from '../../lib/page-variables.ts';
import { initialsOf } from '../../lib/stable-hue.ts';
import type { PageTemplate } from '../../lib/page-template.ts';
import styles from './LinkPage.module.css';
// Types only: erased, so none of these chunks joins the first load.
import type { LinkPageGalleryProps } from './LinkPageGallery.tsx';
import type { LinkPageImageProps } from './LinkPageImage.tsx';
import type { LinkPageMediaProps } from './LinkPageMedia.tsx';
import type { LinkPageNoticeProps } from './LinkPageNotice.tsx';
import type { LinkPageTimesProps } from './LinkPageTimes.tsx';
import type { LinkPageBentoProps, LinkPageCardProps } from './LinkPageCards.tsx';
import { strings } from './strings.ts';

/** A social network whose own mark a link shows (ProviderMark's social marks). */
export type LinkPageMark =
  'linkedin' | 'x' | 'instagram' | 'github' | 'facebook' | 'youtube' | 'angellist' | 'tiktok' | 'threads';

/**
 * A picture as the page draws it (spec 0061, AC-6101, AC-6126): a path on our own origin (`safeImageSrc`), with its
 * size, so its box is held before it loads and nothing moves when it arrives.
 */
export interface LinkPagePicture {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** A tile's size on a grid page (spec 0061, AC-6103): 1 by 1, 2 by 1 or 2 by 2. Absent is `small`. */
export type LinkPageTileSize = 'small' | 'wide' | 'large';

/** What a link asks before it opens (spec 0061, AC-6113): self declared, as `PROFILE_NOTICES` in the contracts. */
export type LinkPageNotice = 'sensitive' | '18' | '21';

/** The services a media block plays from (spec 0061, AC-6105), as `MEDIA_PROVIDERS` in the contracts. */
export type LinkPageMediaProvider = 'youtube' | 'vimeo' | 'spotify' | 'soundcloud' | 'applemusic';

/**
 * A next times block's open times (spec 0061, AC-6110), which the caller reads once the block nears the screen
 * (`onTimesNear`). Absent is not read yet: the block holds its place and asks for them.
 */
export type LinkPageTimes =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly starts: readonly string[] };

/**
 * One block of a link page, as it draws (spec 0051). Each kind has one renderer here (`RENDERERS`); a later kind is
 * one more member of this union and one more renderer, and the page's callers map their data onto it.
 */
export type LinkPageBlock =
  | {
      readonly kind: 'link';
      readonly id: string;
      readonly title: string;
      /** Where it goes: the owner's canonical address, opened in a new tab, never wrapped. */
      readonly href: string;
      readonly note?: string;
      /** The network's own mark, when the address is on one. */
      readonly mark?: LinkPageMark;
      /** Else the Lucide icon the owner picked. */
      readonly icon?: IconName;
      /** Else the site's own icon, from our own origin: the api fetches the favicon and answers it (26 Oct 2026). */
      readonly siteIcon?: string;
      /** Else the title's first letter, on this hue. */
      readonly hue: Hue;
      /**
       * Its picture (spec 0061, AC-6101), ahead of everything above: in the row's tile, across the top of a featured
       * card, and over a grid tile. When it fails to load, the tile falls back to the order above.
       */
      readonly thumb?: LinkPagePicture;
      /** `featured` (AC-6102): the larger card, its picture across the top. Absent is the row. */
      readonly style?: 'row' | 'featured';
      /** A notice the visitor confirms before the link opens (AC-6113). Such a link is `nofollow`. */
      readonly notice?: LinkPageNotice;
      readonly size?: LinkPageTileSize;
    }
  | {
      readonly kind: 'heading';
      readonly id: string;
      readonly title: string;
      /**
       * What the heading does with the blocks under it (spec 0054, AC-5415): `open` is the small heading above
       * them, `folder` is one row a visitor presses to open them. Absent is `open`, and so is a word this build
       * does not know, so a page written by a later build still draws.
       */
      readonly group?: 'open' | 'folder';
    }
  | {
      readonly kind: 'testimonial';
      readonly id: string;
      /** What they said, with its line breaks kept. Never markup: nothing in it is parsed. */
      readonly quote: string;
      readonly author: string;
      /** What they do, under their name, when the owner gave one. */
      readonly role?: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      readonly kind: 'text';
      readonly id: string;
      /** A small heading over the words, when the person gave one. */
      readonly title?: string;
      /** The words themselves, drawn as text with their line breaks kept. Never markup: nothing in it is parsed. */
      readonly body: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      readonly kind: 'faq';
      readonly id: string;
      /** A small heading over the questions; without one the page says "Questions". */
      readonly title?: string;
      /** The questions, in the owner's order, each one a fold that starts closed. All drawn as text. */
      readonly items: readonly { readonly question: string; readonly answer: string }[];
      readonly size?: LinkPageTileSize;
    }
  | {
      readonly kind: 'form';
      readonly id: string;
      /** The owner's own words for the row. */
      readonly title: string;
      /** Where it goes: a path on our own origin (`/f/<key>`), opened in the same tab. */
      readonly href: string;
      /** The line under the title, when the page has one to say. */
      readonly line?: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      readonly kind: 'page';
      readonly id: string;
      readonly title: string;
      /** The booking page's address, `/<handle>/<slug>`, opened in this tab. */
      readonly href: string;
      /** Its lengths and kind, said once: "30 min · 60 min · Team". */
      readonly facts: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** The person's social links as one row of marks, wherever the owner put it (spec 0061, AC-6104). */
      readonly kind: 'socials';
      readonly id: string;
      readonly links: readonly SocialLinkItem[];
      readonly size?: LinkPageTileSize;
    }
  | {
      /**
       * A video or a song behind its facade (spec 0061, AC-6106): nothing loads from the provider until Play. `frame`
       * is the player's address the server built from the parsed provider and id; one on any other origin never
       * becomes a frame.
       */
      readonly kind: 'media';
      readonly id: string;
      readonly provider: LinkPageMediaProvider;
      readonly title: string;
      readonly frame: string;
      readonly poster?: LinkPagePicture;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** One picture (spec 0061, AC-6108), its alt text required, with an optional caption and link. */
      readonly kind: 'image';
      readonly id: string;
      readonly image: LinkPagePicture;
      readonly alt: string;
      readonly caption?: string;
      /** Where pressing the picture goes: a web address, opened in a new tab. */
      readonly href?: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** Two to twelve pictures (spec 0061, AC-6109), a swipe row or a grid, each opening large in a viewer. */
      readonly kind: 'gallery';
      readonly id: string;
      readonly images: readonly (LinkPagePicture & { readonly alt: string })[];
      readonly display: 'row' | 'grid';
      readonly size?: LinkPageTileSize;
    }
  | {
      /** A booking page's next open times as chips (spec 0061, AC-6110). */
      readonly kind: 'times';
      readonly id: string;
      readonly title: string;
      /** The booking page's address, `/<handle>/<slug>`: More times, and each chip with `?at=` and `&len=`. */
      readonly href: string;
      /** The length the chips are for, in minutes. */
      readonly duration: number;
      readonly times?: LinkPageTimes;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** One line at the very top of the page (spec 0061, AC-6112), with an optional link, closed for the visit. */
      readonly kind: 'banner';
      readonly id: string;
      readonly text: string;
      readonly href?: string;
    }
  | {
      readonly kind: 'contact';
      readonly id: string;
      /** The card's full name. */
      readonly title: string;
      /** The job title and company, said once: "Cofounder · Timefix". */
      readonly line?: string;
      /**
       * The card as a vCard on this site, `/api/public/handles/<handle>/contact.vcf`: a plain link, so Save contact
       * works with no script and from a QR code, and a phone offers to add it to its contacts.
       */
      readonly href: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /**
       * The profile card (spec 0068, AC-6808): the page's own face and name, its one line (the bio when it has none),
       * and Book (the page's `book`, else its first booking page) with the page's Share beside it.
       */
      readonly kind: 'profile';
      readonly id: string;
      readonly line?: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** "Available for work" (AC-6808): a green dot while `open`, a quiet one while `away`. */
      readonly kind: 'status';
      readonly id: string;
      readonly text: string;
      readonly state: 'open' | 'away';
      readonly size?: LinkPageTileSize;
    }
  | {
      /**
       * A short audio intro (AC-6808): the recording on our own origin, its title and the waveform drawn in the
       * owner's browser (48 bars, each `0` to `v`). Nothing loads but its metadata until Play.
       */
      readonly kind: 'audio';
      readonly id: string;
      readonly src: string;
      readonly title?: string;
      readonly wave?: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** An experience timeline (AC-6808): when, what and where, in the owner's order. */
      readonly kind: 'timeline';
      readonly id: string;
      readonly title?: string;
      readonly items: readonly { readonly when: string; readonly title: string; readonly place?: string }[];
      readonly size?: LinkPageTileSize;
    }
  | {
      /** Client logos (AC-6808), drifting sideways, each named by its alt text. */
      readonly kind: 'logos';
      readonly id: string;
      readonly title?: string;
      readonly images: readonly (LinkPagePicture & { readonly alt: string })[];
      readonly size?: LinkPageTileSize;
    }
  | {
      /** Work cards (AC-6808): a picture, a title and two lines, each opening its link in a new tab when it has one. */
      readonly kind: 'work';
      readonly id: string;
      readonly title?: string;
      readonly items: readonly {
        readonly image?: LinkPagePicture;
        readonly title: string;
        readonly body?: string;
        readonly href?: string;
      }[];
      readonly size?: LinkPageTileSize;
    }
  | {
      /** How I work (AC-6808): numbered steps, one shown at a time, switched by a segmented control. */
      readonly kind: 'steps';
      readonly id: string;
      readonly title?: string;
      readonly items: readonly { readonly title: string; readonly body: string }[];
      readonly size?: LinkPageTileSize;
    }
  | {
      /** A location (AC-6808): its name, the address and Directions (the map search the server built). */
      readonly kind: 'location';
      readonly id: string;
      readonly title?: string;
      readonly address: string;
      readonly directions: string;
      readonly size?: LinkPageTileSize;
    }
  | {
      /** Next events (AC-6808): the ones still to come by the page's clock, soonest first. */
      readonly kind: 'events';
      readonly id: string;
      readonly title?: string;
      readonly items: readonly {
        readonly title: string;
        readonly at: string;
        readonly place?: string;
        readonly href?: string;
      }[];
      readonly size?: LinkPageTileSize;
    };

/** The person at the top of the page. */
export interface LinkPagePerson {
  readonly name: string;
  /** What the avatar's colour is keyed on when there is no picture (their handle). */
  readonly id: string;
  readonly image?: string;
  readonly bio?: string;
  /** Their job title, under their name, when they show it. */
  readonly role?: string;
}

/** Who the page belongs to, above the person: the company's logo and name, linking to its site. */
export interface LinkPageBrand {
  readonly name: string;
  /** The company's own site; an address `safeHref` refuses draws the lockup with no link. */
  readonly href: string;
  /** The logo, on the page's own origin; the name stands alone without one. */
  readonly logo?: string;
}

/** Props for LinkPage. */
export interface LinkPageProps {
  /** Missing while the page loads: the hero draws as a skeleton. */
  readonly person?: LinkPagePerson;
  /** Missing while the page loads: block shaped skeletons hold their places. */
  readonly blocks?: readonly LinkPageBlock[];
  /** The company the page belongs to, drawn above the person; nothing when absent. */
  readonly brand?: LinkPageBrand;
  /** One line of the owner's, drawn above `foot` and never in its place. */
  readonly footLine?: string;
  /**
   * The page's own address, shown under the bio as a pill that copies it: the label is the address a visitor reads
   * ("timefix.com/ada"), the value what the clipboard gets (the whole address, scheme and all).
   */
  readonly address?: { readonly label: string; readonly value: string };
  /**
   * Beside Save contact: the page's own Share control, passed in because sharing is the caller's (the Web Share
   * API on the public page, the Share modal in the editor), and this module touches neither.
   */
  readonly share?: ReactNode;
  /**
   * Under the actions: the page as an Apple Wallet pass, `/api/public/handles/<handle>/pass.pkpass` on this site. A
   * plain link, like Save contact, so it needs no script and a phone opens Wallet straight from it. Left out where
   * the page draws without one (the editor's preview, which shows no Share either).
   */
  readonly walletHref?: string;
  /** Under the actions: the person's social icons row (their own set, never a block). */
  readonly socials?: ReactNode;
  /**
   * Whether the place is open, worded by the caller ("Open now · until 6 PM"), under the name (spec 0068, Split's
   * identity panel). Left out when the hours aren't known, and then nothing is said.
   */
  readonly openNow?: string;
  /**
   * The page's Book (spec 0068, Split's identity panel): a primary button under the name, its words and a path on
   * this site ("/acme/intro-call"). Anything but our own path draws no button.
   */
  readonly book?: { readonly label: string; readonly href: string };
  /** Above the blocks: a search, once there are many. */
  readonly toolbar?: ReactNode;
  /** Over the blocks, said once: how many a search matched ("3 matches"). Read out as it changes. */
  readonly summary?: string;
  /** In place of the blocks when there are none: an EmptyState. */
  readonly empty?: ReactNode;
  /**
   * Quiet placeholder rows after the blocks (27 October 2026), for a preview of a page its owner is still making:
   * they say what the page will hold without pretending anything is on it yet. Decoration, out of the
   * accessibility tree, and never drawn on the page itself — only where `caption` can say what they are.
   */
  readonly ghosts?: number;
  /**
   * The folded section a visitor has open, by its heading's id (AC-5417). One at a time: the address holds exactly
   * one, so the back button closes the section it opened and a shared link opens the section it names. Left out,
   * the page keeps the open one itself, which is what the editor's preview and the stories want.
   */
  readonly openFolder?: string;
  /**
   * Said when a folded section opens or closes, with the open one's id or nothing. Passing it makes the caller the
   * keeper of that state, which is how the public page puts it in the address.
   */
  readonly onOpenFolder?: (id: string | undefined) => void;
  /** After the blocks: a refusal's Callout, Show more. */
  readonly after?: ReactNode;
  /**
   * Under everything: the public page's BookingFoot ("Powered by Timefix", Claim your free page). A slot rather than
   * drawn here, so the app's editor, which draws this page too, never shares the booking page's frame with the
   * public bundle (a module both import is split into a chunk of its own, and its CSS from the page's first load).
   */
  readonly foot?: ReactNode;
  /**
   * Drawn inside the editor's phone (`PreviewLayout`): a plain region rather than the page's `main`, the height its
   * content takes, and inert, so a press never leaves the editor.
   */
  readonly isPreview?: boolean;
  /**
   * `page` (the default) draws the whole page; `blocks` draws only the blocks, inert, with no person and no foot: an
   * editor's "How it looks" for the one block being typed.
   */
  readonly layout?: 'page' | 'blocks';
  /** With `layout="blocks"`: a small caption naming what the blocks show ("How it looks"). */
  readonly caption?: string;
  /** A visitor pressed a block (a press counter's beacon). Never holds up the navigation. */
  readonly onPress?: (id: string) => void;
  /**
   * The look its owner picked (spec 0054, widened by spec 0060): ten names, which become data attributes on this
   * root, and one block of this module's stylesheet each. No value is passed and no CSS is made at run time.
   * Missing while the page loads, so the loading state draws on the plain ground in the visitor's own light or dark
   * and the look lands with the content, in one step (AC-5413). `layout="blocks"` draws the one block being typed
   * on the look's own ground (spec 0060, AC-16).
   */
  readonly theme?: PageLook;
  /**
   * Which photos the page has (spec 0060, AC-10, AC-13): a photo ground without one draws as `plain`, and a cover
   * header without one as `centred`, so a look never draws an empty band. The photos themselves arrive as
   * `--page-cover-image` and `--page-ground-image`, from the page's own stylesheet or `variables`.
   */
  readonly photos?: LinkPagePhotos;
  /**
   * The page's own values, for the app's previews (spec 0060, AC-7): the accent's custom properties from
   * `brandProperties()` and the photos' `url()`s, set on this root. The live page leaves it out, since its own
   * stylesheet (`look.css`) sets the same names. Anything but those names, a checked hex or our own api is dropped.
   */
  readonly variables?: PageVariables;
  /**
   * How the blocks lay out (spec 0061, AC-6103): `list` (the default) is one column of rows; `grid` draws the sized
   * kinds as tiles on 2 columns, 4 where the blocks have the room, in the owner's order exactly (no dense packing),
   * with every other kind across the whole row.
   */
  readonly pageLayout?: 'list' | 'grid';
  /** A next times block neared the screen with no times yet (AC-6110): the caller reads them, once. */
  readonly onTimesNear?: (id: string) => void;
  /**
   * The banner was closed this visit (AC-6112). With `onCloseBanner`, the caller keeps it (the public page, in the
   * tab's session); without, the page holds it itself.
   */
  readonly isBannerClosed?: boolean;
  readonly onCloseBanner?: () => void;
  /**
   * The noticed links a visitor already said Continue to this visit (AC-6113): they open at once. With
   * `onContinueNotice`, the caller keeps them (the public page, in the tab's session); without, the page does.
   */
  readonly continuedNotices?: readonly string[];
  readonly onContinueNotice?: (id: string) => void;
}

/** Which of its two photos a link page has. */
export interface LinkPagePhotos {
  readonly cover?: boolean;
  readonly ground?: boolean;
}

/**
 * A page's look as this module takes it: the ten names of `PageTheme` in `@crm/contracts`, repeated here because
 * the library never imports the contracts (its own rule). `page-theme.test.ts` fails if the two drift apart.
 */
export interface PageLook {
  readonly ground: 'plain' | 'paper' | 'tint' | 'ink' | 'gradient' | 'pattern' | 'image';
  readonly hue: Hue;
  readonly mode: 'light' | 'dark' | 'system';
  readonly shape: 'soft' | 'pill' | 'square';
  readonly fill: 'plain' | 'soft' | 'outline' | 'solid';
  readonly font: 'sans' | 'mono' | 'grotesk' | 'editorial' | 'classic' | 'friendly' | 'geometric' | 'display';
  readonly gradient: 'dawn' | 'dusk' | 'mint' | 'ocean' | 'peach' | 'grape' | 'sand' | 'graphite';
  readonly pattern: 'dots' | 'grid' | 'lines' | 'waves';
  readonly header: 'centred' | 'cover' | 'left';
  readonly avatar: 'circle' | 'rounded' | 'none';
  /**
   * The template the page wears (spec 0068, AC-6801): set, it fixes the ground, mode, shape, fill, font and header
   * (`PAGE_TEMPLATE_LOOKS`), whatever the other keys hold, and its own blocks of this module's stylesheet draw the
   * rest (Studio's warm ground, Night's glow, Split's two columns). Left out, the ten keys draw as they always did.
   */
  readonly template?: PageTemplate;
}

/**
 * What each template fixes of the look (spec 0068, AC-6801, AC-6802), as `TEMPLATE_LOOKS` in `@crm/contracts`
 * holds it; `page-theme.test.ts` keeps the two the same.
 */
export const PAGE_TEMPLATE_LOOKS = {
  classic: { ground: 'plain', mode: 'system', shape: 'soft', fill: 'plain', font: 'grotesk', header: 'centred' },
  studio: { ground: 'paper', mode: 'light', shape: 'pill', fill: 'plain', font: 'editorial', header: 'cover' },
  night: { ground: 'ink', mode: 'dark', shape: 'soft', fill: 'plain', font: 'geometric', header: 'centred' },
  split: { ground: 'plain', mode: 'system', shape: 'soft', fill: 'plain', font: 'sans', header: 'left' },
} as const satisfies Record<PageTemplate, Pick<PageLook, 'ground' | 'mode' | 'shape' | 'fill' | 'font' | 'header'>>;

/** A look as it draws: a template's fixed names over the stored ones, and an avatar a template never hides. */
export function drawnLook(look: PageLook): PageLook {
  if (look.template === undefined) return look;
  return {
    ...look,
    ...PAGE_TEMPLATE_LOOKS[look.template],
    avatar: look.avatar === 'none' ? 'circle' : look.avatar,
  };
}

/**
 * The header a drawn look wears (spec 0068, AC-6802): a cover the page has no photo for draws `centred`, and Classic
 * and Night, whose cover is optional, wear the cover header exactly when the page has one (Classic's band a modest
 * one, Night's the usual), their own centred header otherwise.
 */
function headerOf(look: PageLook, hasCover: boolean): PageLook['header'] {
  if (look.template === 'classic' || look.template === 'night') return hasCover ? 'cover' : look.header;
  return look.header === 'cover' && !hasCover ? 'centred' : look.header;
}

/**
 * The attributes a look becomes, and `data-theme`, which pins light or dark for everything inside this root: the
 * token layer only follows the system where no `data-theme` is set, so a visitor's own phone or app choice never
 * decides somebody else's page (AC-5406). `system` (spec 0060, AC-15) is the one mode that sets none, so the page
 * takes the visitor's own. A photo ground the page has no photo for draws as `plain`, and the header is `headerOf`.
 */
function lookAttributes(stored: PageLook | undefined, photos: LinkPagePhotos | undefined) {
  if (stored === undefined) return {};
  const look = drawnLook(stored);
  const ground = look.ground === 'image' && photos?.ground !== true ? 'plain' : look.ground;
  const header = headerOf(look, photos?.cover === true);
  return {
    ...(look.mode === 'system' ? {} : { 'data-theme': look.mode }),
    'data-page-ground': ground,
    'data-page-hue': look.hue,
    'data-page-mode': look.mode,
    'data-page-shape': look.shape,
    'data-page-fill': look.fill,
    'data-page-font': look.font,
    'data-page-gradient': look.gradient,
    'data-page-pattern': look.pattern,
    'data-page-header': header,
    'data-page-avatar': look.avatar,
    ...(look.template === undefined ? {} : { 'data-template': look.template }),
  };
}

/**
 * The photos a thumbnail draws: a gallery tile shows what its look draws once the photos are there, except a cover
 * where it is optional (Classic, Night), which the miniature draws only when the owner's own page has one.
 */
function thumbnailPhotos(look: PageLook, cover: string | undefined): LinkPagePhotos {
  const isOptional = look.template === 'classic' || look.template === 'night';
  return { cover: !isOptional || cover !== undefined, ground: true };
}

/** How many skeleton blocks stand in while the page loads. */
const LOADING_BLOCKS = 5;

/**
 * The blocks in groups: those before the first heading, then each heading with the blocks under it. A contact card
 * never takes a place here: it is the header's Save contact, wherever the owner keeps it in their order (the
 * owner's design, 25 October 2026). A second and third card (spec 0061, AC-6114) take their places as rows, each with
 * its own Save contact. A banner never does either: it draws at the very top (AC-6112).
 */
function groupsOf(blocks: readonly LinkPageBlock[]) {
  const groups: { heading?: Extract<LinkPageBlock, { kind: 'heading' }>; rows: LinkPageBlock[] }[] = [];
  const header = contactOf(blocks);
  for (const block of blocks) {
    if (block === header || block.kind === 'banner') continue;
    if (block.kind === 'heading') groups.push({ heading: block, rows: [] });
    else if (groups.length === 0) groups.push({ rows: [block] });
    else groups.at(-1)?.rows.push(block);
  }
  return groups;
}

/** The page's first booking page as its Book (spec 0068): the words the page says, and the page's own path. */
function bookOf(blocks: readonly LinkPageBlock[] | undefined) {
  const page = blocks?.find((block) => block.kind === 'page');
  return page === undefined || ownPath(page.href) === undefined ? undefined : { label: strings.book, href: page.href };
}

/** The owner's contact card, wherever it sits in their order: the one the header's Save contact downloads. */
function contactOf(blocks: readonly LinkPageBlock[] | undefined) {
  return blocks?.find((block) => block.kind === 'contact');
}

/** A path on this site's own origin, or undefined: what the header's own links are allowed to point at. */
function ownPath(href: string | undefined): string | undefined {
  return href !== undefined && href.startsWith('/') && !/^\/[/\\]/.test(href) ? href : undefined;
}

/**
 * The actions under the person: Save contact, the page's one primary action, when the owner keeps a card, with the
 * caller's Share beside it, and under them Add to Apple Wallet when the caller passes a pass address. Both are plain
 * links to our own origin, so they work with no script and straight from a QR code, and a phone offers to add the
 * card to its contacts or opens Wallet. The wallet takes a row of its own rather than a third place in the first
 * row: at a thumb's size three controls leave no room for its words.
 */
function Actions({
  contact,
  share,
  walletHref,
  onPress,
}: {
  readonly contact: Extract<LinkPageBlock, { kind: 'contact' }> | undefined;
  readonly share: ReactNode;
  readonly walletHref?: string;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  // Only this site's own path: the card and the pass are served by the api, never from elsewhere.
  const href = contact === undefined ? undefined : ownPath(contact.href);
  const wallet = ownPath(walletHref);
  if (href === undefined && share === undefined && wallet === undefined) return null;
  return (
    <div className={styles.actions}>
      {(href !== undefined || share !== undefined) && (
        <div className={styles.actionRow}>
          {href !== undefined && contact !== undefined && (
            <ButtonLink
              variant="primary"
              size="touch"
              icon="contact"
              href={href}
              isFullWidth="center"
              {...(onPress === undefined ? {} : { onPress: () => onPress(contact.id) })}
            >
              {strings.saveContact}
            </ButtonLink>
          )}
          {share}
        </div>
      )}
      {wallet !== undefined && (
        <ButtonLink size="touch" icon="wallet" href={wallet} isFullWidth="center">
          {strings.addToWallet}
        </ButtonLink>
      )}
    </div>
  );
}

/** What kind of address a link holds: a web page (a new tab), or an email, a call or a text (the device's app). */
type LinkScheme = 'web' | 'mail' | 'phone' | 'text';

/**
 * Where a link may go, and as what, or undefined: the library's one href rule (`safeHref`: web, mailto and tel), plus
 * `sms:` with a number, the schemes a link page allows. Anything else (`javascript:`, `data:`) never becomes a link.
 */
function linkTarget(href: string): { readonly href: string; readonly scheme: LinkScheme } | undefined {
  // eslint-disable-next-line no-control-regex -- a control character in an address never becomes a link.
  if (/^sms:\+?\d/i.test(href) && !/[\s\u0000-\u001f]/.test(href)) return { href, scheme: 'text' };
  const safe = safeHref(href);
  if (safe === undefined || safe.startsWith('/')) return undefined;
  if (/^mailto:/i.test(safe)) return { href: safe, scheme: 'mail' };
  if (/^tel:/i.test(safe)) return { href: safe, scheme: 'phone' };
  return { href: safe, scheme: 'web' };
}

/** The icon an email, a call or a text shows, at its tile when none is picked and at its end. */
const SCHEME_ICONS = { mail: 'mail', phone: 'phone', text: 'message-square' } as const;

/**
 * A block's leading tile, the same on the page and in the editor's rows: a link's network mark, its picked icon, an
 * email's, a call's or a text's own icon, or its title's first letter on its hue; a booking page's calendar; a
 * heading's type mark (the editor only). With no block, the tile's place while it loads.
 */
/** The mark the editor's row shows for a block that draws as words on the page rather than as a row. */
const TILE_ICONS = {
  heading: 'type',
  text: 'file-text',
  faq: 'circle-question-mark',
  testimonial: 'message-square',
  // Spec 0061's kinds, each from a mark the registry already holds (no new icon in the first load).
  socials: 'at-sign',
  media: 'play',
  image: 'image',
  gallery: 'layers',
  banner: 'megaphone',
  // Spec 0068's cards (AC-6808), again from marks the registry already holds.
  profile: 'user-round',
  status: 'zap',
  audio: 'mic',
  timeline: 'activity',
  logos: 'building',
  work: 'briefcase',
  steps: 'list-checks',
  location: 'map-pin',
  events: 'calendar-days',
} as const satisfies Record<
  | 'heading'
  | 'text'
  | 'faq'
  | 'testimonial'
  | 'socials'
  | 'media'
  | 'image'
  | 'gallery'
  | 'banner'
  | 'profile'
  | 'status'
  | 'audio'
  | 'timeline'
  | 'logos'
  | 'work'
  | 'steps'
  | 'location'
  | 'events',
  IconName
>;

/** The kinds whose editor row shows a plain mark, since on the page they draw as something other than a row. */
type MarkedKind = keyof typeof TILE_ICONS;

function isMarked(block: LinkPageBlock): block is Extract<LinkPageBlock, { kind: MarkedKind }> {
  return Object.hasOwn(TILE_ICONS, block.kind);
}

export function LinkPageTile({ block }: { readonly block?: LinkPageBlock }) {
  if (block === undefined) {
    return (
      <span className={styles.tile} data-tile="loading">
        <Skeleton shape="fill" />
      </span>
    );
  }
  if (block.kind === 'page' || block.kind === 'times') {
    return (
      <span className={styles.tile} data-tile="page">
        <Icon name="calendar-clock" />
      </span>
    );
  }
  // Writing has no tile on the page, where it is prose; in the editor's rows it takes the same mark a heading does,
  // since there the row is a thing in a list rather than the words themselves.
  if (block.kind === 'form') {
    return (
      <span className={styles.tile} data-tile="page">
        <Icon name="clipboard-list" />
      </span>
    );
  }
  if (isMarked(block)) {
    return (
      <span className={styles.tile} data-tile="icon">
        <Icon name={TILE_ICONS[block.kind]} />
      </span>
    );
  }
  if (block.kind === 'contact') {
    return (
      <span className={styles.tile} data-tile="card">
        <Icon name="id-card" />
      </span>
    );
  }
  if (block.thumb !== undefined) return <ThumbTile block={block} picture={block.thumb} />;
  return <LinkMarkTile block={block} />;
}

/**
 * A link's own picture in its tile (spec 0061, AC-6101), from our origin only. It holds the tile's square whatever
 * the picture's shape, and the moment it fails the tile falls back to the link's mark, icon, site icon or letter,
 * so the page never shows a broken picture.
 */
function ThumbTile({
  block,
  picture,
}: {
  readonly block: Extract<LinkPageBlock, { kind: 'link' }>;
  readonly picture: LinkPagePicture;
}) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const image = safeImageSrc(picture.src);
  if (image === undefined || failed === image) return <LinkMarkTile block={block} />;
  return (
    <span className={styles.tile} data-tile="thumb">
      <img
        className={styles.thumbImage}
        src={image}
        width={picture.width}
        height={picture.height}
        alt={strings.thumbAlt}
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(image);
        }}
      />
    </span>
  );
}

/** A link's tile without its picture: the order every link had before spec 0061. */
function LinkMarkTile({ block }: { readonly block: Extract<LinkPageBlock, { kind: 'link' }> }) {
  if (block.mark !== undefined) {
    return (
      <span className={styles.tile} data-tile="mark">
        <ProviderMark provider={block.mark} size="lg" />
      </span>
    );
  }
  const scheme = linkTarget(block.href)?.scheme;
  const icon = block.icon ?? (scheme === undefined || scheme === 'web' ? undefined : SCHEME_ICONS[scheme]);
  if (icon !== undefined) {
    return (
      <span className={styles.tile} data-tile="icon">
        <Icon name={icon} />
      </span>
    );
  }
  // The site's own icon, which our origin serves (26 October 2026). Below the picked icon and above the letter, so
  // a link to a site with no mark still carries something of that site; it falls back to the letter by itself.
  if (block.siteIcon !== undefined) {
    return <SiteTile src={block.siteIcon} title={block.title} hue={block.hue} />;
  }
  return <LetterTile title={block.title} hue={block.hue} />;
}

/** A block's title as its first letter on its hue: the tile every other one falls back to. */
function LetterTile({ title, hue }: { readonly title: string; readonly hue: Hue }) {
  // The first word's first letter, a whole grapheme (an accent or an emoji stays one).
  const letter = initialsOf(title.trim().split(/\s+/u)[0] ?? '');
  return (
    <span className={styles.tile} data-tile="letter" data-hue={hue} aria-hidden="true">
      {letter}
    </span>
  );
}

/**
 * A link's own site icon, from our origin only (`safeImageSrc`, AC-5110). A site with no icon answers 404 and a
 * great many favicons are broken, so this draws the letter instead the moment the image fails rather than leaving
 * a gap: the page never shows a broken picture. The icon is decorative, since the title beside it says where the
 * link goes.
 */
function SiteTile({ src, title, hue }: { readonly src: string; readonly title: string; readonly hue: Hue }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const image = safeImageSrc(src);
  if (image === undefined || failed === image) return <LetterTile title={title} hue={hue} />;
  return (
    <span className={styles.tile} data-tile="site">
      <img
        className={styles.siteIcon}
        src={image}
        alt={strings.siteIconAlt}
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(image);
        }}
      />
    </span>
  );
}

/** A block's words: its title and the line under it. */
function BlockText({ title, line }: { readonly title: string; readonly line?: string }) {
  return (
    <span className={styles.text}>
      <span className={styles.title}>{title}</span>
      {line !== undefined && line !== '' && <span className={styles.note}>{line}</span>}
    </span>
  );
}

/** A link block, the kind most of spec 0061's choices are about. */
type LinkBlock = Extract<LinkPageBlock, { kind: 'link' }>;

/**
 * What a block several levels down needs from the page, without threading it through every group (spec 0061): how
 * the blocks lay out, whether a noticed link was already continued this visit, the way to ask before one opens, and
 * the times blocks' reader. The default is the editor's: a list, every notice taken as read, nothing to ask.
 */
export interface PageActions {
  readonly layout: 'list' | 'grid';
  readonly isContinued: (id: string) => boolean;
  readonly ask: (block: LinkBlock) => void;
  readonly onTimesNear: ((id: string) => void) | undefined;
  /** Whether this is the live page, where things enter once and presses count (never a preview or a draft). */
  readonly isLive: boolean;
  /** Who the page is, for the profile card (spec 0068, AC-6808): the person, the page's Share and its Book. */
  readonly person: LinkPagePerson | undefined;
  readonly share: ReactNode;
  readonly book: { readonly label: string; readonly href: string } | undefined;
  /** The face's shape the look draws. */
  readonly avatar: 'circle' | 'rounded';
}

/**
 * What the blocks several levels down read from the page. Exported for the lazy bento chunk (`LinkPageCards`) only;
 * the library's index never lists it.
 */
export const PageActionsContext = createContext<PageActions>({
  layout: 'list',
  isContinued: () => true,
  ask: () => undefined,
  onTimesNear: undefined,
  isLive: false,
  person: undefined,
  share: undefined,
  book: undefined,
  avatar: 'circle',
});

/**
 * A noticed link's press (AC-6113): until the visitor said Continue to it this visit, the press opens the notice
 * instead of the link, and counts nothing; the sheet's Continue counts it. Once continued, it opens and counts at once.
 */
function useLinkClick(block: LinkBlock, press: (() => void) | undefined) {
  const actions = useContext(PageActionsContext);
  if (block.notice === undefined || actions.isContinued(block.id)) return { onClick: press, asks: false };
  return {
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      actions.ask(block);
    },
    asks: true,
  };
}

/** A link's `rel`: no referrer, opener or endorsement; `me` only on the person's own profile, never on a noticed link. */
function relOf(block: LinkBlock): string {
  return block.mark === undefined || block.notice !== undefined
    ? 'noopener noreferrer nofollow'
    : 'me noopener noreferrer nofollow';
}

/**
 * A featured link's picture across the top of its card (AC-6102), in a fixed shape so the card is one size whether
 * the picture loads, fails or was never there: without one, the link's own tile sits in the middle of the band.
 */
function FeaturedPicture({ block }: { readonly block: LinkBlock }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const { thumb } = block;
  const image = thumb === undefined ? undefined : safeImageSrc(thumb.src);
  const shown = image === undefined || failed === image || thumb === undefined ? undefined : { image, thumb };
  return (
    <span className={styles.featuredPicture} data-empty={shown === undefined || undefined}>
      {shown === undefined ? (
        <LinkMarkTile block={block} />
      ) : (
        <img
          className={styles.coverImage}
          src={shown.image}
          width={shown.thumb.width}
          height={shown.thumb.height}
          alt={strings.thumbAlt}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(shown.image);
          }}
        />
      )}
    </span>
  );
}

/** A link as a row, or as the larger featured card (AC-6102). */
function LinkRow({ block, onPress }: { readonly block: LinkBlock; readonly onPress: (() => void) | undefined }) {
  const target = linkTarget(block.href);
  const click = useLinkClick(block, onPress);
  const isFeatured = block.style === 'featured';
  const words = <BlockText title={block.title} {...(block.note === undefined ? {} : { line: block.note })} />;
  // An address the rule refuses draws as words, never as a link.
  if (target === undefined) {
    return isFeatured ? (
      <span className={styles.block} data-featured="" data-inert="">
        <FeaturedPicture block={block} />
        <span className={styles.featuredText}>{words}</span>
      </span>
    ) : (
      <span className={styles.block} data-inert="">
        <LinkPageTile block={block} />
        {words}
      </span>
    );
  }
  const isWeb = target.scheme === 'web';
  const end = (
    <span className={styles.end}>
      <Icon name={isWeb ? 'arrow-up-right' : SCHEME_ICONS[target.scheme]} size="sm" />
    </span>
  );
  return (
    <a
      className={styles.block}
      data-featured={isFeatured ? '' : undefined}
      href={target.href}
      onClick={click.onClick}
      // A web page opens in a new tab, with no referrer, no opener and no endorsement. An email, a call or a text
      // opens the device's app, in place; a noticed one is still never endorsed (AC-6113).
      {...(isWeb ? { target: '_blank', rel: relOf(block) } : block.notice === undefined ? {} : { rel: 'nofollow' })}
    >
      {isFeatured ? (
        <>
          <FeaturedPicture block={block} />
          <span className={styles.featuredText}>
            {words}
            {end}
          </span>
        </>
      ) : (
        <>
          <LinkPageTile block={block} />
          {words}
          {end}
        </>
      )}
      {isWeb && <VisuallyHidden>{strings.newTab}</VisuallyHidden>}
      {click.asks && <VisuallyHidden>{strings.asksFirst}</VisuallyHidden>}
    </a>
  );
}

/** A path on our own origin a booking page or form block opens in this tab, or undefined. */
function samePath(href: string): string | undefined {
  return href.startsWith('/') && !/^\/[/\\]/.test(href) ? href : undefined;
}

/** Each kind's one renderer. A block of a kind with none never reaches here: callers skip what they can't map. */
const RENDERERS: {
  readonly [Kind in RowBlock['kind']]: (
    block: Extract<LinkPageBlock, { kind: Kind }>,
    onPress: (() => void) | undefined,
  ) => ReactNode;
} = {
  link: (block, onPress) => <LinkRow block={block} onPress={onPress} />,
  // A Timefix form: a row that opens the form on our own origin, in the same tab. Our page, our policy: no frame,
  // no script from anywhere else, and an ordinary navigation a visitor can come back from (AC-5215).
  form: (block, onPress) => {
    const target = samePath(block.href);
    const body = (
      <>
        <LinkPageTile block={block} />
        <BlockText title={block.title} {...(block.line === undefined ? {} : { line: block.line })} />
      </>
    );
    if (target === undefined) {
      return (
        <span className={styles.block} data-inert="">
          {body}
        </span>
      );
    }
    return (
      <a className={styles.block} href={target} onClick={onPress}>
        {body}
        <span className={styles.end}>
          <Icon name="chevron-right" size="sm" />
        </span>
      </a>
    );
  },
  page: (block, onPress) => {
    const target = samePath(block.href);
    const body = (
      <>
        <LinkPageTile block={block} />
        <BlockText title={block.title} line={block.facts} />
      </>
    );
    if (target === undefined) {
      return (
        <span className={styles.block} data-inert="">
          {body}
        </span>
      );
    }
    return (
      <a className={styles.block} href={target} onClick={onPress}>
        {body}
        <span className={styles.end}>
          <Icon name="chevron-right" size="sm" />
        </span>
      </a>
    );
  },
  // A second or third contact card (spec 0061, AC-6114): a row that saves that card, as the header's Save contact
  // saves the first. A plain link to its vCard on our origin, so it works with no script and a phone offers to add it.
  contact: (block, onPress) => {
    const target = ownPath(block.href);
    const body = (
      <>
        <LinkPageTile block={block} />
        <BlockText title={block.title} {...(block.line === undefined ? {} : { line: block.line })} />
      </>
    );
    if (target === undefined) {
      return (
        <span className={styles.block} data-inert="">
          {body}
        </span>
      );
    }
    return (
      <a className={styles.block} href={target} onClick={onPress}>
        {body}
        <span className={styles.end}>
          <Icon name="download" size="sm" />
        </span>
        <VisuallyHidden>{strings.saveContact}</VisuallyHidden>
      </a>
    );
  },
};

/** A row's card on its own, without the list item: the bento's cell for a form, a contact card or a link row. */
export function RowCard({
  block,
  onPress,
}: {
  readonly block: RowBlock;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  return block.kind === 'link'
    ? RENDERERS.link(block, press)
    : block.kind === 'form'
      ? RENDERERS.form(block, press)
      : block.kind === 'page'
        ? RENDERERS.page(block, press)
        : RENDERERS.contact(block, press);
}

/** One block in its row. */
function BlockRow({
  block,
  onPress,
}: {
  readonly block: RowBlock;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  return (
    <li className={styles.item}>
      {block.kind === 'link'
        ? RENDERERS.link(block, press)
        : block.kind === 'form'
          ? RENDERERS.form(block, press)
          : block.kind === 'page'
            ? RENDERERS.page(block, press)
            : RENDERERS.contact(block, press)}
    </li>
  );
}

/** A block a row draws: a link, a form, a booking page, or a second contact card. */
export type RowBlock = Extract<LinkPageBlock, { kind: 'link' | 'form' | 'page' | 'contact' }>;

/** Spec 0068's cards (AC-6808), drawn by the lazy `LinkPageCards` chunk in a list as on a grid. */
export type CardBlock = Extract<
  LinkPageBlock,
  { kind: 'profile' | 'status' | 'audio' | 'timeline' | 'logos' | 'work' | 'steps' | 'location' | 'events' }
>;

/** Whether a block is one of spec 0068's cards. */
export function isCardBlock(block: LinkPageBlock): block is CardBlock {
  return (
    block.kind === 'profile' ||
    block.kind === 'status' ||
    block.kind === 'audio' ||
    block.kind === 'timeline' ||
    block.kind === 'logos' ||
    block.kind === 'work' ||
    block.kind === 'steps' ||
    block.kind === 'location' ||
    block.kind === 'events'
  );
}

/**
 * A block that is not a row: the person's own words, the questions they answer, something a customer said, and
 * spec 0061's socials row, media, pictures and next times. On a grid page each spans the whole row.
 */
export type ApartBlock = Extract<
  LinkPageBlock,
  { kind: 'text' | 'faq' | 'testimonial' | 'socials' | 'media' | 'image' | 'gallery' | 'times' }
>;

export function isRowBlock(block: LinkPageBlock): block is RowBlock {
  return block.kind === 'link' || block.kind === 'form' || block.kind === 'page' || block.kind === 'contact';
}

/** A group's children in order: each run of rows, and each block that stands apart between them. */
type Run =
  | { readonly kind: 'rows'; readonly key: string; readonly isFirst: boolean; readonly rows: RowBlock[] }
  | { readonly kind: 'apart'; readonly key: string; readonly block: ApartBlock }
  | { readonly kind: 'card'; readonly key: string; readonly block: CardBlock };

/**
 * A list page's runs, in the owner's order exactly: the rows run together and everything else stands apart, so what
 * you see, the reading order and the focus order always match. A grid page draws the whole group as one bento.
 */
function runsOf(blocks: readonly LinkPageBlock[]): Run[] {
  const runs: Run[] = [];
  let isFirst = true;
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'banner') continue;
    const last = runs.at(-1);
    if (isCardBlock(block)) {
      runs.push({ kind: 'card', key: block.id, block });
    } else if (isRowBlock(block)) {
      if (last?.kind === 'rows') last.rows.push(block);
      else {
        runs.push({ kind: 'rows', key: block.id, isFirst, rows: [block] });
        isFirst = false;
      }
    } else {
      runs.push({ kind: 'apart', key: block.id, block });
    }
  }
  return runs;
}

// Media, a picture, a gallery, next times and the notice sheet each load as their own chunk, and only when a block
// of that kind is on the page (spec 0061, AC-6126): the first load holds rows, featured cards, the socials row and
// the banner. Until a chunk arrives, its block holds its own box (`Hold`), so nothing moves when it does.
/**
 * What a block draws when its chunk can't load (an old page asking for a file a newer deploy replaced, a dropped
 * connection): never the route's error, never a hole. Media keeps its title as a plain link to the provider's player,
 * a picture its alt text, a gallery nothing, next times its More times, which still books.
 */
function MediaUnloaded({ block }: LinkPageMediaProps) {
  return (
    <span className={styles.block} data-inert="">
      <LinkPageTile block={block} />
      <BlockText title={block.title} line={strings.cantPlay} />
    </span>
  );
}

function ImageUnloaded({ block }: LinkPageImageProps) {
  return <p className={styles.unloaded}>{block.alt}</p>;
}

function GalleryUnloaded(_: LinkPageGalleryProps) {
  return null;
}

function TimesUnloaded({ block }: LinkPageTimesProps) {
  const href = samePath(block.href);
  return href === undefined ? null : (
    <ButtonLink size="touch" iconRight="arrow-right" href={href}>
      {`${block.title} · ${strings.moreTimes}`}
    </ButtonLink>
  );
}

/** The notice chunk couldn't load: the page stops asking, so a noticed link opens rather than doing nothing. */
function NoticeUnloaded({ onUnavailable }: LinkPageNoticeProps) {
  useEffect(() => {
    onUnavailable?.();
  }, [onUnavailable]);
  return null;
}

// Media, a picture, a gallery, next times and the notice sheet each load as their own chunk, and only when a block
// of that kind is on the page (spec 0061, AC-6126): the first load holds rows, featured cards, the socials row and
// the banner. Until a chunk arrives, its block holds its own box (`LinkPageHold`), so nothing moves when it does.
const LazyMedia = lazy<ComponentType<LinkPageMediaProps>>(() =>
  import('./LinkPageMedia.tsx').then(
    (module) => ({ default: module.LinkPageMedia }),
    () => ({ default: MediaUnloaded }),
  ),
);
const LazyImage = lazy<ComponentType<LinkPageImageProps>>(() =>
  import('./LinkPageGallery.tsx').then(
    (module) => ({ default: module.LinkPageImage }),
    () => ({ default: ImageUnloaded }),
  ),
);
const LazyGallery = lazy<ComponentType<LinkPageGalleryProps>>(() =>
  import('./LinkPageGallery.tsx').then(
    (module) => ({ default: module.LinkPageGallery }),
    () => ({ default: GalleryUnloaded }),
  ),
);
const LazyTimes = lazy<ComponentType<LinkPageTimesProps>>(() =>
  import('./LinkPageTimes.tsx').then(
    (module) => ({ default: module.LinkPageTimes }),
    () => ({ default: TimesUnloaded }),
  ),
);
/** A card whose chunk couldn't load: nothing rather than a hole or the route's error. */
function CardUnloaded(_: LinkPageCardProps) {
  return null;
}

/** A bento whose chunk couldn't load: the group as the list draws it, so every block still opens. */
function BentoUnloaded({ rows, onPress }: LinkPageBentoProps) {
  return (
    <ul className={styles.list}>
      {rows.filter(isRowBlock).map((block) => (
        <BlockRow key={block.id} block={block} onPress={onPress} />
      ))}
    </ul>
  );
}

// Spec 0068's cards and the bento grid (AC-6808): one chunk, loaded only for a page on a grid or with one of the
// new cards, so the booking page's first load carries none of it.
const LazyCard = lazy<ComponentType<LinkPageCardProps>>(() =>
  import('./LinkPageCards.tsx').then(
    (module) => ({ default: module.LinkPageCard }),
    () => ({ default: CardUnloaded }),
  ),
);
const LazyBento = lazy<ComponentType<LinkPageBentoProps>>(() =>
  import('./LinkPageCards.tsx').then(
    (module) => ({ default: module.LinkPageBento }),
    () => ({ default: BentoUnloaded }),
  ),
);
const LazyNotice = lazy<ComponentType<LinkPageNoticeProps>>(() =>
  import('./LinkPageNotice.tsx').then(
    (module) => ({ default: module.LinkPageNotice }),
    () => ({ default: NoticeUnloaded }),
  ),
);

/** How many skeleton chips a times block holds while it loads: LinkPageTimes' own loading state. */
const HOLD_CHIPS = 3;

/** Props for LinkPageHold. */
export interface LinkPageHoldProps {
  readonly block: Extract<LinkPageBlock, { kind: 'media' | 'image' | 'gallery' | 'times' }>;
  readonly isTile?: boolean;
}

/**
 * The box a lazy block holds while its chunk loads (AC-6126): the same outer shape the block draws (a media card's
 * stage and caption, a picture in its own ratio with its caption's line, a gallery's row or its squares, a times
 * card's title, chips and More times), quietly, out of the accessibility tree, so nothing moves when it lands.
 * Exported for its story, which holds each beside the block it stands for.
 */
export function LinkPageHold({ block, isTile = false }: LinkPageHoldProps) {
  const fill = isTile || undefined;
  if (block.kind === 'media') {
    const shape = block.provider === 'youtube' || block.provider === 'vimeo' ? 'video' : 'audio';
    return (
      <span className={styles.holdCard} data-fill={fill} data-hold-for="media" aria-hidden="true">
        <span className={styles.holdStage} data-hold={shape} data-provider={block.provider}>
          <Skeleton shape="fill" />
        </span>
        <span className={styles.holdCaption}>
          <span className={styles.holdTitle}>
            <Skeleton shape="text" width="medium" />
          </span>
          <span className={styles.holdLine}>
            <Skeleton shape="text" width="short" />
          </span>
        </span>
      </span>
    );
  }
  if (block.kind === 'image') {
    const hasCaption = block.caption !== undefined && block.caption !== '';
    return (
      <span className={styles.holdPicture} data-fill={fill} data-hold-for="image" aria-hidden="true">
        <span
          className={styles.holdFrame}
          style={{ '--hold-ratio': `${String(block.image.width)} / ${String(block.image.height)}` }}
        >
          <Skeleton shape="fill" />
        </span>
        {hasCaption && !isTile && (
          <span className={styles.holdLine}>
            <Skeleton shape="text" width="long" />
          </span>
        )}
      </span>
    );
  }
  if (block.kind === 'gallery') {
    const isGrid = block.display === 'grid' && !isTile;
    return (
      <span
        className={styles.holdGallery}
        data-display={isGrid ? 'grid' : 'row'}
        data-fill={fill}
        data-hold-for="gallery"
        aria-hidden="true"
      >
        <span className={styles.holdShots}>
          {Array.from({ length: isGrid ? block.images.length : 1 }, (_, index) => (
            <span key={index} className={styles.holdShot}>
              <Skeleton shape="fill" />
            </span>
          ))}
        </span>
        {/* Previous and Next's row under a swipe row, where a fine pointer draws them. */}
        {!isGrid && !isTile && block.images.length > 1 && <span className={styles.holdSteps} />}
      </span>
    );
  }
  return (
    <span className={styles.holdCard} data-times="" data-hold-for="times" aria-hidden="true">
      <span className={styles.holdHead}>
        <span className={styles.holdTitle}>
          <Skeleton shape="text" width="medium" />
        </span>
        <span className={styles.holdLine}>
          <Skeleton shape="text" width="short" />
        </span>
      </span>
      <span className={styles.holdWeek}>
        <Skeleton shape="fill" />
      </span>
      <span className={styles.holdChips}>
        {Array.from({ length: HOLD_CHIPS }, (_, index) => (
          <span key={index} className={styles.holdChip}>
            <Skeleton shape="fill" />
          </span>
        ))}
      </span>
      <span className={styles.holdMore} />
    </span>
  );
}

/**
 * A card's place while the cards' chunk loads, and a bento's: a quiet card with a title and two lines, out of the
 * accessibility tree, in the card's own box.
 */
export function LinkPageCardHold() {
  return (
    <span className={styles.holdCard} data-times="" data-hold-for="card" aria-hidden="true">
      <span className={styles.holdHead}>
        <span className={styles.holdTitle}>
          <Skeleton shape="text" width="medium" />
        </span>
        <span className={styles.holdLine}>
          <Skeleton shape="text" width="long" />
        </span>
        <span className={styles.holdLine}>
          <Skeleton shape="text" width="short" />
        </span>
      </span>
    </span>
  );
}

/** A picture's link, checked here by the page's one rule: a web address only, else none. */
function webHrefOf(href: string | undefined): { readonly webHref?: string } {
  const target = href === undefined ? undefined : linkTarget(href);
  return target?.scheme === 'web' ? { webHref: target.href } : {};
}

/** A media, picture or gallery block, from its own chunk, as a whole row or as a tile. */
export function LazyPictureBlock({
  block,
  onPress,
  isTile,
}: {
  readonly block: Extract<LinkPageBlock, { kind: 'media' | 'image' | 'gallery' }>;
  readonly onPress: ((id: string) => void) | undefined;
  readonly isTile: boolean;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  const pressed = press === undefined ? {} : { onPress: press };
  const hold = <LinkPageHold block={block} isTile={isTile} />;
  if (block.kind === 'media') {
    return (
      <Suspense fallback={hold}>
        <LazyMedia block={block} isTile={isTile} {...pressed} />
      </Suspense>
    );
  }
  if (block.kind === 'image') {
    return (
      <Suspense fallback={hold}>
        <LazyImage block={block} isTile={isTile} {...pressed} {...webHrefOf(block.href)} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={hold}>
      <LazyGallery block={block} isTile={isTile} />
    </Suspense>
  );
}

/**
 * A grid page's tile for a link or a booking page (AC-6103): its picture filling the top when it has one, else its
 * tile at the top; then its words, and the quiet mark of where it goes. The same press, rel and notice as its row.
 */
export function LinkTile({
  block,
  onPress,
}: {
  readonly block: LinkBlock;
  readonly onPress: (() => void) | undefined;
}) {
  const target = linkTarget(block.href);
  const click = useLinkClick(block, onPress);
  const isWeb = target?.scheme === 'web';
  const body = (
    <>
      {block.thumb === undefined ? (
        <span className={styles.tileTop}>
          <LinkPageTile block={block} />
        </span>
      ) : (
        <TilePicture block={block} picture={block.thumb} />
      )}
      <span className={styles.tileFoot}>
        <BlockText title={block.title} {...(block.note === undefined ? {} : { line: block.note })} />
        {target !== undefined && (
          <span className={styles.end}>
            <Icon name={isWeb ? 'arrow-up-right' : SCHEME_ICONS[target.scheme]} size="sm" />
          </span>
        )}
      </span>
    </>
  );
  if (target === undefined) {
    return (
      <span className={styles.block} data-card="tile" data-inert="">
        {body}
      </span>
    );
  }
  return (
    <a
      className={styles.block}
      data-card="tile"
      href={target.href}
      onClick={click.onClick}
      {...(isWeb ? { target: '_blank', rel: relOf(block) } : block.notice === undefined ? {} : { rel: 'nofollow' })}
    >
      {body}
      {isWeb && <VisuallyHidden>{strings.newTab}</VisuallyHidden>}
      {click.asks && <VisuallyHidden>{strings.asksFirst}</VisuallyHidden>}
    </a>
  );
}

/** A link's picture over its grid tile, falling back to its tile at the top when the picture fails (AC-6101). */
function TilePicture({ block, picture }: { readonly block: LinkBlock; readonly picture: LinkPagePicture }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const image = safeImageSrc(picture.src);
  if (image === undefined || failed === image) {
    return (
      <span className={styles.tileTop}>
        <LinkMarkTile block={block} />
      </span>
    );
  }
  return (
    <span className={styles.tilePicture}>
      <img
        className={styles.coverImage}
        src={image}
        width={picture.width}
        height={picture.height}
        alt={strings.thumbAlt}
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(image);
        }}
      />
    </span>
  );
}

/** A booking page as a grid tile: its calendar at the top, its title and lengths at the foot, opened in this tab. */
export function PageTile({
  block,
  onPress,
}: {
  readonly block: Extract<LinkPageBlock, { kind: 'page' }>;
  readonly onPress: (() => void) | undefined;
}) {
  const target = samePath(block.href);
  const body = (
    <>
      <span className={styles.tileTop}>
        <LinkPageTile block={block} />
      </span>
      <span className={styles.tileFoot}>
        <BlockText title={block.title} line={block.facts} />
        {target !== undefined && (
          <span className={styles.end}>
            <Icon name="chevron-right" size="sm" />
          </span>
        )}
      </span>
    </>
  );
  return target === undefined ? (
    <span className={styles.block} data-card="tile" data-inert="">
      {body}
    </span>
  ) : (
    <a className={styles.block} data-card="tile" href={target} onClick={onPress}>
      {body}
    </a>
  );
}

/**
 * A block that stands outside the list of rows: the person's words, the questions they answer, and spec 0061's
 * kinds. Its title takes the level under whatever names its group, so a page with no sections never skips from the
 * person's name to an h3 and one with them never repeats a section's own level.
 */
export function ApartBlockView({
  block,
  level,
  onPress,
}: {
  readonly block: ApartBlock;
  readonly level: 2 | 3;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const actions = useContext(PageActionsContext);
  if (block.kind === 'faq') return <FaqBlock block={block} level={level} />;
  // The person's social links as one row of marks (AC-6104), where the owner put it: each a real link named by its
  // network, the round marks of the header's own row.
  if (block.kind === 'socials') {
    return block.links.length === 0 ? null : (
      <div className={styles.socials}>
        <SocialLinks variant="round" links={block.links} label={strings.socials} />
      </div>
    );
  }
  if (block.kind === 'media' || block.kind === 'image' || block.kind === 'gallery') {
    return <LazyPictureBlock block={block} onPress={onPress} isTile={false} />;
  }
  if (block.kind === 'times') {
    return (
      <Suspense fallback={<LinkPageHold block={block} />}>
        <LazyTimes
          block={block}
          level={level}
          {...(onPress === undefined ? {} : { onPress: () => onPress(block.id) })}
          {...(actions.onTimesNear === undefined ? {} : { onNear: actions.onTimesNear })}
        />
      </Suspense>
    );
  }
  // A quiet quote (AC-5220): the words in the reading measure, who said them under it. No frame, no quotation
  // mark graphic and nothing to press — a testimonial is the page talking, not one more thing to tap.
  if (block.kind === 'testimonial') {
    return (
      <figure className={styles.said}>
        <blockquote className={styles.quote}>{block.quote}</blockquote>
        <figcaption className={styles.author}>
          {block.author}
          {block.role !== undefined && block.role !== '' && <span className={styles.role}>{block.role}</span>}
        </figcaption>
      </figure>
    );
  }
  const Title = level === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.writing}>
      {block.title !== undefined && block.title !== '' && <Title className={styles.writingTitle}>{block.title}</Title>}
      <p className={styles.writingBody}>{block.body}</p>
    </div>
  );
}

/**
 * The questions, on the library's own disclosure (AC-5210): each question a button that says whether it is open,
 * its answer the region under it, every one closed to begin with so the page stays short, and several open at
 * once since a visitor comparing two answers should not lose the first. Opening one counts nothing (AC-5211).
 */
function FaqBlock({
  block,
  level,
}: {
  readonly block: Extract<LinkPageBlock, { kind: 'faq' }>;
  readonly level: 2 | 3;
}) {
  const title = block.title === undefined || block.title === '' ? strings.questions : block.title;
  const Title = level === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.questions}>
      <Title className={styles.writingTitle}>{title}</Title>
      <DisclosureGroup allowsMultipleExpanded>
        {block.items.map((asked) => (
          <Disclosure
            key={asked.question}
            id={asked.question}
            title={asked.question}
            headingLevel={level === 2 ? 3 : 4}
          >
            <p className={styles.answer}>{asked.answer}</p>
          </Disclosure>
        ))}
      </DisclosureGroup>
    </div>
  );
}

/**
 * A group's rows, in order: each run of rows as one list, each run of tiles as one grid, and each block that stands
 * apart between them. Shared by an open group and a folded one, so a block draws the same either side of a fold.
 */
function GroupRows({
  rows,
  level,
  isNamed,
  onPress,
}: {
  readonly rows: readonly LinkPageBlock[];
  readonly level: 2 | 3;
  readonly isNamed: boolean;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const { layout } = useContext(PageActionsContext);
  // A grid page (spec 0068, AC-6808): the group is one bento, from its own chunk.
  if (layout === 'grid') {
    return (
      <Suspense fallback={<LinkPageCardHold />}>
        <LazyBento
          rows={rows}
          level={level}
          {...(isNamed ? {} : { label: strings.blocks })}
          {...(onPress === undefined ? {} : { onPress })}
        />
      </Suspense>
    );
  }
  // Writing is not a row, so it breaks out of the list rather than sitting in one: a run of rows is a list, and a
  // text block is the person's words between the lists.
  return runsOf(rows).map((run) => {
    const label = !isNamed && run.kind === 'rows' && run.isFirst ? strings.blocks : undefined;
    if (run.kind === 'card') {
      return (
        <Suspense key={run.key} fallback={<LinkPageCardHold />}>
          <LazyCard block={run.block} level={level} {...(onPress === undefined ? {} : { onPress })} />
        </Suspense>
      );
    }
    if (run.kind === 'rows') {
      return (
        <ul key={run.key} className={styles.list} {...(label === undefined ? {} : { 'aria-label': label })}>
          {run.rows.map((block) => (
            <BlockRow key={block.id} block={block} onPress={onPress} />
          ))}
        </ul>
      );
    }
    return <ApartBlockView key={run.key} block={run.block} level={level} onPress={onPress} />;
  });
}

/** How many blocks a folded section opens onto: what the page would draw, so the number on the row is never a lie. */
function shownCount(rows: readonly LinkPageBlock[]): number {
  return rows.filter((block) => block.kind !== 'banner').length;
}

/**
 * A folded section (AC-5416): one row in the page's own shape, carrying the heading's words, how many blocks are
 * under it and the quiet chevron every staying row ends in. The row is a real button inside the heading it names,
 * which is the disclosure pattern: the heading keeps the page's outline, and the button carries `aria-expanded`
 * and `aria-controls` so the state is announced.
 */
function Folder({
  heading,
  rows,
  isOpen,
  onToggle,
  onPress,
}: {
  readonly heading: Extract<LinkPageBlock, { kind: 'heading' }>;
  readonly rows: readonly LinkPageBlock[];
  readonly isOpen: boolean;
  readonly onToggle: (id: string) => void;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const panelId = useId();
  const count = shownCount(rows);
  return (
    <section className={styles.group} data-folder="">
      <h2 className={styles.folderTitle}>
        {/* The id is the heading's own, so `#<block id>` in the address finds this row (AC-5417). */}
        <button
          type="button"
          id={heading.id}
          className={styles.block}
          data-folder-row=""
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => {
            onToggle(heading.id);
          }}
        >
          <LinkPageTile block={heading} />
          <BlockText title={heading.title} />
          <span className={styles.end}>
            <span className={styles.count} aria-hidden="true">
              {count}
            </span>
            <VisuallyHidden>{strings.inside(count)}</VisuallyHidden>
            <span className={styles.chevron} data-open={isOpen || undefined}>
              <Icon name="chevron-right" size="sm" />
            </span>
          </span>
        </button>
      </h2>
      <div id={panelId} className={styles.panel} hidden={!isOpen}>
        <GroupRows rows={rows} level={3} isNamed onPress={onPress} />
      </div>
    </section>
  );
}

/**
 * One group of blocks, under its heading when it has one. A heading set to fold, with something to open onto,
 * draws as a folder instead; one with nothing under it draws as the plain heading it was, never as a folder a
 * visitor can open onto nothing (AC-5419).
 */
function Group({
  heading,
  rows,
  openFolder,
  onToggleFolder,
  onPress,
}: {
  readonly heading?: Extract<LinkPageBlock, { kind: 'heading' }>;
  readonly rows: readonly LinkPageBlock[];
  readonly openFolder?: string;
  readonly onToggleFolder: (id: string) => void;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const headingId = useId();
  if (heading !== undefined && heading.group === 'folder' && shownCount(rows) > 0) {
    return (
      <Folder
        heading={heading}
        rows={rows}
        isOpen={openFolder === heading.id}
        onToggle={onToggleFolder}
        onPress={onPress}
      />
    );
  }
  return (
    <section className={styles.group} {...(heading === undefined ? {} : { 'aria-labelledby': headingId })}>
      {heading !== undefined && (
        <h2 id={headingId} className={styles.heading}>
          {heading.title}
        </h2>
      )}
      <GroupRows rows={rows} level={heading === undefined ? 2 : 3} isNamed={heading !== undefined} onPress={onPress} />
    </section>
  );
}

/**
 * The banner (spec 0061, AC-6112): one line at the very top of the page, above the person, with its link when it has
 * one (our own path in this tab, a web page in a new one) and a quiet Close that puts it away for the visit. Calm
 * chrome in the page's soft accent, so it reads as news rather than as one more row to press.
 */
function Banner({
  block,
  onPress,
  onClose,
}: {
  readonly block: Extract<LinkPageBlock, { kind: 'banner' }>;
  readonly onPress: ((id: string) => void) | undefined;
  readonly onClose?: () => void;
}) {
  const own = block.href === undefined ? undefined : ownPath(block.href);
  const web = block.href === undefined || own !== undefined ? undefined : linkTarget(block.href);
  const href = own ?? (web?.scheme === 'web' ? web.href : undefined);
  const isWeb = own === undefined && href !== undefined;
  return (
    <section className={styles.banner} aria-label={strings.banner}>
      <p className={styles.bannerText}>
        {href === undefined ? (
          block.text
        ) : (
          <a
            className={styles.bannerLink}
            href={href}
            {...(onPress === undefined ? {} : { onClick: () => onPress(block.id) })}
            {...(isWeb ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {block.text}
            {isWeb && <VisuallyHidden>{strings.newTab}</VisuallyHidden>}
          </a>
        )}
      </p>
      {onClose !== undefined && (
        <Button variant="ghost" size="touch" icon="x" label={strings.closeBanner} onPress={onClose} />
      )}
    </section>
  );
}

/**
 * A person's link page, `/<handle>` (spec 0051): their face, name and bio, their social icons, then their blocks in
 * the order they set, each a whole row to press, grouped under the headings they gave, and the foot. One column a
 * thumb reaches, quiet chrome, and nothing loaded from another origin.
 */
/**
 * The owner's own page, for a thumbnail that shows it rather than a sample (spec 0068, AC-6804): their name, their
 * face (their picture, else the company's logo, else their initials on the accent), the cover photo where the template
 * wears one, and the titles of their first rows. Pictures go through `safeImageSrc`, so only our own origin, `data:` or
 * `blob:` draw.
 */
export interface LinkPageThumbnailProfile {
  readonly name: string;
  /** Drawn on the accent when there is no picture; left out, worked out from `name`. */
  readonly initials?: string;
  readonly picture?: string;
  readonly logo?: string;
  readonly cover?: string;
  /** The first rows' titles, in order; the miniature draws the first three. */
  readonly rows?: readonly string[];
}

/** How many of the owner's rows a thumbnail draws. */
const THUMBNAIL_ROWS = 3;

/** Props for LinkPageThumbnail. */
export interface LinkPageThumbnailProps {
  /** The look to draw. */
  readonly theme: PageLook;
  /** The page's own accent and photos (LinkPage's `variables`), so a gallery shows each look in the owner's colour. */
  readonly variables?: PageVariables;
  /**
   * What a Customise row's tile is about, drawn large in place of the whole miniature, so the tiles in one row tell
   * apart at a glance: `font` the typeface's own sample, `shape` one button in its corners, `mode` the page in its
   * mode (Follow visitor split corner to corner, light over dark). Left out, the whole page in miniature.
   */
  readonly detail?: 'font' | 'shape' | 'mode';
  /**
   * `large` (spec 0068, AC-6804): the template picker's miniature, a column tall, with a face, a name and rows at a
   * size that shows the template's own ground, type, corners and glow. Left out, the small slot's miniature.
   */
  readonly size?: 'large';
  /** The owner's own page, drawn scaled down in place of the sample face, name and rows. Left out, the sample. */
  readonly profile?: LinkPageThumbnailProfile;
}

/**
 * A link page in miniature, in one look: its ground, its header (a cover band, the face beside the name, or centred),
 * the face's shape, a sample of its typeface and three rows in its shape and fill (spec 0058, AC-10; spec 0060,
 * AC-8). It draws from the same look attributes and stylesheet blocks as the page itself, so a preset or gallery tile
 * shows the real look, never a picture of it. A photo it has no photo for draws as a quiet placeholder rather than as
 * the plain look. It fills its slot (TileGrid's choice thumbnail), never moves, takes no focus and is hidden from
 * screen readers: the tile's own name says which look it is.
 */
export function LinkPageThumbnail({ theme, variables, detail, size, profile }: LinkPageThumbnailProps) {
  // Follow visitor: the page light and dark at once, one over the other, cut corner to corner.
  const held = {
    ...(variables === undefined ? {} : { variables }),
    ...(size === undefined ? {} : { size }),
    ...(profile === undefined ? {} : { profile }),
  };
  if (detail === 'mode' && theme.mode === 'system') {
    return (
      <div className={styles.thumbSplit} aria-hidden="true">
        <ThumbnailLook theme={{ ...theme, mode: 'light' }} {...held} />
        <ThumbnailLook theme={{ ...theme, mode: 'dark' }} {...held} />
      </div>
    );
  }
  return <ThumbnailLook theme={theme} {...held} {...(detail === undefined ? {} : { detail })} />;
}

/** One look in miniature: the whole page, or only the detail its row is about. */
function ThumbnailLook({ theme, variables, detail, size, profile }: LinkPageThumbnailProps) {
  const look = drawnLook(theme);
  const picture = safeImageSrc(profile?.picture);
  const logo = safeImageSrc(profile?.logo);
  const cover = safeImageSrc(profile?.cover);
  const photos = thumbnailPhotos(look, cover);
  const rows = profile?.rows?.slice(0, THUMBNAIL_ROWS) ?? [];
  return (
    <div
      className={styles.root}
      data-thumbnail
      data-size={size}
      {...lookAttributes(theme, photos)}
      ref={usePageVariables(variables)}
      aria-hidden="true"
      inert
    >
      {detail === 'font' ? (
        <div className={styles.thumb} data-detail="font">
          <span className={styles.thumbFont}>{strings.thumbnailSample}</span>
        </div>
      ) : detail === 'shape' ? (
        <div className={styles.thumb} data-detail="shape">
          <span className={styles.thumbButton} />
        </div>
      ) : (
        <div className={styles.thumb} data-profile={profile === undefined ? undefined : ''}>
          {headerOf(look, photos.cover === true) === 'cover' && (
            <span className={styles.thumbCover}>
              {cover !== undefined && <img className={styles.thumbPhoto} src={cover} alt={strings.thumbAlt} />}
            </span>
          )}
          <span className={styles.thumbHead}>
            {/* The face: the owner's picture, else the company's logo, else their initials on the accent. */}
            {look.avatar !== 'none' &&
              (profile === undefined ? (
                <span className={styles.thumbFace} />
              ) : picture !== undefined ? (
                <span className={styles.thumbFace}>
                  <img className={styles.thumbPhoto} src={picture} alt={strings.thumbAlt} />
                </span>
              ) : logo !== undefined ? (
                <span className={styles.thumbFace} data-logo="">
                  <img className={styles.thumbLogo} src={logo} alt={strings.thumbAlt} />
                </span>
              ) : (
                <span className={styles.thumbFace} data-initials="">
                  {profile.initials ?? initialsOf(profile.name)}
                </span>
              ))}
            <span className={styles.thumbSample} data-name={profile === undefined ? undefined : ''}>
              {profile === undefined ? strings.thumbnailSample : profile.name}
            </span>
          </span>
          {Array.from({ length: THUMBNAIL_ROWS }, (_, index) => (
            <span key={index} className={styles.thumbRow}>
              {rows[index] !== undefined && (
                <>
                  <span className={styles.thumbTile} />
                  <span className={styles.thumbTitle}>{rows[index]}</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The company a page belongs to, above the person: its logo and name together, one link to its site. The logo is
 * decoration beside the name, which is the link's words, so it is read once. The site opens in a new tab, as every
 * outside link on the page does; an address that isn't an https one draws the lockup with no link.
 */
function Lockup({ brand }: { readonly brand: LinkPageBrand }) {
  const logo = safeImageSrc(brand.logo);
  const href = safeHref(brand.href);
  const content = (
    <>
      {logo !== undefined && <img className={styles.lockupLogo} src={logo} alt={strings.lockupLogoAlt} />}
      <span className={styles.lockupName}>{brand.name}</span>
    </>
  );
  return href === undefined || href.startsWith('/') || !/^https:/i.test(href) ? (
    <p className={styles.lockup}>{content}</p>
  ) : (
    <a className={styles.lockup} href={href} target="_blank" rel="noopener noreferrer">
      {content}
      <VisuallyHidden>{strings.newTab}</VisuallyHidden>
    </a>
  );
}

export function LinkPage({
  person,
  blocks,
  brand,
  footLine,
  address,
  share,
  walletHref,
  socials,
  openNow,
  book,
  toolbar,
  summary,
  empty,
  ghosts = 0,
  after,
  foot,
  isPreview = false,
  layout = 'page',
  caption,
  onPress,
  theme,
  photos,
  variables,
  openFolder,
  onOpenFolder,
  pageLayout = 'list',
  onTimesNear,
  isBannerClosed,
  onCloseBanner,
  continuedNotices,
  onContinueNotice,
}: LinkPageProps) {
  const captionId = useId();
  const columnRef = useRef<HTMLDivElement>(null);
  // The banner and the notices a visitor answered this visit (AC-6112, AC-6113): kept by the caller where it says
  // so (the public page, in the tab's session), and held here otherwise.
  const [heldBannerClosed, setHeldBannerClosed] = useState(false);
  const bannerClosed = onCloseBanner === undefined ? heldBannerClosed : isBannerClosed === true;
  const [heldContinued, setHeldContinued] = useState<readonly string[]>([]);
  const isHeld = onContinueNotice === undefined;
  const [asking, setAsking] = useState<LinkBlock | undefined>(undefined);
  // The notice sheet's chunk couldn't load: the page stops asking rather than leave noticed links doing nothing.
  const [isAskingOff, setAskingOff] = useState(false);
  const stopAsking = useCallback(() => {
    setAskingOff(true);
    setAsking(undefined);
  }, []);
  // Only the page itself asks before a noticed link: the editor's preview and a draft are inert anyway.
  const isLive = layout === 'page' && !isPreview;
  const drawn = theme === undefined ? undefined : drawnLook(theme);
  // The page's Book (spec 0068): the caller's, else its first booking page, which is real data the page holds.
  const pageBook = book ?? bookOf(blocks);
  const actions = useMemo<PageActions>(
    () => ({
      layout: pageLayout,
      isContinued: (id) => !isLive || isAskingOff || (isHeld ? heldContinued : (continuedNotices ?? [])).includes(id),
      ask: setAsking,
      onTimesNear,
      isLive,
      person,
      share,
      book: pageBook,
      avatar: drawn?.avatar === 'rounded' ? 'rounded' : 'circle',
    }),
    [
      pageLayout,
      isLive,
      isAskingOff,
      isHeld,
      heldContinued,
      continuedNotices,
      onTimesNear,
      person,
      share,
      pageBook,
      drawn?.avatar,
    ],
  );
  const banner = blocks?.find((block) => block.kind === 'banner');
  // A socials row block puts the person's marks where the owner placed it, so the header's own row steps aside.
  const hasSocialsBlock = blocks?.some((block) => block.kind === 'socials') ?? false;
  const hasNotice = isLive && (blocks?.some((block) => block.kind === 'link' && block.notice !== undefined) ?? false);
  const closeBanner = () => {
    setHeldBannerClosed(true);
    onCloseBanner?.();
    // Its close button goes with it: focus moves on to the page's first control rather than to nothing.
    focusLater(() => columnRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])'));
  };
  const continueNotice = (id: string) => {
    setHeldContinued((held) => (held.includes(id) ? held : [...held, id]));
    onContinueNotice?.(id);
    onPress?.(id);
    setAsking(undefined);
  };
  const askingTarget = asking === undefined ? undefined : linkTarget(asking.href);
  // Controlled where a caller keeps the open section (the public page, which puts it in the address), held here
  // where none does (the editor's preview, the stories). One at a time, so the address never names two.
  const [heldFolder, setHeldFolder] = useState<string | undefined>(openFolder);
  const shownFolder = onOpenFolder === undefined ? heldFolder : openFolder;
  const toggleFolder = (id: string) => {
    const next = shownFolder === id ? undefined : id;
    setHeldFolder(next);
    onOpenFolder?.(next);
  };
  const contact = contactOf(blocks);
  // A page whose only block is the contact card has no rows: its card is the header's Save contact, so the list
  // draws its empty state rather than an empty group.
  const groups = blocks === undefined ? [] : groupsOf(blocks);
  // Words that rise in once on the live page and are simply there everywhere else (a preview, a draft).
  const entering = (words: string, order: 1 | 2 | 3) =>
    isLive ? (
      <Reveal order={order} display="inline">
        {words}
      </Reveal>
    ) : (
      words
    );
  const look = lookAttributes(theme, photos);
  const variablesRef = usePageVariables(variables);
  const isSplit = drawn?.template === 'split';
  // Split's panel always offers Book when the page has a booking page (AC-6801); elsewhere only the caller's.
  const heroBook = book ?? (isSplit ? pageBook : undefined);
  const bookHref = ownPath(heroBook?.href);
  // Split leads with its cover in the panel when the page has one (AC-6801, AC-6802).
  const hasCover =
    drawn !== undefined && (headerOf(drawn, photos?.cover === true) === 'cover' || (isSplit && photos?.cover === true));
  if (layout === 'blocks') {
    return (
      <PageActionsContext value={actions}>
        <div
          className={styles.draft}
          data-layout="blocks"
          role="group"
          {...(caption === undefined ? {} : { 'aria-labelledby': captionId })}
        >
          {caption !== undefined && (
            <p id={captionId} className={styles.caption}>
              {caption}
            </p>
          )}
          {/* The block on the page's own ground, in its own look (spec 0060, AC-16): the page in a slice. */}
          <div
            className={styles.root}
            data-draft
            data-grid={pageLayout === 'grid' || undefined}
            {...look}
            ref={variablesRef}
          >
            <div className={styles.column}>
              <div className={styles.blocks} inert>
                {banner !== undefined && <Banner block={banner} onPress={undefined} />}
                {/* A contact card draws as the page's Save contact, which is where a visitor meets it. */}
                <Actions contact={contact} share={undefined} onPress={undefined} />
                {groupsOf(blocks ?? []).map((group, index) => (
                  <Group
                    key={group.heading?.id ?? `top-${String(index)}`}
                    rows={group.rows}
                    onPress={undefined}
                    onToggleFolder={toggleFolder}
                    {...(shownFolder === undefined ? {} : { openFolder: shownFolder })}
                    {...(group.heading === undefined ? {} : { heading: group.heading })}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageActionsContext>
    );
  }
  const Root = isPreview ? 'div' : 'main';
  return (
    <PageActionsContext value={actions}>
      <Root
        className={styles.root}
        data-preview={isPreview || undefined}
        data-grid={pageLayout === 'grid' || undefined}
        {...look}
        ref={variablesRef}
        {...(isPreview ? { inert: true } : {})}
      >
        <div className={styles.column} ref={columnRef}>
          {banner !== undefined && !bannerClosed && <Banner block={banner} onPress={onPress} onClose={closeBanner} />}
          {/* Who the page is: one column with the rest, except in Split, where it is the sticky panel on the left
              of a wide page (spec 0068, AC-6801). */}
          <div className={styles.identity}>
            {brand !== undefined && <Lockup brand={brand} />}
            <header
              className={styles.hero}
              data-cover={(person !== undefined && hasCover) || undefined}
              aria-busy={person === undefined || undefined}
            >
              {person === undefined ? (
                <>
                  <Skeleton shape="circle" size="xl" />
                  <p className={styles.name}>
                    <Skeleton shape="text" width="medium" align="center" />
                  </p>
                  <p className={styles.bio}>
                    <Skeleton shape="text" width="long" align="center" />
                  </p>
                  {/* The pill's own place, so the header doesn't grow when the address arrives. */}
                  {address !== undefined && (
                    <span className={styles.pillLoading}>
                      <Skeleton shape="fill" />
                    </span>
                  )}
                </>
              ) : (
                <>
                  {/* The cover photo (spec 0060, AC-13): a band the face overlaps, drawn from the page's own stylesheet. */}
                  {hasCover && <span className={styles.cover} aria-hidden="true" />}
                  {drawn?.avatar !== 'none' && (
                    <span className={styles.face}>
                      <Avatar
                        name={person.name}
                        id={person.id}
                        size="hero"
                        shape={drawn?.avatar === 'rounded' ? 'square' : 'circle'}
                        isDecorative
                        {...(person.image === undefined ? {} : { src: person.image })}
                      />
                    </span>
                  )}
                  {/* The words beside the face in the left header, and in the column under it otherwise. */}
                  <div className={styles.who}>
                    {/* The person's words rise in once as the page first draws (spec 0068, AC-6803). */}
                    <h1 className={styles.name}>{entering(person.name, 1)}</h1>
                    {person.role !== undefined && person.role !== '' && (
                      <p className={styles.jobTitle}>{entering(person.role, 2)}</p>
                    )}
                    {person.bio !== undefined && person.bio !== '' && (
                      <p className={styles.bio}>{entering(person.bio, 3)}</p>
                    )}
                    {address !== undefined && (
                      <span className={styles.address}>
                        <CopyButton
                          value={address.value}
                          label={address.label}
                          name={strings.copyAddress(address.label)}
                          announcement={strings.addressCopied}
                          isRound
                        />
                      </span>
                    )}
                  </div>
                </>
              )}
            </header>
            {person !== undefined && openNow !== undefined && openNow !== '' && (
              <p className={styles.openNow}>
                <span className={styles.openDot} aria-hidden="true" />
                {openNow}
              </p>
            )}
            {person !== undefined && bookHref !== undefined && heroBook !== undefined && (
              <ButtonLink
                variant="primary"
                size="touch"
                icon="calendar"
                href={bookHref}
                isFullWidth="center"
                {...(onPress === undefined ? {} : { onPress: () => onPress('book') })}
              >
                {heroBook.label}
              </ButtonLink>
            )}
            {/* The one action under the person, then the way to pass the page on, then where else to find them.
              Share stands while the page loads: it shares the address the visitor is already on. */}
            <Actions
              contact={contact}
              share={share}
              onPress={onPress}
              {...(walletHref === undefined ? {} : { walletHref })}
            />
            {!hasSocialsBlock && socials}
          </div>
          <div className={styles.content}>
            {toolbar}
            {/* Mounted while there is a search, so each count (none included) is read out as it changes. */}
            {summary !== undefined && (
              <p className={styles.summary} role="status" data-empty={summary === '' || undefined}>
                {summary}
              </p>
            )}
            {blocks === undefined ? (
              <ul className={styles.list} aria-busy="true" aria-label={strings.loading}>
                {Array.from({ length: LOADING_BLOCKS }, (_, index) => (
                  <li key={index} className={styles.item}>
                    <span className={styles.block} data-loading="">
                      <LinkPageTile />
                      <span className={styles.text}>
                        <span className={styles.title}>
                          <Skeleton shape="text" width={index % 2 === 0 ? 'medium' : 'long'} />
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : groups.length === 0 && ghosts === 0 ? (
              empty
            ) : (
              <div className={styles.blocks}>
                {groups.map((group, index) => (
                  <Group
                    key={group.heading?.id ?? `top-${String(index)}`}
                    rows={group.rows}
                    onPress={onPress}
                    onToggleFolder={toggleFolder}
                    {...(shownFolder === undefined ? {} : { openFolder: shownFolder })}
                    {...(group.heading === undefined ? {} : { heading: group.heading })}
                  />
                ))}
                {ghosts > 0 && (
                  // Places for blocks that aren't there yet: decoration, so nothing here is read out or reachable.
                  <ul className={styles.list} aria-hidden="true">
                    {Array.from({ length: ghosts }, (_, index) => (
                      <li key={index} className={styles.item}>
                        <span className={styles.block} data-ghost="">
                          <LinkPageTile />
                          <span className={styles.text}>
                            <span className={styles.title}>
                              <Skeleton shape="text" width={index % 2 === 0 ? 'medium' : 'long'} />
                            </span>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {after}
            {footLine !== undefined && footLine !== '' && <p className={styles.footLine}>{footLine}</p>}
            {foot}
          </div>
        </div>
        {hasNotice && (
          <Suspense fallback={null}>
            <LazyNotice
              asking={
                asking === undefined || askingTarget === undefined
                  ? undefined
                  : {
                      id: asking.id,
                      title: asking.title,
                      notice: asking.notice ?? 'sensitive',
                      href: askingTarget.href,
                      isWeb: askingTarget.scheme === 'web',
                    }
              }
              onClose={() => {
                setAsking(undefined);
              }}
              onContinue={continueNotice}
              onUnavailable={stopAsking}
            />
          </Suspense>
        )}
      </Root>
    </PageActionsContext>
  );
}
