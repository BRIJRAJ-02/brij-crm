// The three bars above a view (spec 0003, the app shell): TopBar with the
// page title, ViewBar with the view switcher and the view's actions, and
// Toolbar with the sorts and filters that shape the view, and Save when the
// view has unsaved changes.
import type { ReactNode, Ref } from 'react';
import { Button as AriaButton, Toolbar as AriaToolbar } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { Breadcrumbs, type Crumb } from '../../molecules/Breadcrumbs/Breadcrumbs.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './Toolbar.module.css';
import { strings } from './strings.ts';

// Keys no view or crumb can have: the switcher's Create view, and the trail's current place.
const CREATE = '\u0000create';
const CURRENT = '\u0000current';

/** Props for TopBar. */
export interface TopBarProps {
  /** The page's title, and its one heading: the app moves focus here after a route change. */
  readonly title: string;
  /** The object's icon, on its hue tile when `hue` is given. */
  readonly icon?: IconName;
  readonly hue?: Hue;
  /** Where the page sits: Companies › Northwind. The trail ends with the title, as the current place. */
  readonly crumbs?: readonly Crumb[];
  /** Beside the title: an info button, the favourite star. */
  readonly meta?: ReactNode;
  /** The end of the bar: who else is here, the page's actions. */
  readonly children?: ReactNode;
  /** The title's heading, for the app to focus after navigating. */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /**
   * The page is still loading: after the loading delay a skeleton line stands
   * in for the icon and title, and the bar keeps its height, so the page
   * doesn't jump when it arrives. The h1 keeps `title` ("Loading") for
   * screen readers and focus.
   */
  readonly isLoading?: boolean;
}

/**
 * The size-bar tall bar at the top of a page: the object's tile, the title as
 * the page's h1, and the page's actions. With `crumbs`, the trail shows the
 * title as its current place and the h1 stays for screen readers.
 */
export function TopBar({ title, icon, hue, crumbs, meta, children, titleRef, isLoading = false }: TopBarProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  const hasTrail = crumbs !== undefined && crumbs.length > 0;
  // Focused only by the app after a route change, so it never joins the tab order.
  const heading = (
    <h1 ref={titleRef} className={styles.title} tabIndex={-1}>
      {title}
    </h1>
  );
  if (isLoading) {
    return (
      <header className={styles.top} aria-busy="true">
        {showSkeleton && (
          <span className={styles.loading}>
            <Skeleton width="long" />
          </span>
        )}
        <VisuallyHidden>{heading}</VisuallyHidden>
      </header>
    );
  }
  return (
    <header className={styles.top}>
      {icon !== undefined && (hue === undefined ? <Icon name={icon} /> : <Icon name={icon} tile={hue} />)}
      {hasTrail ? (
        <>
          <Breadcrumbs items={[...crumbs, { id: CURRENT, label: title }]} />
          <VisuallyHidden>{heading}</VisuallyHidden>
        </>
      ) : (
        heading
      )}
      {meta}
      {children !== undefined && <div className={styles.end}>{children}</div>}
    </header>
  );
}

/** One saved view in the switcher. */
export interface ViewChoice {
  readonly id: string;
  readonly name: string;
  readonly icon?: IconName;
}

/** Props for ViewBar. */
export interface ViewBarProps {
  readonly views: readonly ViewChoice[];
  readonly currentViewId: string;
  readonly onViewChange: (id: string) => void;
  /** Adds Create view at the end of the switcher's menu. */
  readonly onCreateView?: () => void;
  /** The views are still coming: the switcher is a skeleton until they arrive. */
  readonly isLoading?: boolean;
  /** The end of the bar: View settings, Import / Export, the Table and Board switch. */
  readonly children?: ReactNode;
}

/** The bar under the top bar: the view switcher at the start, and the view's own actions at the end. */
export function ViewBar({
  views,
  currentViewId,
  onViewChange,
  onCreateView,
  isLoading = false,
  children,
}: ViewBarProps) {
  const showSkeleton = useDelayedLoading(isLoading);
  const current = views.find((view) => view.id === currentViewId) ?? views[0];
  const onAction = (key: MenuKey) => {
    if (key === CREATE) onCreateView?.();
    else onViewChange(String(key));
  };
  return (
    <div className={styles.view}>
      {isLoading || current === undefined ? (
        <span className={styles.loading} aria-busy="true">
          {showSkeleton && <Skeleton width="short" />}
          <VisuallyHidden>{strings.loadingViews}</VisuallyHidden>
        </span>
      ) : (
        <MenuTrigger>
          <Button variant="ghost" icon={current.icon ?? 'layout-grid'} iconRight="chevron-down">
            {current.name}
          </Button>
          <Menu label={strings.views} selectionMode="single" selectedKeys={[current.id]} onAction={onAction}>
            {views.map((view) => (
              <MenuItem key={view.id} id={view.id} icon={view.icon ?? 'layout-grid'}>
                {view.name}
              </MenuItem>
            ))}
            {onCreateView !== undefined && <MenuSeparator />}
            {onCreateView !== undefined && (
              <MenuItem id={CREATE} icon="plus">
                {strings.createView}
              </MenuItem>
            )}
          </Menu>
        </MenuTrigger>
      )}
      {children !== undefined && <div className={styles.end}>{children}</div>}
    </div>
  );
}

/** Props for Toolbar. */
export interface ToolbarProps {
  /** The toolbar's name ("View options"). */
  readonly label: string;
  /** The view's condition, start to end: SortChips, FilterChips, then the dashed Filter. */
  readonly children: ReactNode;
  /** Only while the view has unsaved changes: Discard changes (ghost), then Save (split primary). */
  readonly end?: ReactNode;
}

/**
 * The size-toolbar tall bar that states how the view is shaped. A React Aria
 * toolbar: Tab enters it once, and the arrow keys move between its controls.
 */
export function Toolbar({ label, children, end }: ToolbarProps) {
  return (
    <AriaToolbar className={styles.toolbar} aria-label={label}>
      {children}
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </AriaToolbar>
  );
}

/** Props for SortChip. */
export interface SortChipProps {
  /** The attribute the view sorts by first. */
  readonly attribute: string;
  readonly direction: 'ascending' | 'descending';
  /** How many further sorts follow it: "+1". */
  readonly more?: number;
  /** Opens the sort builder. */
  readonly onPress?: () => void;
}

/** The toolbar's statement of the sort: "Sorted by Funding raised", with its direction's arrow. A button that opens the sort builder. */
export function SortChip({ attribute, direction, more = 0, onPress }: SortChipProps) {
  return (
    <AriaButton
      className={styles.sort}
      aria-label={strings.sortName(attribute, direction, more)}
      {...(onPress === undefined ? {} : { onPress })}
    >
      <Icon name={direction === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'} size="sm" />
      <span className={styles.sortKey}>{strings.sortedBy}</span>
      <span className={styles.sortName}>{attribute}</span>
      {more > 0 && <span className={styles.sortKey}>{strings.more(more)}</span>}
    </AriaButton>
  );
}
