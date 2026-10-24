// Brief
// Purpose: a person's own social links where a visitor meets them (booking socials, 25 Oct 2026): a host's booking
// page rail, their `/<handle>` profile, and later their link page.
// Main task: see at a glance where else this person is, and open one in a new tab.
// Leaves out: follower counts, previews, labels beside the marks, and any editing (SocialLinksEditor does that).
import { lazy, Suspense, type ReactElement } from 'react';
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import styles from './SocialLinks.module.css';
import { strings, type SocialLinkNetwork } from './strings.ts';

export type { SocialLinkNetwork } from './strings.ts';

/** One link as the server answers it: the network, the canonical link, and what it reads as ("@ada", "ada.dev"). */
export interface SocialLinkItem {
  readonly network: SocialLinkNetwork;
  readonly href: string;
  readonly label: string;
}

/** Props for SocialLinks. */
export interface SocialLinksProps {
  /** In the person's order. Nothing draws when there are none. */
  readonly links: readonly SocialLinkItem[];
  /** The list's name for screen readers: "Ada Lovelace’s social links". */
  readonly label?: string;
  /**
   * Drawn with phrasing elements (a `span` list), for a row inside text: a settings row's description (the booking
   * editor's card). Screen readers hear the same list.
   */
  readonly isInline?: boolean;
}

/** One link's accessible name: the network, then where it goes ("LinkedIn, @ada"). */
export function socialLinkName(link: Pick<SocialLinkItem, 'network' | 'label'>): string {
  return `${strings.names[link.network]}, ${link.label}`;
}

/** One link's tooltip: the network and where it goes ("LinkedIn · @ada"). */
export function socialLinkTip(link: Pick<SocialLinkItem, 'network' | 'label'>): string {
  return `${strings.names[link.network]} · ${link.label}`;
}

/** One link: the brand's mark (Lucide's link for a website: a globe would read as the time zone above it), opening in a new tab as the person's own (`rel="me"`). */
function SocialLink({ link }: { readonly link: SocialLinkItem }) {
  const look = { variant: 'ghost', size: 'lg', isExternal: true, relations: ['me', 'nofollow'] } as const;
  return link.network === 'website' ? (
    <ButtonLink {...look} href={link.href} icon="link" isIconMark label={socialLinkName(link)} />
  ) : (
    <ButtonLink {...look} href={link.href} provider={link.network} label={socialLinkName(link)} />
  );
}

// The tooltips load on their own: Tooltip brings React Aria's overlay code, which a booking page's first load never
// needs. Until it arrives the same links stand in, so the row draws at once and keeps its shape.
const LazyTipped = lazy(() => import('./SocialLinksTips.tsx').then((module) => ({ default: module.SocialLinksTips })));

/**
 * A person's social links as a row of brand marks (owner ask, 25 Oct 2026): each a real link with a 34px hit area,
 * named "LinkedIn, @ada", with a tooltip on hover or focus, opening in a new tab. Quiet ghost buttons, so the row says
 * who the person is without competing with the page's one action. Draws nothing when there are none.
 */
export function SocialLinks({ links, label = strings.label, isInline = false }: SocialLinksProps) {
  if (links.length === 0) return null;
  const list = (wrap: (link: SocialLinkItem, element: ReactElement) => ReactElement) => {
    const items = links.map((link) =>
      isInline ? (
        <span key={link.network} role="listitem" className={styles.item}>
          {wrap(link, <SocialLink link={link} />)}
        </span>
      ) : (
        <li key={link.network} className={styles.item}>
          {wrap(link, <SocialLink link={link} />)}
        </li>
      ),
    );
    return isInline ? (
      <span role="list" className={styles.root} aria-label={label}>
        {items}
      </span>
    ) : (
      <ul className={styles.root} aria-label={label}>
        {items}
      </ul>
    );
  };
  return (
    <Suspense fallback={list((_link, element) => element)}>
      <LazyTipped render={list} />
    </Suspense>
  );
}
