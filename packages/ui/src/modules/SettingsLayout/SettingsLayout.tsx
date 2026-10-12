// The frame of every settings page (spec 0012, pulled forward from spec 0003's
// milestone 4): the settings navigation beside the page, and the page's
// header (its title, a tile, a badge, a line of description and its actions)
// over its body. The body is the screen's: Tabs, Cards, Tables, EmptyState.
import type { ReactNode, Ref } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { NavItem } from '../Sidebar/Sidebar.tsx';
import styles from './SettingsLayout.module.css';
import { strings } from './strings.ts';

/** One entry of the settings navigation: a page of settings. */
export interface SettingsNavEntry {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
}

/** Props for SettingsLayout. */
export interface SettingsLayoutProps {
  /** The settings pages, in order. Each feature adds its own (#8, #23 and later). */
  readonly nav: readonly SettingsNavEntry[];
  /** The id of the page shown, marked as the current one. */
  readonly currentNavId?: string;
  /** Names the navigation landmark ("Settings"). */
  readonly navLabel?: string;
  /** The page's title, its second level heading (the TopBar above holds the h1). */
  readonly title: string;
  /** A tile before the title: an object's icon, on its hue. */
  readonly icon?: IconName;
  readonly hue?: Hue;
  /** Beside the title: a badge ("Standard"). */
  readonly meta?: ReactNode;
  /** One line under the title: what the page is for. */
  readonly description?: ReactNode;
  /** The page's actions, at the end of the header ("New object"). */
  readonly actions?: ReactNode;
  /** The page's head is still coming: skeletons after the loading delay; the navigation stays usable. */
  readonly isLoading?: boolean;
  /**
   * The visible title, which takes focus by script (never a tab stop) when
   * the control in use went away with its change (an archived row, a
   * cancelled job's Cancel): the TopBar's h1 is visually hidden under a trail.
   */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /** The page's body. */
  readonly children: ReactNode;
}

/**
 * A settings page: the settings navigation (a list of links, the current one
 * marked) beside the page, whose header holds its title, tile, badge,
 * description and actions over the body. In a narrow slot the navigation
 * sits above the page.
 */
export function SettingsLayout({
  nav,
  currentNavId,
  navLabel = strings.navLabel,
  title,
  icon,
  hue,
  meta,
  description,
  actions,
  isLoading = false,
  titleRef,
  children,
}: SettingsLayoutProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  return (
    <div className={styles.root}>
      <nav className={styles.nav} aria-label={navLabel}>
        <ul className={styles.entries}>
          {nav.map((entry) => (
            <li key={entry.id}>
              <NavItem icon={entry.icon} href={entry.href} isCurrent={entry.id === currentNavId}>
                {entry.label}
              </NavItem>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.page}>
        {isLoading ? (
          <div className={styles.header} aria-busy="true">
            {showSkeleton && (
              <span className={styles.text}>
                <Skeleton width="medium" />
                <Skeleton width="long" />
              </span>
            )}
            <VisuallyHidden>{strings.loading}</VisuallyHidden>
          </div>
        ) : (
          <header className={styles.header}>
            {icon !== undefined && <Icon name={icon} tile={hue ?? 'gray'} />}
            <span className={styles.text}>
              <span className={styles.heading}>
                <h2 className={styles.title} ref={titleRef} tabIndex={-1} data-settings-title>
                  {title}
                </h2>
                {meta}
              </span>
              {description !== undefined && <span className={styles.description}>{description}</span>}
            </span>
            {actions !== undefined && <span className={styles.actions}>{actions}</span>}
          </header>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

/** Props for SettingsStack. */
export interface SettingsStackProps {
  readonly children: ReactNode;
}

/**
 * The page body's rhythm inside a tab's panel: sections (Cards, Tables, a
 * Callout) stacked `space-16` apart, as they are directly in the body.
 */
export function SettingsStack({ children }: SettingsStackProps) {
  return <div className={styles.stack}>{children}</div>;
}
