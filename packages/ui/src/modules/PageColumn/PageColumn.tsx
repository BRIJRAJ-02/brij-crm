import type { ReactNode } from 'react';
import styles from './PageColumn.module.css';

/** Props for PageColumn. */
export interface PageColumnProps {
  readonly children: ReactNode;
  /**
   * `default` reads like a document (the wide dialog's width at most);
   * `narrow` like a form (the page card's width); `full` takes the view's
   * whole width inside the padding, for a list of rows (Captures › Links and
   * Forms).
   */
  readonly width?: 'default' | 'narrow' | 'full';
  /** `center` fills the view's height and centres its children in it: a list's empty state, alone on the page. */
  readonly align?: 'start' | 'center';
  /** The column's own actions ("New booking page"), at its top end, when the page's TopBar belongs to a layout. */
  readonly actions?: ReactNode;
  /** A bar that sticks to the foot of the view while it has something to say ("Unsaved changes", Save). */
  readonly footer?: ReactNode;
}

/**
 * A page's body that isn't a grid or a settings page (Captures › Links,
 * Bookings › Availability): padded from the frame, at most a readable width
 * (or the whole width),
 * its children stacked, and an optional footer bar that stays in view.
 */
export function PageColumn({ children, width = 'default', align = 'start', actions, footer }: PageColumnProps) {
  return (
    <div className={styles.root} data-width={width} data-align={align === 'start' ? undefined : align}>
      {actions !== undefined && actions !== null && actions !== false && (
        <div className={styles.actions}>{actions}</div>
      )}
      {children}
      {footer !== undefined && footer !== null && footer !== false && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
