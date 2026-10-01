import { Link as AriaLink } from 'react-aria-components';
import { isAppPath, safeHref } from '../../lib/safe-href.ts';
import { linkTarget } from '../Link/Link.tsx';
import styles from './LinkChip.module.css';

/** Props for LinkChip. */
export interface LinkChipProps {
  /** Where it goes: `mailto:`, `tel:`, `https://`. Anything `safeHref` refuses renders as a plain chip. */
  readonly href: string;
  /** What it shows: the address, the domain, the formatted number. */
  readonly children: string;
}

/** An email, phone, domain or URL value as a link chip: the one display for those types. */
export function LinkChip({ href, children }: LinkChipProps) {
  const safe = safeHref(href);
  if (safe === undefined) {
    return (
      <span className={styles.root} data-plain="">
        <span className={styles.label}>{children}</span>
      </span>
    );
  }
  // A link out is a plain anchor: no router to go through, and no React Aria
  // hooks for each of the hundreds a table draws. App paths go through the router.
  if (!isAppPath(safe)) {
    return (
      <a className={styles.root} href={safe} {...linkTarget(safe)}>
        <span className={styles.label}>{children}</span>
      </a>
    );
  }
  return (
    <AriaLink className={styles.root} href={safe}>
      <span className={styles.label}>{children}</span>
    </AriaLink>
  );
}
