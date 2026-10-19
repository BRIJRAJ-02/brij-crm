import type { ReactNode } from 'react';
import styles from './PageColumn.module.css';

/** Props for PageColumn. */
export interface PageColumnProps {
  readonly children: ReactNode;
  /**
   * `default` reads like a document (the wide dialog's width at most); `narrow` like a form (the page card's
   * width); `full` fills the view (a calendar).
   */
  readonly width?: 'default' | 'narrow' | 'full';
  /** The column's own actions ("New booking page"), at its top end, when the page's TopBar belongs to a layout. */
  readonly actions?: ReactNode;
  /** A bar that sticks to the foot of the view while it has something to say ("Unsaved changes", Save). */
  readonly footer?: ReactNode;
}

/**
 * A page's body that isn't a grid or a settings page (Captures › Links,
 * Bookings › Availability): padded from the frame, at most a readable width,
 * its children stacked, and an optional footer bar that stays in view.
 */
export function PageColumn({ children, width = 'default', actions, footer }: PageColumnProps) {
  return (
    <div className={styles.root} data-width={width}>
      {actions !== undefined && actions !== null && actions !== false && (
        <div className={styles.actions}>{actions}</div>
      )}
      {children}
      {footer !== undefined && footer !== null && footer !== false && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
