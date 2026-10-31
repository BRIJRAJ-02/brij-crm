import { useId, useState, type ReactNode } from 'react';
// The link page's font packs (spec 0060, AC-12): faces the browser fetches only once text is drawn in them.
import '@crm/tokens/packs.css';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Disclosure, DisclosureGroup } from '../../molecules/Disclosure/Disclosure.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { usePageVariables, type PageVariables } from '../../lib/page-variables.ts';
import { initialsOf } from '../../lib/stable-hue.ts';
import styles from './LinkPage.module.css';
import { strings } from './strings.ts';

/** A social network whose own mark a link shows (ProviderMark's social marks). */
export type LinkPageMark =
  'linkedin' | 'x' | 'instagram' | 'github' | 'facebook' | 'youtube' | 'angellist' | 'tiktok' | 'threads';

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
    }
  | {
      readonly kind: 'text';
      readonly id: string;
      /** A small heading over the words, when the person gave one. */
      readonly title?: string;
      /** The words themselves, drawn as text with their line breaks kept. Never markup: nothing in it is parsed. */
      readonly body: string;
    }
  | {
      readonly kind: 'faq';
      readonly id: string;
      /** A small heading over the questions; without one the page says "Questions". */
      readonly title?: string;
      /** The questions, in the owner's order, each one a fold that starts closed. All drawn as text. */
      readonly items: readonly { readonly question: string; readonly answer: string }[];
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
    }
  | {
      readonly kind: 'page';
      readonly id: string;
      readonly title: string;
      /** The booking page's address, `/<handle>/<slug>`, opened in this tab. */
      readonly href: string;
      /** Its lengths and kind, said once: "30 min · 60 min · Team". */
      readonly facts: string;
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
    };

/** The person at the top of the page. */
export interface LinkPagePerson {
  readonly name: string;
  /** What the avatar's colour is keyed on when there is no picture (their handle). */
  readonly id: string;
  readonly image?: string;
  readonly bio?: string;
}

/** Props for LinkPage. */
export interface LinkPageProps {
  /** Missing while the page loads: the hero draws as a skeleton. */
  readonly person?: LinkPagePerson;
  /** Missing while the page loads: block shaped skeletons hold their places. */
  readonly blocks?: readonly LinkPageBlock[];
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
}

/**
 * The attributes a look becomes, and `data-theme`, which pins light or dark for everything inside this root: the
 * token layer only follows the system where no `data-theme` is set, so a visitor's own phone or app choice never
 * decides somebody else's page (AC-5406). `system` (spec 0060, AC-15) is the one mode that sets none, so the page
 * takes the visitor's own. A photo ground or cover the page has no photo for draws as `plain` or `centred`.
 */
function lookAttributes(look: PageLook | undefined, photos: LinkPagePhotos | undefined) {
  if (look === undefined) return {};
  const ground = look.ground === 'image' && photos?.ground !== true ? 'plain' : look.ground;
  const header = look.header === 'cover' && photos?.cover !== true ? 'centred' : look.header;
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
  };
}

/** Every photo, for a thumbnail: a gallery tile shows what its look draws once the photos are there. */
const ALL_PHOTOS: LinkPagePhotos = { cover: true, ground: true };

/** How many skeleton blocks stand in while the page loads. */
const LOADING_BLOCKS = 5;

/**
 * The blocks in groups: those before the first heading, then each heading with the blocks under it. A contact card
 * never takes a place here: it is the header's Save contact, wherever the owner keeps it in their order (the
 * owner's design, 25 October 2026).
 */
function groupsOf(blocks: readonly LinkPageBlock[]) {
  const groups: { heading?: Extract<LinkPageBlock, { kind: 'heading' }>; rows: LinkPageBlock[] }[] = [];
  for (const block of blocks) {
    if (block.kind === 'contact') continue;
    if (block.kind === 'heading') groups.push({ heading: block, rows: [] });
    else if (groups.length === 0) groups.push({ rows: [block] });
    else groups.at(-1)?.rows.push(block);
  }
  return groups;
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
} as const satisfies Record<'heading' | 'text' | 'faq' | 'testimonial', IconName>;

export function LinkPageTile({ block }: { readonly block?: LinkPageBlock }) {
  if (block === undefined) {
    return (
      <span className={styles.tile} data-tile="loading">
        <Skeleton shape="fill" />
      </span>
    );
  }
  if (block.kind === 'page') {
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
  if (block.kind === 'heading' || block.kind === 'text' || block.kind === 'faq' || block.kind === 'testimonial') {
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

/** Each kind's one renderer. A block of a kind with none never reaches here: callers skip what they can't map. */
const RENDERERS: {
  readonly [Kind in Exclude<LinkPageBlock['kind'], 'heading' | 'contact' | 'text' | 'faq' | 'testimonial'>]: (
    block: Extract<LinkPageBlock, { kind: Kind }>,
    onPress: (() => void) | undefined,
  ) => ReactNode;
} = {
  link: (block, onPress) => {
    const target = linkTarget(block.href);
    // An address the rule refuses draws as words, never as a link.
    if (target === undefined) {
      return (
        <span className={styles.block} data-inert="">
          <LinkPageTile block={block} />
          <BlockText title={block.title} {...(block.note === undefined ? {} : { line: block.note })} />
        </span>
      );
    }
    const isWeb = target.scheme === 'web';
    return (
      <a
        className={styles.block}
        href={target.href}
        onClick={onPress}
        // A web page opens in a new tab, with no referrer, no opener and no endorsement; `me` only on the person's
        // own profile on a network. An email, a call or a text opens the device's app, in place.
        {...(isWeb
          ? {
              target: '_blank',
              rel: block.mark === undefined ? 'noopener noreferrer nofollow' : 'me noopener noreferrer nofollow',
            }
          : {})}
      >
        <LinkPageTile block={block} />
        <BlockText title={block.title} {...(block.note === undefined ? {} : { line: block.note })} />
        <span className={styles.end}>
          <Icon name={isWeb ? 'arrow-up-right' : SCHEME_ICONS[target.scheme]} size="sm" />
        </span>
        {isWeb && <VisuallyHidden>{strings.newTab}</VisuallyHidden>}
      </a>
    );
  },
  // A Timefix form: a row that opens the form on our own origin, in the same tab. Our page, our policy: no frame,
  // no script from anywhere else, and an ordinary navigation a visitor can come back from (AC-5215).
  form: (block, onPress) => {
    const target = block.href.startsWith('/') && !/^\/[/\\]/.test(block.href) ? block.href : undefined;
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
    const target = block.href.startsWith('/') && !/^\/[/\\]/.test(block.href) ? block.href : undefined;
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
};

/** One block in its row. */
function BlockRow({
  block,
  onPress,
}: {
  readonly block: BlockRowBlock;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  return (
    <li className={styles.item}>
      {block.kind === 'link'
        ? RENDERERS.link(block, press)
        : block.kind === 'form'
          ? RENDERERS.form(block, press)
          : RENDERERS.page(block, press)}
    </li>
  );
}

/** A group's children in order: each run of pressable rows, and each block that stands apart between them. */
type Run =
  | { readonly kind: 'rows'; readonly key: string; readonly isFirst: boolean; readonly rows: BlockRowBlock[] }
  | { readonly kind: 'apart'; readonly key: string; readonly block: ApartBlock };

/** A block a row draws: everything but a heading, a contact card, writing, questions and a testimonial. */
type BlockRowBlock = Exclude<LinkPageBlock, { kind: 'heading' | 'contact' | 'text' | 'faq' | 'testimonial' }>;

/**
 * A block that is not a row: the person's own words, the questions they answer, and something a customer said.
 * None of them records a press, because none of them is a thing to press.
 */
type ApartBlock = Extract<LinkPageBlock, { kind: 'text' | 'faq' | 'testimonial' }>;

function runsOf(blocks: readonly LinkPageBlock[]): Run[] {
  const runs: Run[] = [];
  let isFirst = true;
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'contact') continue;
    if (block.kind === 'text' || block.kind === 'faq' || block.kind === 'testimonial') {
      runs.push({ kind: 'apart', key: block.id, block });
      continue;
    }
    const last = runs.at(-1);
    if (last?.kind === 'rows') last.rows.push(block);
    else {
      runs.push({ kind: 'rows', key: block.id, isFirst, rows: [block] });
      isFirst = false;
    }
  }
  return runs;
}

/**
 * A block that stands outside the list of rows: the person's words, or the questions they answer. Its title takes
 * the level under whatever names its group, so a page with no sections never skips from the person's name to an
 * h3 and one with them never repeats a section's own level.
 */
function ApartBlockView({ block, level }: { readonly block: ApartBlock; readonly level: 2 | 3 }) {
  if (block.kind === 'faq') return <FaqBlock block={block} level={level} />;
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
 * A group's rows, in order: each run of pressable rows as one list, and each block that stands apart between them.
 * Shared by an open group and a folded one, so a block draws the same either side of a fold.
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
  // Writing is not a row, so it breaks out of the list rather than sitting in one: a run of rows is a list, and a
  // text block is the person's words between the lists.
  return runsOf(rows).map((run) =>
    run.kind === 'rows' ? (
      <ul key={run.key} className={styles.list} {...(!isNamed && run.isFirst ? { 'aria-label': strings.blocks } : {})}>
        {run.rows.map((block) => (
          <BlockRow key={block.id} block={block} onPress={onPress} />
        ))}
      </ul>
    ) : (
      <ApartBlockView key={run.key} block={run.block} level={level} />
    ),
  );
}

/** How many blocks a folded section opens onto: what the page would draw, so the number on the row is never a lie. */
function shownCount(rows: readonly LinkPageBlock[]): number {
  return rows.filter((block) => block.kind !== 'contact').length;
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
 * A person's link page, `/<handle>` (spec 0051): their face, name and bio, their social icons, then their blocks in
 * the order they set, each a whole row to press, grouped under the headings they gave, and the foot. One column a
 * thumb reaches, quiet chrome, and nothing loaded from another origin.
 */
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
}

/**
 * A link page in miniature, in one look: its ground, its header (a cover band, the face beside the name, or centred),
 * the face's shape, a sample of its typeface and three rows in its shape and fill (spec 0058, AC-10; spec 0060,
 * AC-8). It draws from the same look attributes and stylesheet blocks as the page itself, so a preset or gallery tile
 * shows the real look, never a picture of it. A photo it has no photo for draws as a quiet placeholder rather than as
 * the plain look. It fills its slot (TileGrid's choice thumbnail), never moves, takes no focus and is hidden from
 * screen readers: the tile's own name says which look it is.
 */
export function LinkPageThumbnail({ theme, variables, detail }: LinkPageThumbnailProps) {
  // Follow visitor: the page light and dark at once, one over the other, cut corner to corner.
  const held = variables === undefined ? {} : { variables };
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
function ThumbnailLook({ theme, variables, detail }: LinkPageThumbnailProps) {
  return (
    <div
      className={styles.root}
      data-thumbnail
      {...lookAttributes(theme, ALL_PHOTOS)}
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
        <div className={styles.thumb}>
          {theme.header === 'cover' && <span className={styles.thumbCover} />}
          <span className={styles.thumbHead}>
            {theme.avatar !== 'none' && <span className={styles.thumbFace} />}
            <span className={styles.thumbSample}>{strings.thumbnailSample}</span>
          </span>
          <span className={styles.thumbRow} />
          <span className={styles.thumbRow} />
          <span className={styles.thumbRow} />
        </div>
      )}
    </div>
  );
}

export function LinkPage({
  person,
  blocks,
  address,
  share,
  walletHref,
  socials,
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
}: LinkPageProps) {
  const captionId = useId();
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
  const look = lookAttributes(theme, photos);
  const variablesRef = usePageVariables(variables);
  if (layout === 'blocks') {
    return (
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
        <div className={styles.root} data-draft {...look} ref={variablesRef}>
          <div className={styles.column}>
            <div className={styles.blocks} inert>
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
    );
  }
  const Root = isPreview ? 'div' : 'main';
  return (
    <Root
      className={styles.root}
      data-preview={isPreview || undefined}
      {...look}
      ref={variablesRef}
      {...(isPreview ? { inert: true } : {})}
    >
      <div className={styles.column}>
        <header className={styles.hero} aria-busy={person === undefined || undefined}>
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
              {theme?.header === 'cover' && photos?.cover === true && (
                <span className={styles.cover} aria-hidden="true" />
              )}
              {theme?.avatar !== 'none' && (
                <span className={styles.face}>
                  <Avatar
                    name={person.name}
                    id={person.id}
                    size="hero"
                    shape={theme?.avatar === 'rounded' ? 'square' : 'circle'}
                    isDecorative
                    {...(person.image === undefined ? {} : { src: person.image })}
                  />
                </span>
              )}
              {/* The words beside the face in the left header, and in the column under it otherwise. */}
              <div className={styles.who}>
                <h1 className={styles.name}>{person.name}</h1>
                {person.bio !== undefined && person.bio !== '' && <p className={styles.bio}>{person.bio}</p>}
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
        {/* The one action under the person, then the way to pass the page on, then where else to find them.
              Share stands while the page loads: it shares the address the visitor is already on. */}
        <Actions
          contact={contact}
          share={share}
          onPress={onPress}
          {...(walletHref === undefined ? {} : { walletHref })}
        />
        {socials}
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
        {foot}
      </div>
    </Root>
  );
}
