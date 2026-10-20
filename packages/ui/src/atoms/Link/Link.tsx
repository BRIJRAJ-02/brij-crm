import type { ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { isAppPath, safeHref } from '../../lib/safe-href.ts';
import styles from './Link.module.css';

/** Props for Link. */
export interface LinkProps {
  /** A path in the app (`/people/1`, routed), or an `http`, `https`, `mailto` or `tel` link. Anything else renders as text. */
  readonly href: string;
  readonly children: ReactNode;
  /**
   * Does something in the page instead of going to `href` (a form's summary
   * link that focuses its question). The link keeps its look, focus ring and
   * keys; `href` is still checked, and names where it points.
   */
  readonly onPress?: () => void;
}

/** Where a checked href goes: inside the app, or out to another site in a new tab. */
export function linkTarget(href: string) {
  return isAppPath(href) || !/^https?:/i.test(href) ? {} : ({ target: '_blank', rel: 'noopener noreferrer' } as const);
}

/**
 * An inline text link. Paths in the app go through the router; links out open
 * in a new tab. A link that fails `safeHref` (a `javascript:` URL) renders as
 * plain text (AC-14).
 */
export function Link({ href, children, onPress }: LinkProps) {
  if (onPress !== undefined) {
    return (
      <AriaLink className={styles.root} onPress={onPress}>
        {children}
      </AriaLink>
    );
  }
  const safe = safeHref(href);
  if (safe === undefined) return <span className={styles.text}>{children}</span>;
  return (
    <AriaLink className={styles.root} href={safe} {...linkTarget(safe)}>
      {children}
    </AriaLink>
  );
}
