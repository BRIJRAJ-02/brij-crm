import { useId, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { safeHref } from '../../lib/safe-href.ts';
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
      /** Else the title's first letter, on this hue. */
      readonly hue: Hue;
    }
  | { readonly kind: 'heading'; readonly id: string; readonly title: string }
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
  /** Under the actions: the person's social icons row (their own set, never a block). */
  readonly socials?: ReactNode;
  /** Above the blocks: a search, once there are many. */
  readonly toolbar?: ReactNode;
  /** Over the blocks, said once: how many a search matched ("3 matches"). Read out as it changes. */
  readonly summary?: string;
  /** In place of the blocks when there are none: an EmptyState. */
  readonly empty?: ReactNode;
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
}

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

/**
 * The actions under the person: Save contact, the page's one primary action, when the owner keeps a card, and the
 * caller's Share beside it. Save contact is a plain link to the card's vCard on our own origin, so it works with no
 * script and straight from a QR code, and a phone offers to add the card to its contacts.
 */
function Actions({
  contact,
  share,
  onPress,
}: {
  readonly contact: Extract<LinkPageBlock, { kind: 'contact' }> | undefined;
  readonly share: ReactNode;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  // Only this site's own path: the card is served by the api, never from elsewhere.
  const href =
    contact !== undefined && contact.href.startsWith('/') && !/^\/[/\\]/.test(contact.href) ? contact.href : undefined;
  if (href === undefined && share === undefined) return null;
  return (
    <div className={styles.actions}>
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
  if (block.kind === 'heading') {
    return (
      <span className={styles.tile} data-tile="icon">
        <Icon name="type" />
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
  // The first word's first letter, a whole grapheme (an accent or an emoji stays one).
  const letter = initialsOf(block.title.trim().split(/\s+/u)[0] ?? '');
  return (
    <span className={styles.tile} data-tile="letter" data-hue={block.hue} aria-hidden="true">
      {letter}
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
  readonly [Kind in Exclude<LinkPageBlock['kind'], 'heading' | 'contact'>]: (
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
  readonly block: Exclude<LinkPageBlock, { kind: 'heading' | 'contact' }>;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  return (
    <li className={styles.item}>
      {block.kind === 'link' ? RENDERERS.link(block, press) : RENDERERS.page(block, press)}
    </li>
  );
}

/** One group of blocks, under its heading when it has one. */
function Group({
  heading,
  rows,
  onPress,
}: {
  readonly heading?: Extract<LinkPageBlock, { kind: 'heading' }>;
  readonly rows: readonly LinkPageBlock[];
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const headingId = useId();
  return (
    <section className={styles.group} {...(heading === undefined ? {} : { 'aria-labelledby': headingId })}>
      {heading !== undefined && (
        <h2 id={headingId} className={styles.heading}>
          {heading.title}
        </h2>
      )}
      {rows.length > 0 && (
        <ul className={styles.list} {...(heading === undefined ? { 'aria-label': strings.blocks } : {})}>
          {rows.map((block) =>
            block.kind === 'heading' || block.kind === 'contact' ? null : (
              <BlockRow key={block.id} block={block} onPress={onPress} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * A person's link page, `/<handle>` (spec 0051): their face, name and bio, their social icons, then their blocks in
 * the order they set, each a whole row to press, grouped under the headings they gave, and the foot. One column a
 * thumb reaches, quiet chrome, and nothing loaded from another origin.
 */
export function LinkPage({
  person,
  blocks,
  address,
  share,
  socials,
  toolbar,
  summary,
  empty,
  after,
  foot,
  isPreview = false,
  layout = 'page',
  caption,
  onPress,
}: LinkPageProps) {
  const captionId = useId();
  const contact = contactOf(blocks);
  // A page whose only block is the contact card has no rows: its card is the header's Save contact, so the list
  // draws its empty state rather than an empty group.
  const groups = blocks === undefined ? [] : groupsOf(blocks);
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
        <div className={styles.blocks} inert>
          {/* A contact card draws as the page's Save contact, which is where a visitor meets it. */}
          <Actions contact={contact} share={undefined} onPress={undefined} />
          {groupsOf(blocks ?? []).map((group, index) => (
            <Group
              key={group.heading?.id ?? `top-${String(index)}`}
              rows={group.rows}
              onPress={undefined}
              {...(group.heading === undefined ? {} : { heading: group.heading })}
            />
          ))}
        </div>
      </div>
    );
  }
  const Root = isPreview ? 'div' : 'main';
  return (
    <Root className={styles.root} data-preview={isPreview || undefined} {...(isPreview ? { inert: true } : {})}>
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
              <Avatar
                name={person.name}
                id={person.id}
                size="xl"
                isDecorative
                {...(person.image === undefined ? {} : { src: person.image })}
              />
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
            </>
          )}
        </header>
        {/* The one action under the person, then the way to pass the page on, then where else to find them.
              Share stands while the page loads: it shares the address the visitor is already on. */}
        <Actions contact={contact} share={share} onPress={onPress} />
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
        ) : groups.length === 0 ? (
          empty
        ) : (
          <div className={styles.blocks}>
            {groups.map((group, index) => (
              <Group
                key={group.heading?.id ?? `top-${String(index)}`}
                rows={group.rows}
                onPress={onPress}
                {...(group.heading === undefined ? {} : { heading: group.heading })}
              />
            ))}
          </div>
        )}
        {after}
        {foot}
      </div>
    </Root>
  );
}
