import type { ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import { isAppPath, safeHref } from '../../lib/safe-href.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Link.module.css';
import { strings } from './strings.ts';

/** Props for Link. */
export interface LinkProps {
  /** A path in the app (`/people/1`, routed), or an `http`, `https`, `mailto` or `tel` link. Anything else renders as text. */
  readonly href: string;
  readonly children: ReactNode;
  /**
   * Does something in the page instead of going anywhere (a form's summary
   * link that focuses its question). The link keeps its look, focus ring and
   * keys; `href` is not rendered then.
   */
  readonly onPress?: () => void;
  /**
   * Opens an app path in a new tab, said to screen readers. For a step the person must take elsewhere while a
   * half filled dialog waits here (a round robin group a new booking page needs), so what they typed stays.
   */
  readonly opensInNewTab?: boolean;
  /**
   * A link standing on its own line rather than inside a sentence (a public page's Directions, its phone): a mark
   * before the words, at the text's size.
   */
  readonly icon?: IconName;
  /** `strong`: the words in the strong weight, for a link that is a page's action rather than a reference. */
  readonly weight?: 'regular' | 'strong';
}

/** Where a checked href goes: inside the app, or out to another site in a new tab. */
export function linkTarget(href: string) {
  return isAppPath(href) || !/^https?:/i.test(href) ? {} : ({ target: '_blank', rel: 'noopener noreferrer' } as const);
}

/**
 * An inline text link (or, with `icon`, one on its own line). Paths in the app go through the router; links out open
 * in a new tab. A link that fails `safeHref` (a `javascript:` URL) renders as
 * plain text (AC-14).
 */
export function Link({ href, children, onPress, opensInNewTab = false, icon, weight = 'regular' }: LinkProps) {
  const look = {
    className: styles.root,
    'data-weight': weight === 'strong' ? 'strong' : undefined,
    'data-icon': icon === undefined ? undefined : '',
  };
  const words = (
    <>
      {icon !== undefined && <Icon name={icon} />}
      {children}
    </>
  );
  if (onPress !== undefined) {
    return (
      <AriaLink {...look} onPress={onPress}>
        {words}
      </AriaLink>
    );
  }
  const safe = safeHref(href);
  if (safe === undefined) return <span className={styles.text}>{children}</span>;
  if (opensInNewTab) {
    return (
      <AriaLink {...look} href={safe} target="_blank" rel="noopener noreferrer">
        {words}
        <VisuallyHidden> {strings.newTab}</VisuallyHidden>
      </AriaLink>
    );
  }
  return (
    <AriaLink {...look} href={safe} {...linkTarget(safe)}>
      {words}
    </AriaLink>
  );
}
