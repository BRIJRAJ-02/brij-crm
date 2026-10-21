// The frame of every settings page (spec 0012, pulled forward from spec 0003's
// milestone 4): the settings navigation beside the page, and the page's
// header (its title, a tile, a badge, a line of description and its actions)
// over its body. The body is the screen's: Tabs, Cards, Tables, EmptyState.
// Since spec 0026 the app's settings navigation is the Sidebar's settings
// variant, so `nav` is optional. Since 21 Oct 2026 the app's settings pages
// sit under a TopBar holding their trail and h1; `titleLevel={1}` with
// `trail` is for a page with no TopBar above it.
import { useContext, useId, type ReactNode, type Ref } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { Breadcrumbs, type Crumb } from '../../molecules/Breadcrumbs/Breadcrumbs.tsx';
import { CardTitleLevel } from '../../molecules/Card/Card.tsx';
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
  /**
   * The settings pages, in order, as a column beside the page. Leave it out
   * when the app's sidebar is the settings navigation (spec 0026).
   */
  readonly nav?: readonly SettingsNavEntry[];
  /** The id of the page shown, marked as the current one. */
  readonly currentNavId?: string;
  /** Names the navigation landmark ("Settings"). */
  readonly navLabel?: string;
  /** The page's title: its second level heading under a TopBar, or its h1 with `titleLevel={1}`. */
  readonly title: string;
  /**
   * 1 when no TopBar sits above (spec 0026): the title is the page's h1,
   * which the app focuses after a route change, and Cards in the body take
   * h2 titles. 2 (the default) under a TopBar.
   */
  readonly titleLevel?: 1 | 2;
  /**
   * Where the page sits, above the title ("Account › Preferences"): a place
   * with an `href` is a link, one without is a group's name, the last is this page.
   */
  readonly trail?: readonly Crumb[];
  /**
   * The body opens with Tabs (an object's Attributes and Configuration): the
   * header drops its hairline, since the tabs' own underline divides the page.
   */
  readonly hasTabs?: boolean;
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
   * While loading, the page will have a tile before its title (an object's page) whose icon isn't known yet: its
   * place shows as a skeleton tile, so the title and the tabs under it don't move when it arrives.
   */
  readonly hasTile?: boolean;
  /**
   * The visible title, which takes focus by script (never a tab stop) when
   * the control in use went away with its change (an archived row, a
   * cancelled job's Cancel): the TopBar's h1 is visually hidden under a trail.
   */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /**
   * `bar`: the TopBar above holds the page's trail, title (its h1), tile,
   * badge and one primary action, so the layout draws no header of its own,
   * and the body's sections take h2 headings right under that h1. The owner's
   * call (21 October 2026): a big title with a line under it repeated the
   * trail and the first section. `page` (the default) draws the header.
   */
  readonly header?: 'page' | 'bar';
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
  titleLevel = 2,
  trail,
  hasTabs = false,
  icon,
  hue,
  meta,
  description,
  actions,
  isLoading = false,
  hasTile = false,
  titleRef,
  header = 'page',
  children,
}: SettingsLayoutProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  if (header === 'bar') {
    return (
      <div className={styles.root} data-has-nav={nav === undefined ? undefined : true}>
        {nav !== undefined && <SettingsNav nav={nav} currentNavId={currentNavId} navLabel={navLabel} />}
        <div className={styles.page} data-header="bar" aria-busy={isLoading || undefined}>
          {isLoading && <VisuallyHidden>{strings.loading}</VisuallyHidden>}
          {/* Under the bar's h1, the body's sections and Cards take h2 titles. */}
          <div className={styles.body}>
            <CardTitleLevel value={2}>{children}</CardTitleLevel>
          </div>
        </div>
      </div>
    );
  }
  const Heading = titleLevel === 1 ? 'h1' : 'h2';
  const trailLine =
    trail !== undefined && trail.length > 0 ? (
      <span className={styles.trail}>
        <Breadcrumbs items={trail} />
      </span>
    ) : null;
  return (
    <div className={styles.root} data-has-nav={nav === undefined ? undefined : true}>
      {nav !== undefined && <SettingsNav nav={nav} currentNavId={currentNavId} navLabel={navLabel} />}
      <div className={styles.page}>
        {isLoading ? (
          <div className={styles.header} aria-busy="true" data-has-tabs={hasTabs || undefined}>
            {/* The trail is known before the page loads, so it stays put and the header doesn't shift. */}
            {trailLine}
            {/* Each part in the loaded header's own place: the tile, the title's line, the description known already. */}
            {icon !== undefined ? (
              <Icon name={icon} tile={hue ?? 'gray'} />
            ) : (
              hasTile && showSkeleton && <Skeleton shape="tile" />
            )}
            <span className={styles.text}>
              <span className={styles.titleSlot}>{showSkeleton && <Skeleton width="medium" />}</span>
              {description !== undefined && <span className={styles.description}>{description}</span>}
            </span>
            {actions !== undefined && <span className={styles.actions}>{actions}</span>}
            {/* The h1 keeps the page's title for screen readers and the app's focus while it loads. */}
            {titleLevel === 1 ? (
              <VisuallyHidden>
                <h1 ref={titleRef} tabIndex={-1}>
                  {title}
                </h1>
              </VisuallyHidden>
            ) : null}
            <VisuallyHidden>{strings.loading}</VisuallyHidden>
          </div>
        ) : (
          <header className={styles.header} data-has-tabs={hasTabs || undefined}>
            {trailLine}
            {icon !== undefined && <Icon name={icon} tile={hue ?? 'gray'} />}
            <span className={styles.text}>
              <span className={styles.heading}>
                <Heading className={styles.title} ref={titleRef} tabIndex={-1} data-settings-title>
                  {title}
                </Heading>
                {meta}
              </span>
              {description !== undefined && <span className={styles.description}>{description}</span>}
            </span>
            {actions !== undefined && <span className={styles.actions}>{actions}</span>}
          </header>
        )}
        {/* Under an h1 title, the body's Cards take h2 titles. */}
        <div className={styles.body}>
          {titleLevel === 1 ? <CardTitleLevel value={2}>{children}</CardTitleLevel> : children}
        </div>
      </div>
    </div>
  );
}

/** The settings pages as a column beside the page, the one shown marked. */
function SettingsNav({
  nav,
  currentNavId,
  navLabel,
}: {
  readonly nav: readonly SettingsNavEntry[];
  readonly currentNavId: string | undefined;
  readonly navLabel: string;
}) {
  return (
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

/** Props for SettingsSection. */
export interface SettingsSectionProps {
  /** What the section holds ("Appearance"): its heading, one level under the page's title. */
  readonly title: string;
  /** One short muted line, only when the heading alone doesn't say what the settings change. */
  readonly description?: ReactNode;
  /** The section's settings: Cards (of SettingsRows, or a Form), a SettingsGrid of Cards, a Callout. */
  readonly children: ReactNode;
}

/**
 * One group of settings across the page's width: its heading, and a line of
 * description only when the heading needs one, above its cards (21 Oct 2026:
 * one column, no label column beside them), and a hairline before the next
 * section. A list (a Table) needs no section: it runs the full width.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  const headingId = useId();
  // The page's h1 makes the body's headings h2 (SettingsLayout's CardTitleLevel); under a TopBar they are h3.
  const level = useContext(CardTitleLevel);
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionText}>
        <Heading className={styles.sectionTitle} id={headingId}>
          {title}
        </Heading>
        {description !== undefined && <p className={styles.sectionDescription}>{description}</p>}
      </div>
      <div className={styles.sectionBody}>
        {/* The cards sit under the section's heading. */}
        <CardTitleLevel value={level === 2 ? 3 : 4}>{children}</CardTitleLevel>
      </div>
    </section>
  );
}

/** Props for SettingsGrid. */
export interface SettingsGridProps {
  /** Cards of the same kind: one per calendar, one per integration. */
  readonly children: ReactNode;
}

/**
 * Cards of one kind side by side: as many columns as keep each card at least
 * the panel's width (one on a phone), every card the same width.
 */
export function SettingsGrid({ children }: SettingsGridProps) {
  return <div className={styles.grid}>{children}</div>;
}

/** Props for SettingsRow. */
export interface SettingsRowProps {
  /** What the setting is ("Interface theme"), or the thing the row stands for (a calendar's account); also name the control with it. */
  readonly title: string;
  /** One muted line on what it changes, or the thing's state ("Connected, synced 4 minutes ago"). */
  readonly description?: ReactNode;
  /** Before the text: a provider's mark, for a row that stands for a connected account. */
  readonly leading?: ReactNode;
  /** Beside the title: a Badge ("Default"), or an InfoTip when the title needs a word of help. */
  readonly meta?: ReactNode;
  /** The control, at the end of the row: a Select, a Switch, a Button, a row's "···" menu. */
  readonly children: ReactNode;
}

/**
 * One setting as a row (spec 0026, AC-683): its title over a muted
 * description, and its control at the end. Rows stack inside a Card, a
 * hairline between them; on a narrow page the control drops under the text.
 * A row can also stand for one thing of a kind (a connected calendar): a
 * mark before its text, a badge beside its title, its controls at the end.
 */
export function SettingsRow({ title, description, leading, meta, children }: SettingsRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.rowMain}>
        {leading !== undefined && <span className={styles.rowLeading}>{leading}</span>}
        <span className={styles.rowText}>
          <span className={styles.rowHeading}>
            <span className={styles.rowTitle}>{title}</span>
            {meta}
          </span>
          {description !== undefined && <span className={styles.description}>{description}</span>}
        </span>
      </span>
      <span className={styles.rowControl}>{children}</span>
    </div>
  );
}
