import { Breadcrumb, Breadcrumbs as AriaBreadcrumbs, Link as AriaLink } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { safeHref } from '../../lib/safe-href.ts';
import styles from './Breadcrumbs.module.css';

/** One place in the trail. */
export interface Crumb {
  readonly id: string;
  readonly label: string;
  /** Where it goes. The last crumb is the current page and takes none. */
  readonly href?: string;
  readonly icon?: IconName;
}

/** Props for Breadcrumbs. */
export interface BreadcrumbsProps {
  /** Every place from the top down to the current page. */
  readonly items: readonly Crumb[];
}

/** Where a page sits: Settings › Objects › Companies. Each place but the last is a routed link. (Path is for attributes.) */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <AriaBreadcrumbs className={styles.root} items={items}>
      {(item) => {
        const href = safeHref(item.href);
        return (
          <Breadcrumb id={item.id} className={styles.crumb}>
            <AriaLink className={styles.link} {...(href === undefined ? {} : { href })}>
              {item.icon !== undefined && <Icon name={item.icon} size="sm" />}
              {item.label}
            </AriaLink>
            <span className={styles.separator} aria-hidden="true">
              <Icon name="chevron-right" size="xs" />
            </span>
          </Breadcrumb>
        );
      }}
    </AriaBreadcrumbs>
  );
}
