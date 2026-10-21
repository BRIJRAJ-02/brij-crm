import { Link as AriaLink } from 'react-aria-components';
import { isAppPath, safeHref } from '../../lib/safe-href.ts';
import { linkTarget } from '../Link/Link.tsx';
import { ProviderMark, type ProviderName } from '../ProviderMark/ProviderMark.tsx';
import styles from './LinkChip.module.css';

/** Props for LinkChip. */
export interface LinkChipProps {
  /** Where it goes: `mailto:`, `tel:`, `https://`. Anything `safeHref` refuses renders as a plain chip. */
  readonly href: string;
  /** What it shows: the address, the domain, the formatted number. */
  readonly children: string;
  /**
   * No edge and no fill: the link's text alone, on a card or in a line of the
   * timeline, where a blue chip read heavier than the words around it.
   */
  readonly isFlat?: boolean;
  /**
   * The brand whose mark leads the words: a social profile's network
   * (LinkedIn, X), so the chip reads "[mark] ada-lovelace". The mark is
   * labelled, so the link's name is "LinkedIn ada-lovelace".
   */
  readonly mark?: ProviderName;
}

/** An email, phone, domain or URL value as a link chip: the one display for those types. */
export function LinkChip({ href, children, isFlat = false, mark }: LinkChipProps) {
  const safe = safeHref(href);
  const flat = isFlat ? { 'data-flat': '' } : {};
  const brand = mark === undefined ? null : <ProviderMark provider={mark} size="sm" isLabelled />;
  if (safe === undefined) {
    return (
      <span className={styles.root} data-plain="" {...flat}>
        {brand}
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      </span>
    );
  }
  // A link out is a plain anchor: no router to go through, and no React Aria
  // hooks for each of the hundreds a table draws. App paths go through the router.
  if (!isAppPath(safe)) {
    return (
      <a className={styles.root} href={safe} {...linkTarget(safe)} {...flat}>
        {brand}
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      </a>
    );
  }
  return (
    <AriaLink className={styles.root} href={safe} {...flat}>
      {brand}
      <span className={styles.label} data-truncated="">
        {children}
      </span>
    </AriaLink>
  );
}
