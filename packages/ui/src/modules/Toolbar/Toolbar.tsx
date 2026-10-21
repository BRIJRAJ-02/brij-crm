// The three bars above a view (spec 0003, the app shell): TopBar with the
// page title, ViewBar with the view switcher and the view's actions, and
// Toolbar with the sorts and filters that shape the view, and Save when the
// view has unsaved changes.
import type { ReactNode, Ref } from 'react';
import { Toolbar as AriaToolbar } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { Breadcrumbs, type Crumb } from '../../molecules/Breadcrumbs/Breadcrumbs.tsx';
import { FilterChip } from '../../molecules/FilterChip/FilterChip.tsx';
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
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
  // One tree for loading and loaded: the hidden h1 keeps its place (third), so a page that loads in place keeps
  // the focus the app gave its title when the title arrives.
  const tile = icon === undefined ? null : hue === undefined ? <Icon name={icon} /> : <Icon name={icon} tile={hue} />;
  const skeleton = showSkeleton ? (
    <span className={styles.loading}>
      <Skeleton width="long" />
    </span>
  ) : null;
  let shownTitle: ReactNode = null;
  if (!isLoading) shownTitle = hasTrail ? <Breadcrumbs items={[...crumbs, { id: CURRENT, label: title }]} /> : heading;
  return (
    <header className={styles.top} aria-busy={isLoading || undefined}>
      {isLoading ? skeleton : tile}
      {shownTitle}
      {isLoading || hasTrail ? <VisuallyHidden>{heading}</VisuallyHidden> : null}
      {isLoading ? null : meta}
      {!isLoading && children !== undefined && <div className={styles.end}>{children}</div>}
    </header>
  );
}

/** One saved view in the switcher. */
export interface ViewChoice {
  readonly id: string;
  readonly name: string;
  readonly icon?: IconName;
  /**
   * The group it is listed under ("Private"), in the order the groups first
   * appear; choices with none come first, under no heading.
   */
  readonly section?: string;
  /** A locked view (spec 0020): the lock icon in place of its own, and "Locked" at the end of its menu item. */
  readonly isLocked?: boolean;
}

/** A choice's icon: the lock on a locked view. */
const choiceIcon = (view: ViewChoice): IconName => (view.isLocked === true ? 'lock' : (view.icon ?? 'layout-grid'));

/** The choices as the menu lists them: the ones with no section, then each section in order of first appearance. */
function sectionsOf(views: readonly ViewChoice[]) {
  const loose = views.filter((view) => view.section === undefined);
  const named = [...new Set(views.flatMap((view) => (view.section === undefined ? [] : [view.section])))];
  return { loose, named: named.map((label) => ({ label, views: views.filter((view) => view.section === label) })) };
}

/** ViewBar's switcher, on an object's page: its saved views. */
interface ViewBarSwitcher {
  readonly views: readonly ViewChoice[];
  readonly currentViewId: string;
  readonly onViewChange: (id: string) => void;
  /** Adds Create view at the end of the switcher's menu. */
  readonly onCreateView?: () => void;
  /** The views are still coming: the switcher is a skeleton until they arrive. */
  readonly isLoading?: boolean;
}

/** A page with no saved views (Booking pages, Forms): the bar holds the page's tools at its end, and no switcher. */
interface ViewBarToolsOnly {
  readonly views?: never;
  readonly currentViewId?: never;
  readonly onViewChange?: never;
  readonly onCreateView?: never;
  readonly isLoading?: never;
}

/** Props for ViewBar: an object's view switcher, or (left out) a page's tools only. */
export type ViewBarProps = (ViewBarSwitcher | ViewBarToolsOnly) & {
  /** The end of the bar: View settings, Import / Export, the Table and Board switch; a list page's search. */
  readonly children?: ReactNode;
};

/**
 * The bar under the top bar: the view switcher at the start, and the view's own actions at the end. Without
 * `views`, a page that has no views (Booking pages, Forms) keeps the same bar for its tools, so its content starts
 * where an object's view does and nothing moves between them.
 */
export function ViewBar(props: ViewBarProps) {
  const { children } = props;
  const showSkeleton = useDelayedLoading(props.isLoading ?? false);
  if (props.views === undefined) {
    return <div className={styles.view}>{children !== undefined && <div className={styles.end}>{children}</div>}</div>;
  }
  const { views, currentViewId, onViewChange, onCreateView, isLoading = false } = props;
  const current = views.find((view) => view.id === currentViewId) ?? views[0];
  const onAction = (key: MenuKey) => {
    if (key === CREATE) onCreateView?.();
    else onViewChange(String(key));
  };
  const { loose, named } = sectionsOf(views);
  const item = (view: ViewChoice) => (
    <MenuItem
      key={view.id}
      id={view.id}
      icon={choiceIcon(view)}
      {...(view.isLocked === true ? { meta: strings.locked } : {})}
    >
      {view.name}
    </MenuItem>
  );
  return (
    <div className={styles.view}>
      {isLoading || current === undefined ? (
        <span className={styles.loading} aria-busy="true">
          {showSkeleton && <Skeleton width="short" />}
          <VisuallyHidden>{strings.loadingViews}</VisuallyHidden>
        </span>
      ) : (
        <MenuTrigger>
          <Button variant="ghost" icon={choiceIcon(current)} iconRight="chevron-down">
            {current.name}
          </Button>
          <Menu label={strings.views} selectionMode="single" selectedKeys={[current.id]} onAction={onAction}>
            {loose.map(item)}
            {named.map((section) => (
              <MenuSection key={section.label} label={section.label}>
                {section.views.map(item)}
              </MenuSection>
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
  /**
   * What the view's condition now matches, for screen readers only ("124
   * people match"): spoken when it changes, never shown.
   */
  readonly status?: string;
}

/**
 * The size-toolbar tall bar that states how the view is shaped. A React Aria
 * toolbar: Tab enters it once, and the arrow keys move between its controls.
 */
export function Toolbar({ label, children, end, status }: ToolbarProps) {
  return (
    <AriaToolbar className={styles.toolbar} aria-label={label}>
      {children}
      {end !== undefined && <div className={styles.end}>{end}</div>}
      <VisuallyHidden>
        <span role="status">{status ?? ''}</span>
      </VisuallyHidden>
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
  /** Opens the sort builder: every part of the chip does. */
  readonly onPress?: () => void;
  /** Takes every sort away. Without it the chip has no remove part (a view you can't edit). */
  readonly onRemove?: () => void;
  /** The chip, for a popover the screen opens from it (spec 0020: the sort builder). */
  readonly ref?: Ref<HTMLSpanElement>;
}

/**
 * The toolbar's statement of the sort, in the filter chips' shape (spec 0020,
 * the owner's "filter and sort can be similar"): the direction's arrow and the
 * attribute, the direction in words, "+N" for the further sorts, and remove.
 * Every part opens the sort builder.
 */
export function SortChip({ attribute, direction, more = 0, onPress, onRemove, ref }: SortChipProps) {
  const press =
    onPress === undefined ? {} : { onPressAttribute: onPress, onPressOperator: onPress, onPressValue: onPress };
  return (
    <FilterChip
      icon={direction === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
      attribute={[attribute]}
      operator={strings.directions[direction]}
      hasValue={more > 0}
      {...(more > 0 ? { value: strings.more(more) } : {})}
      label={strings.sortName(attribute, direction, more)}
      removeLabel={strings.removeSorts(more + 1)}
      {...press}
      {...(onRemove === undefined ? {} : { onRemove })}
      {...(ref === undefined ? {} : { ref })}
    />
  );
}
