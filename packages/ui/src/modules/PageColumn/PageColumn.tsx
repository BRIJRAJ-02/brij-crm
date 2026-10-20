import type { ReactNode } from 'react';
import styles from './PageColumn.module.css';

/** Props for PageColumn. */
export interface PageColumnProps {
  readonly children: ReactNode;
  /**
   * `default` reads like a document (the wide dialog's width at most);
   * `narrow` like a form (the page card's width); `full` takes the view's
   * whole width inside the padding (Bookings' tabs).
   */
  readonly width?: 'default' | 'narrow' | 'full';
  /** `center` fills the view's height and centres its children in it: a list's empty state, alone on the page. */
  readonly align?: 'start' | 'center';
  /** The column's own actions ("New booking page"), at its top end, when the page's TopBar belongs to a layout. */
  readonly actions?: ReactNode;
  /**
   * A side column beside the children (Bookings › Availability: the time zone and days off beside the week),
   * at the end when the page is wide enough, under them when it isn't. Use it with `width="full"`.
   */
  readonly aside?: ReactNode;
  /**
   * When the page is too narrow for both and they stack: `main-first` (the default) puts the side column
   * under the children, `aside-first` above them (Bookings › Availability: the time zone before the week on
   * a phone). Side by side, the side column is always at the end. `aside-first` puts the side column first
   * in the DOM too, so screen readers and Tab reach it before the children at every width: use it only when
   * the side column is context the children read in.
   */
  readonly stack?: 'main-first' | 'aside-first';
  /**
   * A bar that sticks to the foot of the view while it has something to say ("Unsaved changes", Save). While
   * it draws nothing (SaveBar with nothing unsaved), it takes no room, and only the bar itself takes the pointer.
   */
  readonly footer?: ReactNode;
}

/**
 * A page's body that isn't a grid or a settings page (Bookings' tabs, the
 * Captures empty states): padded from the frame by the app's 16px gutter, at most a readable width
 * (or the whole width),
 * its children stacked, an optional side column beside them, and an optional
 * footer bar that stays in view.
 */
export function PageColumn({
  children,
  width = 'default',
  align = 'start',
  actions,
  aside,
  stack = 'main-first',
  footer,
}: PageColumnProps) {
  const hasAside = aside !== undefined && aside !== null && aside !== false;
  return (
    <div className={styles.root} data-width={width} data-align={align === 'start' ? undefined : align}>
      {actions !== undefined && actions !== null && actions !== false && (
        <div className={styles.actions}>{actions}</div>
      )}
      {hasAside ? (
        // Aside first is in the DOM too, so reading and Tab order follow what's on screen when stacked.
        <div className={styles.split} data-stack={stack === 'aside-first' ? stack : undefined}>
          {stack === 'aside-first' && <div className={styles.aside}>{aside}</div>}
          <div className={styles.main}>{children}</div>
          {stack === 'main-first' && <div className={styles.aside}>{aside}</div>}
        </div>
      ) : (
        children
      )}
      {footer !== undefined && footer !== null && footer !== false && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
