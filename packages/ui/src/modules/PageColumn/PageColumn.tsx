import type { ReactNode } from 'react';
import styles from './PageColumn.module.css';

/** Props for PageColumn. */
export interface PageColumnProps {
  readonly children: ReactNode;
  /** `default` reads like a document (52rem at most); `narrow` like a form (the page card's width). */
  readonly width?: 'default' | 'narrow';
}

/**
 * A page's body that isn't a grid or a settings page (Captures › Links,
 * Bookings › Availability): padded from the frame, at most a readable width,
 * its children stacked.
 */
export function PageColumn({ children, width = 'default' }: PageColumnProps) {
  return (
    <div className={styles.root} data-width={width}>
      {children}
    </div>
  );
}
