import { Breadcrumb, Breadcrumbs as AriaBreadcrumbs, Link as AriaLink } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { safeHref } from '../../lib/safe-href.ts';
import styles from './Breadcrumbs.module.css';

/** One place in the trail. */
export interface Crumb {
  readonly id: string;
  readonly label: string;
  /**
   * Where it goes. The last crumb is the current page and takes none. One
   * before it without an `href` is a group's name, not a page ("Account" in
   * Account › Preferences): plain text, no link and no tab stop.
   */
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
  const lastId = items.at(-1)?.id;
  return (
    <AriaBreadcrumbs className={styles.root} items={items}>
      {(item) => {
        const href = safeHref(item.href);
        const face = (
          <>
            {item.icon !== undefined && <Icon name={item.icon} size="sm" />}
            <span className={styles.label}>{item.label}</span>
          </>
        );
        return (
          <Breadcrumb id={item.id} className={styles.crumb}>
            {href === undefined && item.id !== lastId ? (
              <span className={styles.link}>{face}</span>
            ) : (
              <AriaLink className={styles.link} {...(href === undefined ? {} : { href })}>
                {face}
              </AriaLink>
            )}
            <span className={styles.separator} aria-hidden="true">
              <Icon name="chevron-right" size="xs" />
            </span>
          </Breadcrumb>
        );
      }}
    </AriaBreadcrumbs>
  );
}
