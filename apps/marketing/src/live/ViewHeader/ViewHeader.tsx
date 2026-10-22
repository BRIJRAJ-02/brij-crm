import { Badge, Icon, type Hue, type IconName } from '@crm/ui';
import type { ReactNode } from 'react';
import styles from './ViewHeader.module.css';

/** Props for ViewHeader. */
export interface ViewHeaderProps {
  readonly icon: IconName;
  readonly hue: Hue;
  readonly title: string;
  /** How many records the view holds, beside its title. */
  readonly count?: number;
  /** Controls at the end of the row. */
  readonly actions?: ReactNode;
}

/**
 * The top of a demo view, as the app's top bar draws a page: the object's tile, its name and count, and its actions.
 * Its own component rather than the library's TopBar, whose title is the page's `h1`: on the home page the `h1` is
 * the site's promise, so a view's name is an `h2`.
 */
export function ViewHeader({ icon, hue, title, count, actions }: ViewHeaderProps) {
  return (
    <div className={styles.root}>
      <h2 className={styles.title}>
        <Icon name={icon} tile={hue} />
        {title}
        {count !== undefined && <Badge count={count} max={Infinity} />}
      </h2>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
