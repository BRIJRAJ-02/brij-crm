// The app's left column (spec 0003, the app shell): the workspace switcher,
// Quick actions, the fixed destinations, folding Favorites, Records and
// Lists sections, and unlabelled groups of destinations after them. Collapsed, it is a rail of icons, each named in a tooltip.
// Its settings variant (spec 0026) swaps the workspace row for a title with a back link, and lists labelled groups.
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button as AriaButton, Link as AriaLink, type LinkProps } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import { keyShortcuts } from '../../atoms/Kbd/shortcuts.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { ShortcutTooltip } from '../../atoms/Tooltip/ShortcutTooltip.tsx';
import { Tooltip, type TooltipProps } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { SortableList, useSortableItem } from '../../lib/drag/drag.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useKeyboardPlatform } from '../../provider/context.ts';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { AppShellContext } from '../AppShell/AppShell.tsx';
import styles from './Sidebar.module.css';
import { strings } from './strings.ts';

const SidebarContext = createContext({ isCollapsed: false });

/** What a render function for the sidebar's footer is told. */
export interface SidebarState {
  /** Folded to its rail: icons only, `size-sidebar-collapsed` wide. */
  readonly isCollapsed: boolean;
}

/** The settings variant's head (spec 0026): its title, and the link back to the page the person came from. */
export interface SidebarBack {
  /** Where the back link goes: the page Settings was opened from, else the workspace's home. */
  readonly href: string;
  /** The back link's name ("Leave settings"), also its tooltip. */
  readonly label: string;
}

/** The app's head: the workspace's name and its menu. */
interface WorkspaceHead {
  /** The workspace's name, at the top. */
  readonly workspace: string;
  /**
   * The workspace isn't known yet (the frame is loading): its mark and name
   * are skeletons, with no menu, so no stand in name flashes before the real one.
   */
  readonly isWorkspaceLoading?: boolean;
  /** The workspace switcher: a `Menu` the name opens. Without it the name is plain. */
  readonly workspaceMenu?: ReactElement;
  /**
   * In place of the workspace's letter avatar: the product's mark (Timefix's
   * `ProviderMark` at `lg`), as timefix heads its sidebar. Decorative: the
   * workspace's name stays the button's name.
   */
  readonly mark?: ReactNode;
  /**
   * Something chosen from the workspace menu is under way (signing out): the
   * button shows a spinner in place of its chevron (of the mark, on the rail),
   * ignores presses and says it is busy. Name what is under way in `workspaceBusyLabel`.
   */
  readonly isWorkspaceBusy?: boolean;
  /** What is under way, read by screen readers ("Signing out"). */
  readonly workspaceBusyLabel?: string;
  readonly heading?: never;
  readonly back?: never;
}

/** The settings variant's head: a title and a back link in place of the workspace. */
interface HeadingHead {
  /** The title at the top ("Settings"): plain text (the landmark's `label` names it for screen readers), left off on the rail. */
  readonly heading: string;
  /** The link back out, before the title. */
  readonly back: SidebarBack;
  readonly workspace?: never;
  readonly isWorkspaceLoading?: never;
  readonly workspaceMenu?: never;
  readonly mark?: never;
  readonly isWorkspaceBusy?: never;
  readonly workspaceBusyLabel?: never;
}

/** Props for Sidebar: the app's (a workspace at the top) or the settings variant's (a title and a back link). */
export type SidebarProps = (WorkspaceHead | HeadingHead) & {
  /** Opens the command palette; the screen also answers ⌘K. */
  readonly onQuickActions?: () => void;
  /** `NavItem`s for the fixed destinations, then `NavSection`s or `NavGroup`s. */
  readonly children: ReactNode;
  /**
   * Settings and Help, at the bottom. A function gets whether the
   * sidebar is folded to its rail (by `isCollapsed`, or by the app shell
   * below `bp-page-compact`), so the footer can fit it.
   */
  readonly footer?: ReactNode | ((state: SidebarState) => ReactNode);
  /** The narrow rail: icons only, each named in a tooltip. Inside the app shell it folds below `bp-page-compact` and stays folded there. */
  readonly isCollapsed?: boolean;
  /** Shows the collapse and expand buttons, and says when they are pressed. */
  readonly onCollapsedChange?: (isCollapsed: boolean) => void;
  /** The key that folds and unfolds it (the app's `[`), shown in the collapse and expand buttons' tooltips. */
  readonly collapseKbd?: string;
  /** The navigation landmark's name. Defaults to "Main navigation". */
  readonly label?: string;
  /**
   * How the keyboard moves through the items. `tab` (the default): each item
   * is a tab stop. `arrows`: the items are one tab stop (the focused one while
   * focus is inside, else the current page's, else the first), and the arrow
   * keys, Home and End move between them, so Tab passes the list in one press
   * (the settings navigation, AC-687).
   */
  readonly keyboard?: 'tab' | 'arrows';
};

/**
 * The 260px left column, or the 48px rail when collapsed. It is the app's
 * navigation landmark. Items are size-nav-item tall; the current page takes
 * `surface-selected`, hover `surface-hover`.
 */
export function Sidebar(props: SidebarProps) {
  const {
    onQuickActions,
    children,
    footer,
    isCollapsed: isCollapsedProp = false,
    onCollapsedChange: onCollapsedChangeProp,
    collapseKbd,
    label = strings.navigation,
    keyboard = 'tab',
  } = props;
  // Below the compact breakpoint the shell folds it, and it stays folded.
  const { isCompact } = useContext(AppShellContext);
  const isCollapsed = isCollapsedProp || isCompact;
  const onCollapsedChange = isCompact ? undefined : onCollapsedChangeProp;
  const foot = typeof footer === 'function' ? footer({ isCollapsed }) : footer;
  const bodyRef = useRef<HTMLDivElement>(null);
  useArrowKeys(bodyRef, keyboard === 'arrows');
  const collapse =
    onCollapsedChange !== undefined && !isCollapsed ? (
      <TipWithKeys content={strings.collapse} placement="bottom" kbd={collapseKbd}>
        <Button
          variant="ghost"
          icon="panel-left-close"
          label={strings.collapse}
          onPress={() => {
            onCollapsedChange(true);
          }}
        />
      </TipWithKeys>
    ) : null;
  return (
    <SidebarContext value={{ isCollapsed }}>
      <nav
        className={styles.root}
        aria-label={label}
        data-collapsed={isCollapsed || undefined}
        // Marks a list the arrow keys move through, so the app can leave focus in it after a route change.
        data-keyboard={keyboard}
      >
        <div className={styles.head}>
          {props.heading === undefined ? (
            <WorkspaceRow {...props} isCollapsed={isCollapsed} />
          ) : (
            <HeadingRow heading={props.heading} back={props.back} isCollapsed={isCollapsed} />
          )}
          {collapse}
        </div>
        {isCollapsed && (onQuickActions !== undefined || onCollapsedChange !== undefined) ? (
          // The rail's top: Expand, under the head where Collapse sits when open, then Quick actions, each a size-nav-item
          // item like every other on the rail, named with its shortcut in a tooltip (no keycap squeezed in).
          <div className={styles.railTop}>
            {onCollapsedChange !== undefined && (
              <NavItem
                icon="panel-left-open"
                {...(collapseKbd === undefined ? {} : { kbd: collapseKbd })}
                onPress={() => {
                  onCollapsedChange(false);
                }}
              >
                {strings.expand}
              </NavItem>
            )}
            {onQuickActions !== undefined && (
              <NavItem icon="search" kbd={strings.quickActionsKey} onPress={onQuickActions}>
                {strings.quickActions}
              </NavItem>
            )}
          </div>
        ) : (
          onQuickActions !== undefined && (
            <div className={styles.search}>
              <Button size="lg" icon="search" isFullWidth kbd={strings.quickActionsKey} onPress={onQuickActions}>
                {strings.quickActions}
              </Button>
            </div>
          )
        )}
        <div className={styles.scroll}>
          <div
            ref={bodyRef}
            className={styles.body}
            {...(keyboard === 'arrows'
              ? {
                  onKeyDown: (event: KeyboardEvent) => {
                    moveByArrow(event, bodyRef.current);
                  },
                }
              : {})}
          >
            {children}
          </div>
        </div>
        {foot !== undefined && <div className={styles.foot}>{foot}</div>}
      </nav>
    </SidebarContext>
  );
}

/** The app's head: the workspace's mark and name, opening its menu. */
function WorkspaceRow({
  workspace,
  isWorkspaceLoading = false,
  workspaceMenu,
  isWorkspaceBusy = false,
  workspaceBusyLabel,
  mark: brand,
  isCollapsed,
}: WorkspaceHead & { readonly isCollapsed: boolean }) {
  const showWorkspaceSkeleton = useDelayedLoading(isWorkspaceLoading);
  const spinner = <Spinner {...(workspaceBusyLabel === undefined ? {} : { label: workspaceBusyLabel })} />;
  const mark =
    isWorkspaceBusy && isCollapsed
      ? spinner
      : (brand ?? <Avatar name={workspace} hue="ink" shape="square" size="sm" isDecorative />);
  const name = isCollapsed ? (
    <VisuallyHidden>{workspace}</VisuallyHidden>
  ) : (
    <span className={styles.name}>{workspace}</span>
  );
  if (isWorkspaceLoading) {
    return (
      <span className={styles.workspace} aria-busy="true">
        {/* After the loading delay, so a quick load flashes nothing. */}
        {showWorkspaceSkeleton && <Skeleton shape="tile" />}
        {showWorkspaceSkeleton && !isCollapsed && <Skeleton width="medium" />}
        <VisuallyHidden>{strings.loadingWorkspace}</VisuallyHidden>
      </span>
    );
  }
  if (workspaceMenu === undefined) {
    return (
      <span className={styles.workspace}>
        {mark}
        {name}
      </span>
    );
  }
  const switcher = (
    <AriaButton className={styles.switcher} aria-label={strings.workspaceMenu(workspace)} isPending={isWorkspaceBusy}>
      {mark}
      {name}
      {!isCollapsed && (isWorkspaceBusy ? spinner : <Icon name="chevron-down" size="sm" tone="muted" />)}
    </AriaButton>
  );
  return (
    <MenuTrigger>
      {/* On the rail the mark alone shows, so a tooltip names the workspace, as every rail item is named. */}
      {isCollapsed ? (
        <Tooltip content={workspace} placement="end">
          {switcher}
        </Tooltip>
      ) : (
        switcher
      )}
      {workspaceMenu}
    </MenuTrigger>
  );
}

/** The settings variant's head: the back link, then the title (on the rail, the back link alone, named in a tooltip). */
function HeadingRow({
  heading,
  back,
  isCollapsed,
}: {
  readonly heading: string;
  readonly back: SidebarBack;
  readonly isCollapsed: boolean;
}) {
  return (
    <span className={styles.workspace}>
      <Tooltip content={back.label} placement={isCollapsed ? 'end' : 'bottom'}>
        <ButtonLink variant="ghost" icon="arrow-left" label={back.label} href={back.href} />
      </Tooltip>
      {/* Plain text, not a heading: it sits before the page's h1, and the landmark already carries the name. */}
      {!isCollapsed && <span className={styles.name}>{heading}</span>}
    </span>
  );
}

/** The items the arrow keys move between: every link and enabled button in the body (React Aria marks a disabled one with `data-disabled`). */
const ITEMS = 'a[href]:not([data-disabled]), button:not([disabled], [data-disabled])';

/** The body's items, in order. */
function itemsOf(body: HTMLElement | null): HTMLElement[] {
  return body === null ? [] : [...body.querySelectorAll<HTMLElement>(ITEMS)];
}

/**
 * One tab stop for the body's items (a roving tab index): the focused one
 * while focus is inside, else the current page's, else the first. Kept after
 * every render, so an item that arrives later joins in.
 */
function useArrowKeys(bodyRef: { readonly current: HTMLDivElement | null }, isOn: boolean) {
  useLayoutEffect(() => {
    if (!isOn) return;
    const items = itemsOf(bodyRef.current);
    const stop =
      items.find((item) => item === document.activeElement) ??
      items.find((item) => item.getAttribute('aria-current') === 'page') ??
      items[0];
    for (const item of items) item.tabIndex = item === stop ? 0 : -1;
  });
}

/** Up and Down (and Home and End) move focus between the body's items, and the one focused becomes the tab stop. */
function moveByArrow(event: KeyboardEvent, body: HTMLElement | null) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const items = itemsOf(body);
  const at = items.findIndex((item) => item === document.activeElement);
  if (at === -1) return;
  const last = items.length - 1;
  const moves: Readonly<Record<string, number>> = {
    ArrowDown: Math.min(at + 1, last),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: last,
  };
  const next = moves[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const target = items[next];
  if (target === undefined) return;
  for (const item of items) item.tabIndex = item === target ? 0 : -1;
  target.focus();
}

interface NavItemFace {
  /** The destination's name, in sentence case. */
  readonly children: string;
  readonly icon: IconName;
  /** Sets the icon on its hue tile: record objects and lists keep one colour everywhere. */
  readonly hue?: Hue;
  /** In place of the icon: a list's emoji, the one place emoji appear. */
  readonly leading?: ReactNode;
  /** A quiet word after the name: a favourite's object ("Companies"), where a link leads ("In Captures"). On the rail it joins the name and tooltip. */
  readonly meta?: string;
  /** A count that needs action (tasks due), never a total. */
  readonly badge?: number;
  /** The keyboard shortcut that goes there too (`⌘,` for Settings), shown as a keycap after the name (not on the rail, where the tooltip names the item). */
  readonly kbd?: string;
  /** Its key inside a `NavSection` that reorders (`onReorder`): what the move names. */
  readonly id?: string;
  /**
   * The item's own menu (Hide from sidebar, Remove from favourites): a `Menu`
   * opened by a quiet "More" button after the name, shown on hover or focus
   * (spec 0034). Not on the rail.
   */
  readonly menu?: ReactElement;
}

/** Props for NavItem: a place to go (`href`), or an action (`onPress`, such as Invite teammates). */
export type NavItemProps = NavItemFace &
  (
    | { readonly href: string; readonly isCurrent?: boolean; readonly onPress?: never }
    | { readonly onPress: () => void; readonly href?: never; readonly isCurrent?: never }
  );

/** A Tooltip, with the shortcut's keycap after its line when there is one (ShortcutTooltip). */
function TipWithKeys({ kbd, ...props }: TooltipProps & { readonly kbd: string | undefined }) {
  return kbd === undefined ? <Tooltip {...props} /> : <ShortcutTooltip {...props} kbd={kbd} />;
}

/** One size-nav-item row in the sidebar: a routed link with `aria-current` on the current page, or a button. */
export function NavItem(props: NavItemProps) {
  const { children, icon, hue, leading, meta, badge, kbd } = props;
  const { isCollapsed } = useContext(SidebarContext);
  // On the rail the meta has no room, so it joins the name and the tooltip ("Booking pages · In Captures"); the
  // tooltip shows the shortcut as its keycap too ("Settings ⌘,"), as the row's keycap has no room either.
  const railName = meta === undefined ? children : `${children} · ${meta}`;
  const platform = useKeyboardPlatform();
  // The keycap is hidden from the name, so the shortcut is stated as aria-keyshortcuts ("Meta+,", "Control+," off a
  // Mac). React Aria's Link and Button don't pass the attribute through, so it goes on the element through `render`.
  const shortcut = kbd === undefined ? undefined : keyShortcuts([kbd], platform);
  const linkShortcut =
    shortcut === undefined
      ? {}
      : {
          render: (element: Parameters<NonNullable<LinkProps['render']>>[0]) =>
            'href' in element ? (
              <a {...element} aria-keyshortcuts={shortcut}>
                {element.children}
              </a>
            ) : (
              <span {...element} aria-keyshortcuts={shortcut} />
            ),
        };
  const buttonShortcut =
    shortcut === undefined
      ? {}
      : {
          render: (element: JSX.IntrinsicElements['button']) => (
            <button {...element} type="button" aria-keyshortcuts={shortcut} />
          ),
        };
  const face = (
    <>
      {/* On the rail every item draws its plain icon, one size and one style; the hue tile is the open sidebar's. */}
      {leading ?? (hue === undefined || isCollapsed ? <Icon name={icon} /> : <Icon name={icon} tile={hue} />)}
      {isCollapsed ? <VisuallyHidden>{railName}</VisuallyHidden> : <span className={styles.label}>{children}</span>}
      {meta !== undefined && !isCollapsed && <span className={styles.meta}>{meta}</span>}
      {badge !== undefined && badge > 0 && (
        <span className={styles.badge}>
          <Badge count={badge} tone="accent" />
        </span>
      )}
      {kbd !== undefined && !isCollapsed && (
        <span className={styles.kbd} aria-hidden="true">
          <Kbd tone="soft">{kbd}</Kbd>
        </span>
      )}
    </>
  );
  const item =
    props.href === undefined ? (
      <AriaButton className={styles.item} onPress={props.onPress} {...buttonShortcut}>
        {face}
      </AriaButton>
    ) : (
      <AriaLink
        className={styles.item}
        href={safeHref(props.href)}
        {...(props.isCurrent === true ? { 'aria-current': 'page' as const } : {})}
        {...linkShortcut}
      >
        {face}
      </AriaLink>
    );
  if (isCollapsed) {
    return (
      <TipWithKeys content={railName} placement="end" kbd={kbd}>
        {item}
      </TipWithKeys>
    );
  }
  return <ItemRow id={props.id} name={children} item={item} menu={props.menu} />;
}

/** Whether the section around an item reorders its items (through the library's drag wrapper). */
const ReorderContext = createContext(false);

/** An item with its grip (in a reordering section) and its menu after the link, or the bare link. */
function ItemRow({
  id,
  name,
  item,
  menu,
}: {
  readonly id: string | undefined;
  readonly name: string;
  readonly item: ReactElement;
  readonly menu: ReactElement | undefined;
}) {
  const reorders = useContext(ReorderContext);
  if (reorders && id !== undefined) return <SortableItemRow id={id} name={name} item={item} menu={menu} />;
  if (menu === undefined) return item;
  return (
    <div className={styles.row}>
      {item}
      <span className={styles.rowActions}>
        <ItemMenu name={name} menu={menu} />
      </span>
    </div>
  );
}

/** An item's menu: a quiet button after its link. */
function ItemMenu({ name, menu }: { readonly name: string; readonly menu: ReactElement }) {
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" icon="ellipsis" label={strings.moreFor(name)} />
      {menu}
    </MenuTrigger>
  );
}

/** An item in a reordering section: it slides out of the moving item's way, and moves by its grip. */
function SortableItemRow({
  id,
  name,
  item,
  menu,
}: {
  readonly id: string;
  readonly name: string;
  readonly item: ReactElement;
  readonly menu: ReactElement | undefined;
}) {
  const { bind, grip } = useSortableItem(id);
  return (
    <div ref={bind} className={styles.row} data-reorder-id={id}>
      {item}
      <span className={styles.rowActions}>
        <DragHandle label={strings.moveItem(name)} drag={grip} />
        {menu !== undefined && <ItemMenu name={name} menu={menu} />}
      </span>
    </div>
  );
}

/** Props for NavSection. */
export interface NavSectionProps {
  /** The section's label: Favorites, Records, Lists. */
  readonly title: string;
  /** Its `NavItem`s. */
  readonly children?: ReactNode;
  /** The items are still coming: skeleton rows show after the loading delay. */
  readonly isLoading?: boolean;
  /** What it says when it has no items ("Star a record to keep it here"). */
  readonly emptyLabel?: string;
  readonly defaultExpanded?: boolean;
  /** Folded, when the screen keeps the fold (spec 0034: stored per member). With it, pass `onFoldChange`. */
  readonly isFolded?: boolean;
  readonly onFoldChange?: (isFolded: boolean) => void;
  /** The section's menu (Customise sidebar; moves are the grip's): a `Menu` opened by a quiet button after its label. */
  readonly menu?: ReactElement;
  /**
   * Lets its items be reordered (each `NavItem` needs an `id`) through the
   * library's drag wrapper: by dragging the grip that shows on hover or focus
   * (the others slide out of the way), or from the keyboard on the grip
   * (Space lifts, the arrows move, Space drops, Esc puts it back, each step
   * announced). Told the item and its new place among the items shown. Items
   * never leave their section.
   */
  readonly onReorder?: (id: string, toIndex: number) => void;
  /**
   * Lets the section itself be moved among the sections the same way, from
   * a grip after its label: told the new place, counting `position.count`
   * sections. `position.index` is its place now.
   */
  readonly onMoveSection?: (toIndex: number) => void;
  readonly position?: { readonly index: number; readonly count: number };
  /**
   * A quiet "+" after the label, named by `label`, that makes something in the section (Lists' New list, spec
   * 0048). Leave it out where the viewer may not make one.
   */
  readonly add?: { readonly label: string; readonly onAdd: () => void };
}

/** A folding group of nav items under a quiet label. Collapsed, the sidebar draws its items without the label, and tile marks while they load. */
export function NavSection({
  title,
  children,
  isLoading = false,
  emptyLabel,
  defaultExpanded = true,
  isFolded,
  onFoldChange,
  menu,
  onReorder,
  onMoveSection,
  position,
  add,
}: NavSectionProps) {
  const { isCollapsed } = useContext(SidebarContext);
  const showSkeleton = useDelayedLoading(isLoading);
  const hasItems = Children.toArray(children).length > 0;
  const ids = idsOf(children);
  const reorders = onReorder !== undefined && ids.length > 1;
  const sectionMove = useSectionMove(title, position, onMoveSection);
  if (isCollapsed) {
    // On the rail, loading draws tile marks where the icons will go, as the
    // open sidebar draws skeleton rows.
    let rail: ReactNode = children;
    if (isLoading) {
      rail = showSkeleton ? (
        <div className={styles.railLoading}>
          <Skeleton shape="tile" />
          <Skeleton shape="tile" />
          <Skeleton shape="tile" />
          <VisuallyHidden>{strings.loading}</VisuallyHidden>
        </div>
      ) : null;
    }
    return (
      <div role="group" aria-label={title} className={styles.rail} aria-busy={isLoading || undefined}>
        {rail}
      </div>
    );
  }
  let body: ReactNode = children;
  if (isLoading) {
    body = showSkeleton ? (
      <div className={styles.loading}>
        <Skeleton width="long" />
        <Skeleton width="medium" />
        <Skeleton width="long" />
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    ) : null;
  } else if (!hasItems && add !== undefined) {
    // Empty, the make action shows in the body too: the label row's "+" appears only on hover or focus. It is a
    // NavItem, a full 32px row like the items it stands in for, so its target is never a small button pressed
    // against the label row above it.
    body = (
      <NavItem icon="plus" onPress={add.onAdd}>
        {add.label}
      </NavItem>
    );
  } else if (!hasItems && emptyLabel !== undefined) {
    body = <p className={styles.empty}>{emptyLabel}</p>;
  }
  if (!isLoading && reorders) {
    const names = new Map(
      Children.toArray(children).flatMap((child) =>
        isValidElement<{ readonly id?: string; readonly children?: unknown }>(child) &&
        typeof child.props.id === 'string'
          ? [
              [
                child.props.id,
                typeof child.props.children === 'string' ? child.props.children : child.props.id,
              ] as const,
            ]
          : [],
      ),
    );
    body = (
      <SortableList
        ids={ids}
        nameOf={(id) => names.get(id) ?? id}
        onMove={(move) => {
          onReorder(move.id, move.toIndex);
        }}
      >
        <ReorderContext value>{children}</ReorderContext>
      </SortableList>
    );
  }
  const actions =
    menu === undefined && sectionMove === undefined && add === undefined ? undefined : (
      <>
        {sectionMove !== undefined && <DragHandle label={strings.moveSection(title)} manual={sectionMove.handle} />}
        {add !== undefined && <Button variant="ghost" size="sm" icon="plus" label={add.label} onPress={add.onAdd} />}
        {menu !== undefined && (
          <MenuTrigger>
            <Button variant="ghost" size="sm" icon="ellipsis" label={strings.sectionMenu(title)} />
            {menu}
          </MenuTrigger>
        )}
      </>
    );
  return (
    <div className={styles.section} {...(position === undefined ? {} : { 'data-section-index': position.index })}>
      <Disclosure
        title={title}
        variant="label"
        {...(isFolded === undefined ? { defaultExpanded } : { isExpanded: !isFolded })}
        {...(onFoldChange === undefined
          ? {}
          : {
              onExpandedChange: (isExpanded: boolean) => {
                onFoldChange(!isExpanded);
              },
            })}
        {...(actions === undefined ? {} : { actions })}
      >
        <div className={styles.items} aria-busy={isLoading || undefined}>
          {body}
        </div>
      </Disclosure>
      {sectionMove !== undefined && (
        <>
          <VisuallyHidden>
            <span id={sectionMove.describedBy}>{strings.reorderHelp}</span>
          </VisuallyHidden>
          <VisuallyHidden>
            <span role="status" aria-live="polite" aria-atomic="true">
              {sectionMove.announcement.isPolite ? sectionMove.announcement.text : ''}
            </span>
            <span role="status" aria-live="assertive" aria-atomic="true">
              {sectionMove.announcement.isPolite ? '' : sectionMove.announcement.text}
            </span>
          </VisuallyHidden>
        </>
      )}
    </div>
  );
}

/** What a reorder last said, and whether it waits its turn (a position step) or cuts in (a lift, drop or cancel). */
interface Announcement {
  readonly text: string;
  readonly isPolite: boolean;
}

/**
 * A reorder's words for screen readers. Each message clears the region first
 * and lands a frame later, so the same words twice are said twice.
 */
function useAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', isPolite: false });
  const frame = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const say = (text: string, isPolite = false) => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    setAnnouncement({ text: '', isPolite });
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      setAnnouncement({ text, isPolite });
    });
  };
  return [announcement, say] as const;
}

/** The ids of a section's items, in their order, from each `NavItem`'s `id`. */
function idsOf(children: ReactNode): string[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ readonly id?: string }>(child) && typeof child.props.id === 'string' ? [child.props.id] : [],
  );
}

/** The index a pointer at `y` would drop at, among rows other than the one moving, by their middles. */
function dropIndexAt(rows: readonly { readonly id: string; readonly middle: number }[], movingId: string, y: number) {
  const others = rows.filter((row) => row.id !== movingId);
  const at = others.findIndex((row) => y < row.middle);
  return at === -1 ? others.length : at;
}

/** Moving a whole section among the sections from the keyboard on its grip, or by dragging it (AC-932). */
function useSectionMove(
  title: string,
  position: { readonly index: number; readonly count: number } | undefined,
  onMoveSection: ((toIndex: number) => void) | undefined,
) {
  const [lift, setLift] = useState<{ readonly to: number } | undefined>(undefined);
  const [announcement, setAnnouncement] = useAnnouncement();
  const describedBy = useId();
  // A pointer drag reads the latest callback when it ends, and ends with the section.
  const latest = useRef(onMoveSection);
  useLayoutEffect(() => {
    latest.current = onMoveSection;
  });
  const dragEnd = useRef<((cancelled: boolean) => void) | undefined>(undefined);
  useEffect(
    () => () => {
      dragEnd.current?.(true);
    },
    [],
  );
  if (onMoveSection === undefined || position === undefined || position.count < 2) return undefined;
  const { index, count } = position;
  const handle = {
    isLifted: lift !== undefined,
    describedBy,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const key = event.key;
      if (lift === undefined) {
        if (key !== ' ' && key !== 'Enter') return;
        event.preventDefault();
        setLift({ to: index });
        setAnnouncement(strings.reorderLifted(title, index + 1, count));
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        const to = Math.min(Math.max(lift.to + (key === 'ArrowUp' ? -1 : 1), 0), count - 1);
        setLift({ to });
        setAnnouncement(strings.reorderPosition(title, to + 1, count), true);
        return;
      }
      if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        setLift(undefined);
        if (lift.to !== index) onMoveSection(lift.to);
        setAnnouncement(
          lift.to === index
            ? strings.reorderStayed(title, index + 1, count)
            : strings.reorderMoved(title, lift.to + 1, count),
        );
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setLift(undefined);
        setAnnouncement(strings.reorderCancelled(title, index + 1, count));
      }
    },
    onBlur: () => {
      setLift(undefined);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || lift !== undefined) return;
      const section = event.currentTarget.closest('[data-section-index]');
      const body = section?.parentElement;
      if (body === null || body === undefined) return;
      event.preventDefault();
      const elements = [...body.querySelectorAll<HTMLElement>(':scope > [data-section-index]')];
      const rows = elements.map((row) => {
        const rect = row.getBoundingClientRect();
        return { id: row.dataset.sectionIndex ?? '', middle: rect.top + rect.height / 2 };
      });
      const others = elements.filter((row) => row.dataset.sectionIndex !== String(index));
      let to = index;
      // The drop line goes on the section it lands before (or after the last): each section draws its own, so the
      // moving one marks the others directly while the drag lasts.
      const mark = () => {
        for (const row of others) delete row.dataset.drop;
        const before = others[to];
        const last = others.at(-1);
        if (before !== undefined) before.dataset.drop = 'before';
        else if (last !== undefined) last.dataset.drop = 'after';
      };
      const move = (moved: PointerEvent) => {
        to = dropIndexAt(rows, String(index), moved.clientY);
        mark();
      };
      const end = (cancelled: boolean) => {
        dragEnd.current = undefined;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        for (const row of others) delete row.dataset.drop;
        if (cancelled || to === index) return;
        latest.current?.(to);
        setAnnouncement(strings.reorderMoved(title, to + 1, count));
      };
      const up = () => {
        end(false);
      };
      const cancel = () => {
        end(true);
      };
      const escape = (pressed: globalThis.KeyboardEvent) => {
        if (pressed.key !== 'Escape') return;
        pressed.preventDefault();
        pressed.stopPropagation();
        end(true);
      };
      dragEnd.current = end;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    },
  };
  return { handle, announcement, describedBy };
}

/** Props for NavGroup. */
export interface NavGroupProps {
  /** What the group holds ("Scheduling"): read by screen readers, and shown above it with `isLabelShown`. */
  readonly label: string;
  /**
   * Shows the label above the items, in a section's quiet label type, without
   * a fold: the settings navigation's Account, Workspace and Scheduling (spec 0026).
   */
  readonly isLabelShown?: boolean;
  /** Its `NavItem`s. */
  readonly children: ReactNode;
}

/**
 * Destinations set apart as one group. Without a label on screen, fixed
 * destinations after a section (Bookings and Captures after Records); with `isLabelShown`, a labelled group that never folds (the
 * settings navigation's). Open, it takes a section's space above; on the
 * rail, a labelled group a section's hairline (the label left to its name),
 * an unlabelled one the same space with no rule.
 */
export function NavGroup({ label, isLabelShown = false, children }: NavGroupProps) {
  const { isCollapsed } = useContext(SidebarContext);
  const labelId = useId();
  if (!isLabelShown || isCollapsed) {
    return (
      // On the rail a labelled group keeps a section's hairline; an unlabelled one (Tasks) only its space, so the
      // rail draws a rule where the open sidebar draws a label, and nowhere else.
      <div role="group" aria-label={label} className={isCollapsed && isLabelShown ? styles.rail : styles.group}>
        {children}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={labelId} className={styles.group}>
      <span id={labelId} className={styles.groupLabel}>
        {label}
      </span>
      {children}
    </div>
  );
}
