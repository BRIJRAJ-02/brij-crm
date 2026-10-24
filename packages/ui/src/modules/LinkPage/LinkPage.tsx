import { useId, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import type { PoweredByPage } from '../../lib/powered-by.ts';
import { initialsOf } from '../../lib/stable-hue.ts';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
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
  /** Under the bio: the person's social icons row (their own set, never a block). */
  readonly socials?: ReactNode;
  /** Above the blocks: a search, once there are many. */
  readonly toolbar?: ReactNode;
  /** Over the blocks, said once: how many a search matched ("3 matches"). Read out as it changes. */
  readonly summary?: string;
  /** In place of the blocks when there are none: an EmptyState. */
  readonly empty?: ReactNode;
  /** After the blocks: a refusal's Callout, Show more. */
  readonly after?: ReactNode;
  /** Where "Claim your free page" goes. */
  readonly claimHref?: string;
  /** Which page the foot's links are tagged as. */
  readonly page?: PoweredByPage;
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
  /** A visitor pressed a block (a press counter's beacon). Never holds up the navigation. */
  readonly onPress?: (id: string) => void;
}

/** How many skeleton blocks stand in while the page loads. */
const LOADING_BLOCKS = 5;

/** The blocks in groups: those before the first heading, then each heading with the blocks under it. */
function groupsOf(blocks: readonly LinkPageBlock[]) {
  const groups: { heading?: Extract<LinkPageBlock, { kind: 'heading' }>; rows: LinkPageBlock[] }[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') groups.push({ heading: block, rows: [] });
    else if (groups.length === 0) groups.push({ rows: [block] });
    else groups.at(-1)?.rows.push(block);
  }
  return groups;
}

/**
 * A block's leading tile, the same on the page and in the editor's rows: a link's network mark, its picked icon, or
 * its title's first letter on its hue; a booking page's calendar; a heading's type mark (the editor only).
 */
export function LinkPageTile({ block }: { readonly block: LinkPageBlock }) {
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
  if (block.mark !== undefined) {
    return (
      <span className={styles.tile} data-tile="mark">
        <ProviderMark provider={block.mark} size="lg" />
      </span>
    );
  }
  if (block.icon !== undefined) {
    return (
      <span className={styles.tile} data-tile="icon">
        <Icon name={block.icon} />
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

/** Each kind's one renderer. A block of a kind with none never reaches here: callers skip what they can't map. */
const RENDERERS: {
  readonly [Kind in Exclude<LinkPageBlock['kind'], 'heading'>]: (
    block: Extract<LinkPageBlock, { kind: Kind }>,
    onPress: (() => void) | undefined,
  ) => ReactNode;
} = {
  link: (block, onPress) => (
    <a
      className={styles.block}
      href={block.href}
      target="_blank"
      // `me` ties the person's own profiles to this page; no referrer, no opener, no endorsement of an outside site.
      rel="me noopener noreferrer nofollow"
      onClick={onPress}
    >
      <LinkPageTile block={block} />
      <span className={styles.text}>
        <span className={styles.title}>{block.title}</span>
        {block.note !== undefined && block.note !== '' && <span className={styles.note}>{block.note}</span>}
      </span>
      <span className={styles.end}>
        <Icon name="arrow-up-right" size="sm" />
      </span>
      <VisuallyHidden>{strings.newTab}</VisuallyHidden>
    </a>
  ),
  page: (block, onPress) => (
    <a className={styles.block} href={block.href} onClick={onPress}>
      <LinkPageTile block={block} />
      <span className={styles.text}>
        <span className={styles.title}>{block.title}</span>
        {block.facts !== '' && <span className={styles.note}>{block.facts}</span>}
      </span>
      <span className={styles.end} data-end="book">
        {strings.book}
        <Icon name="chevron-right" size="sm" />
      </span>
    </a>
  ),
};

/** One block in its row. */
function BlockRow({
  block,
  onPress,
}: {
  readonly block: Exclude<LinkPageBlock, { kind: 'heading' }>;
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
            block.kind === 'heading' ? null : <BlockRow key={block.id} block={block} onPress={onPress} />,
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
  socials,
  toolbar,
  summary,
  empty,
  after,
  claimHref,
  page = 'booking_profile',
  isPreview = false,
  layout = 'page',
  onPress,
}: LinkPageProps) {
  if (layout === 'blocks') {
    return (
      <div className={styles.blocks} data-layout="blocks" inert>
        {groupsOf(blocks ?? []).map((group, index) => (
          <Group
            key={group.heading?.id ?? `top-${String(index)}`}
            rows={group.rows}
            onPress={undefined}
            {...(group.heading === undefined ? {} : { heading: group.heading })}
          />
        ))}
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
            </>
          )}
          {socials}
        </header>
        {toolbar}
        {summary !== undefined && (
          <p className={styles.summary} role="status">
            {summary}
          </p>
        )}
        {blocks === undefined ? (
          <ul className={styles.list} aria-busy="true" aria-label={strings.loading}>
            {Array.from({ length: LOADING_BLOCKS }, (_, index) => (
              <li key={index} className={styles.item}>
                <span className={styles.block} data-loading="">
                  <span className={styles.tile} data-tile="loading" />
                  <span className={styles.text}>
                    <span className={styles.title}>
                      <Skeleton shape="text" width={index % 2 === 0 ? 'medium' : 'long'} />
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : blocks.length === 0 ? (
          empty
        ) : (
          <div className={styles.blocks}>
            {groupsOf(blocks).map((group, index) => (
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
        <BookingFoot page={page} {...(claimHref === undefined ? {} : { claimHref })} />
      </div>
    </Root>
  );
}
