// The three bars above a view (spec 0003, the app shell): TopBar with the
// page title, ViewBar with the view switcher and the view's actions, and
// Toolbar with the sorts and filters that shape the view, and Save when the
// view has unsaved changes.
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { Toolbar as AriaToolbar } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { Breadcrumbs, type Crumb } from '../../molecules/Breadcrumbs/Breadcrumbs.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { FilterChip } from '../../molecules/FilterChip/FilterChip.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { SegmentedControl, type Segment } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  SubmenuTrigger,
  type MenuKey,
} from '../../molecules/Menu/Menu.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './Toolbar.module.css';
import { strings } from './strings.ts';

// Keys no view or crumb can have: the switcher's Create view, the current view's actions, and the trail's current
// place.
const CREATE = '\u0000create';
const ACTION = '\u0000action:';
const CURRENT = '\u0000current';

/** Past this many views the switcher's menu gets a search field (Menu's own `search`). */
const SWITCHER_SEARCH_FROM = 8;

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
  /** It can move among the views of its group: Alt with the up or down arrow moves it (`onMoveView`). */
  readonly isMovable?: boolean;
}

/** A choice's icon: the lock on a locked view. */
const choiceIcon = (view: ViewChoice): IconName => (view.isLocked === true ? 'lock' : (view.icon ?? 'layout-grid'));

/** The choices as the menu lists them: the ones with no section, then each section in order of first appearance. */
function sectionsOf(views: readonly ViewChoice[]) {
  const loose = views.filter((view) => view.section === undefined);
  const named = [...new Set(views.flatMap((view) => (view.section === undefined ? [] : [view.section])))];
  return { loose, named: named.map((label) => ({ label, views: views.filter((view) => view.section === label) })) };
}

/** One of the current view's actions in the switcher's menu: Rename, Duplicate, Delete view. */
export interface ViewAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Why it can't run now, shown under it, the item disabled; only where the person could act after a change. */
  readonly reason?: string;
  readonly isDanger?: boolean;
  /** Starts a group of its own after a hairline: Rename, Duplicate and Copy link; then sharing; then Delete. */
  readonly startsGroup?: boolean;
  /**
   * The action is a choice of states (Who can see it): a submenu of them, the current one checked. Choosing one
   * runs `onAction` with `<action id>/<choice id>`.
   */
  readonly choices?: readonly ViewActionChoice[];
}

/** One state of a choice action ("Only me", "Everyone", "Everyone, only admins edit"). */
export interface ViewActionChoice {
  readonly id: string;
  readonly label: string;
  readonly isSelected?: boolean;
  /** Why it can't be chosen now, shown under it, the item disabled. */
  readonly reason?: string;
}

/** The view bar's View settings button: what opens the settings, and its anchor for the popover. */
export interface ViewSettingsTrigger {
  readonly onPress: () => void;
  /** The button, for the popover the screen opens from it, and for focus to come back to. */
  readonly ref?: Ref<HTMLButtonElement>;
  /** The settings are open: the button reads as expanded. */
  readonly isOpen?: boolean;
  /** Nothing to show yet (the view still coming): the button stays in place, disabled. */
  readonly isDisabled?: boolean;
}

/** The view bar's layout switch: Table or Board. */
export interface ViewLayoutSwitch {
  /** What it switches ("Layout"). Read by screen readers. */
  readonly label: string;
  /** Give each an icon: on a phone the icons stand alone. */
  readonly segments: readonly Segment[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The layout can't change now: the switch shows it, disabled. */
  readonly isDisabled?: boolean;
}

/** ViewBar's switcher, on an object's page: its saved views. */
interface ViewBarSwitcher {
  readonly views: readonly ViewChoice[];
  readonly currentViewId: string;
  readonly onViewChange: (id: string) => void;
  /** Adds Create view at the end of the switcher's menu. */
  readonly onCreateView?: () => void;
  /**
   * The current view's own actions, under its name at the end of the
   * switcher's menu (the view menu that was a "···" button of its own), and
   * what runs one. Leave out what can never apply; a disabled one says why.
   */
  readonly actions?: readonly ViewAction[];
  readonly onAction?: (id: string) => void;
  /** Moves a view (`isMovable`) up or down its group from the keyboard (Alt with an arrow on its item). */
  readonly onMoveView?: (id: string, direction: 'up' | 'down') => void;
  /** The views are still coming: the switcher is a skeleton until they arrive. */
  readonly isLoading?: boolean;
  /**
   * View settings, the one button at the end of the bar (Attio's): a
   * secondary button the switcher's height, icon alone on a phone.
   */
  readonly settings?: ViewSettingsTrigger;
  /** Table or Board, last in the bar: a compact SegmentedControl, icons alone on a phone. */
  readonly layout?: ViewLayoutSwitch;
}

/** A page with no saved views (Booking pages, Forms): the bar holds the page's tools at its end, and no switcher. */
interface ViewBarToolsOnly {
  readonly views?: never;
  readonly currentViewId?: never;
  readonly onViewChange?: never;
  readonly onCreateView?: never;
  readonly actions?: never;
  readonly onAction?: never;
  readonly onMoveView?: never;
  readonly isLoading?: never;
  readonly settings?: never;
  readonly layout?: never;
}

/** Props for ViewBar: an object's view switcher, or (left out) a page's tools only. */
export type ViewBarProps = (ViewBarSwitcher | ViewBarToolsOnly) & {
  /**
   * The end of the bar: on a view, notices before View settings (the lock line, a paused connection); on a list
   * page, its search.
   */
  readonly children?: ReactNode;
};

/**
 * The bar under the top bar: the view switcher (with the view's own actions in its menu) at the start, and at the
 * end any notices, View settings, then Table or Board, all on one size-control line. Without
 * `views`, a page that has no views (Booking pages, Forms) keeps the same bar for its tools, so its content starts
 * where an object's view does and nothing moves between them.
 */
export function ViewBar(props: ViewBarProps) {
  const { children } = props;
  const showSkeleton = useDelayedLoading(props.isLoading ?? false);
  if (props.views === undefined) {
    return <div className={styles.view}>{children !== undefined && <div className={styles.end}>{children}</div>}</div>;
  }
  const {
    views,
    currentViewId,
    onViewChange,
    onCreateView,
    actions = [],
    onAction: onViewAction,
    onMoveView,
    isLoading = false,
    settings,
    layout,
  } = props;
  const current = views.find((view) => view.id === currentViewId) ?? views[0];
  const actionIds = new Set(
    actions.flatMap((action) => [
      `${ACTION}${action.id}`,
      ...(action.choices ?? []).map((choice) => `${ACTION}${action.id}/${choice.id}`),
    ]),
  );
  const onAction = (key: MenuKey) => {
    if (key === CREATE) onCreateView?.();
    else if (actionIds.has(String(key))) onViewAction?.(String(key).slice(ACTION.length));
    else onViewChange(String(key));
  };
  const { loose, named } = sectionsOf(views);
  const item = (view: ViewChoice) => (
    <MenuItem
      key={view.id}
      id={view.id}
      icon={choiceIcon(view)}
      {...(view.isLocked === true ? { meta: strings.locked } : {})}
      {...(view.isMovable === true && onMoveView !== undefined
        ? {
            onMove: (direction: 'up' | 'down') => {
              onMoveView(view.id, direction);
            },
          }
        : {})}
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
          <Menu
            label={strings.views}
            selectionMode="single"
            selectedKeys={[current.id]}
            onAction={onAction}
            {...(views.length >= SWITCHER_SEARCH_FROM ? { search: { label: strings.searchViews } } : {})}
          >
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
            {actions.length > 0 && <MenuSeparator />}
            {actions.length > 0 && (
              // The view's own actions are plain actions, never choices like the views above them.
              <MenuSection label={strings.thisView} selectionMode="none">
                {actions.flatMap((action, index) => [
                  ...(action.startsGroup === true && index > 0 ? [<MenuSeparator key={`group-${action.id}`} />] : []),
                  action.choices === undefined ? (
                    <MenuItem
                      key={action.id}
                      id={`${ACTION}${action.id}`}
                      icon={action.icon}
                      isDisabled={action.reason !== undefined}
                      {...(action.reason === undefined ? {} : { description: action.reason })}
                      {...(action.isDanger === true ? { isDanger: true } : {})}
                    >
                      {action.label}
                    </MenuItem>
                  ) : (
                    // A choice of states: its submenu, the current one checked.
                    <SubmenuTrigger key={action.id}>
                      <MenuItem id={`${ACTION}${action.id}`} icon={action.icon}>
                        {action.label}
                      </MenuItem>
                      <Menu label={action.label} onAction={onAction}>
                        {action.choices.map((choice) => (
                          <MenuItem
                            key={choice.id}
                            id={`${ACTION}${action.id}/${choice.id}`}
                            isChecked={choice.isSelected === true}
                            isDisabled={choice.reason !== undefined}
                            {...(choice.reason === undefined ? {} : { description: choice.reason })}
                          >
                            {choice.label}
                          </MenuItem>
                        ))}
                      </Menu>
                    </SubmenuTrigger>
                  ),
                ])}
              </MenuSection>
            )}
          </Menu>
        </MenuTrigger>
      )}
      {(children !== undefined || settings !== undefined || layout !== undefined) && (
        <div className={styles.end}>
          {children}
          {settings !== undefined && (
            <Button
              icon="settings"
              label={strings.viewSettings}
              isLabelCollapsible
              onPress={settings.onPress}
              {...(settings.ref === undefined ? {} : { ref: settings.ref })}
              {...(settings.isOpen === undefined ? {} : { isExpanded: settings.isOpen })}
              {...(settings.isDisabled === true ? { isDisabled: true } : {})}
            >
              {strings.viewSettings}
            </Button>
          )}
          {layout !== undefined && (
            <SegmentedControl
              label={layout.label}
              segments={layout.segments}
              value={layout.value}
              onChange={layout.onChange}
              size="compact"
              isLabelCollapsible
              {...(layout.isDisabled === true ? { isDisabled: true } : {})}
            />
          )}
        </div>
      )}
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
  /** At the bar's end, before `end`: the view's search (`ToolbarSearch`). */
  readonly search?: ReactNode;
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
export function Toolbar({ label, children, end, search, status }: ToolbarProps) {
  return (
    <AriaToolbar className={styles.toolbar} aria-label={label}>
      {children}
      {(end !== undefined || search !== undefined) && (
        <div className={styles.end}>
          {search}
          {end}
        </div>
      )}
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
  /**
   * The order nobody chose (a view with no sorts runs Created at, newest first): a muted "Sorted by Created at"
   * with no direction part and no remove, so the order is never a mystery and never looks like a choice.
   */
  readonly isDefault?: boolean;
}

/**
 * The toolbar's statement of the sort, in the filter chips' shape (spec 0020,
 * the owner's "filter and sort can be similar"): the direction's arrow and the
 * attribute, the direction in words, "+N" for the further sorts, and remove.
 * Every part opens the sort builder.
 */
export function SortChip({ attribute, direction, more = 0, onPress, onRemove, ref, isDefault = false }: SortChipProps) {
  const press =
    onPress === undefined ? {} : { onPressAttribute: onPress, onPressOperator: onPress, onPressValue: onPress };
  if (isDefault) {
    return (
      <FilterChip
        tone="muted"
        icon={direction === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
        attribute={[strings.sortedBy(attribute)]}
        hasValue={false}
        label={strings.defaultSortName(attribute, direction)}
        {...press}
        {...(ref === undefined ? {} : { ref })}
      />
    );
  }
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

/** Props for ToolbarSearch. */
export interface ToolbarSearchProps {
  /** What it searches, for screen readers and as the placeholder: "Search people". */
  readonly label: string;
  /** What is typed; the screen narrows the view by it. */
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * A view's search at the Toolbar's end: a ghost search button that opens into a search field, focused. Esc clears
 * it and folds it back to the button, which takes focus; leaving it empty folds it too. Typed text keeps it open.
 */
export function ToolbarSearch({ label, value, onChange }: ToolbarSearchProps) {
  const [isOpen, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  if (!isOpen && value === '') {
    return (
      <Button
        ref={button}
        variant="ghost"
        icon="search"
        label={label}
        onPress={() => {
          setOpen(true);
          focusLater(() => field.current);
        }}
      />
    );
  }
  return (
    <span className={styles.search}>
      <Field
        label={label}
        isLabelHidden
        placeholder={label}
        variant="search"
        size="sm"
        type="search"
        value={value}
        autoComplete="off"
        onChange={onChange}
        ref={field}
        onEscape={() => {
          onChange('');
          setOpen(false);
          focusLater(() => button.current);
        }}
        onBlur={() => {
          if (value === '') setOpen(false);
        }}
      />
    </span>
  );
}
