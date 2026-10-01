// The app's left column (spec 0003, the app shell): the workspace switcher,
// Quick actions, the fixed destinations, and folding Favorites, Records and
// Lists sections. Collapsed, it is a rail of icons, each named in a tooltip.
import { Children, createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Button as AriaButton, Link as AriaLink } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { Hue } from '../../hue.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { AppShellContext } from '../AppShell/AppShell.tsx';
import styles from './Sidebar.module.css';
import { strings } from './strings.ts';

const SidebarContext = createContext({ isCollapsed: false });

/** Props for Sidebar. */
export interface SidebarProps {
  /** The workspace's name, at the top. */
  readonly workspace: string;
  /** The workspace switcher: a `Menu` the name opens. Without it the name is plain. */
  readonly workspaceMenu?: ReactElement;
  /** Opens the command palette; the screen also answers ⌘K. */
  readonly onQuickActions?: () => void;
  /** `NavItem`s for the fixed destinations, then `NavSection`s. */
  readonly children: ReactNode;
  /** Invite, help and the theme switch, at the bottom. */
  readonly footer?: ReactNode;
  /** The narrow rail: icons only, each named in a tooltip. Inside the app shell it folds below `bp-page-compact` and stays folded there. */
  readonly isCollapsed?: boolean;
  /** Shows the collapse and expand buttons, and says when they are pressed. */
  readonly onCollapsedChange?: (isCollapsed: boolean) => void;
  /** The navigation landmark's name. Defaults to "Main navigation". */
  readonly label?: string;
}

/**
 * The 260px left column, or the 48px rail when collapsed. It is the app's
 * navigation landmark. Items are 28px; the current page takes
 * `surface-selected`, hover `surface-hover`.
 */
export function Sidebar({
  workspace,
  workspaceMenu,
  onQuickActions,
  children,
  footer,
  isCollapsed: isCollapsedProp = false,
  onCollapsedChange: onCollapsedChangeProp,
  label = strings.navigation,
}: SidebarProps) {
  // Below the compact breakpoint the shell folds it, and it stays folded.
  const { isCompact } = useContext(AppShellContext);
  const isCollapsed = isCollapsedProp || isCompact;
  const onCollapsedChange = isCompact ? undefined : onCollapsedChangeProp;
  const mark = <Avatar name={workspace} hue="ink" shape="square" size="sm" isDecorative />;
  const name = isCollapsed ? (
    <VisuallyHidden>{workspace}</VisuallyHidden>
  ) : (
    <span className={styles.name}>{workspace}</span>
  );
  return (
    <SidebarContext value={{ isCollapsed }}>
      <nav className={styles.root} aria-label={label} data-collapsed={isCollapsed || undefined}>
        <div className={styles.head}>
          {workspaceMenu === undefined ? (
            <span className={styles.workspace}>
              {mark}
              {name}
            </span>
          ) : (
            <MenuTrigger>
              <AriaButton className={styles.switcher} aria-label={strings.switchWorkspace(workspace)}>
                {mark}
                {name}
                {!isCollapsed && <Icon name="chevron-down" size="sm" tone="muted" />}
              </AriaButton>
              {workspaceMenu}
            </MenuTrigger>
          )}
          {onCollapsedChange !== undefined && !isCollapsed && (
            <Button
              variant="ghost"
              icon="panel-left-close"
              label={strings.collapse}
              onPress={() => {
                onCollapsedChange(true);
              }}
            />
          )}
        </div>
        {onQuickActions !== undefined && (
          <div className={styles.search}>
            {isCollapsed ? (
              <Tooltip content={strings.quickActions} placement="end">
                <Button
                  variant="ghost"
                  icon="search"
                  label={strings.quickActions}
                  kbd={strings.quickActionsKey}
                  onPress={onQuickActions}
                />
              </Tooltip>
            ) : (
              <Button size="lg" icon="search" isFullWidth kbd={strings.quickActionsKey} onPress={onQuickActions}>
                {strings.quickActions}
              </Button>
            )}
          </div>
        )}
        <div className={styles.scroll}>
          <div className={styles.body}>{children}</div>
        </div>
        {(footer !== undefined || (isCollapsed && onCollapsedChange !== undefined)) && (
          <div className={styles.foot}>
            {footer}
            {isCollapsed && onCollapsedChange !== undefined && (
              <Tooltip content={strings.expand} placement="end">
                <Button
                  variant="ghost"
                  icon="panel-left-open"
                  label={strings.expand}
                  onPress={() => {
                    onCollapsedChange(false);
                  }}
                />
              </Tooltip>
            )}
          </div>
        )}
      </nav>
    </SidebarContext>
  );
}

interface NavItemFace {
  /** The destination's name, in sentence case. */
  readonly children: string;
  readonly icon: IconName;
  /** Sets the icon on its hue tile: record objects and lists keep one colour everywhere. */
  readonly hue?: Hue;
  /** In place of the icon: a list's emoji, the one place emoji appear. */
  readonly leading?: ReactNode;
  /** A quiet word after the name: a favourite's object ("Companies"). */
  readonly meta?: string;
  /** A count that needs action (tasks due), never a total. */
  readonly badge?: number;
}

/** Props for NavItem: a place to go (`href`), or an action (`onPress`, such as Invite teammates). */
export type NavItemProps = NavItemFace &
  (
    | { readonly href: string; readonly isCurrent?: boolean; readonly onPress?: never }
    | { readonly onPress: () => void; readonly href?: never; readonly isCurrent?: never }
  );

/** One 28px row in the sidebar: a routed link with `aria-current` on the current page, or a button. */
export function NavItem(props: NavItemProps) {
  const { children, icon, hue, leading, meta, badge } = props;
  const { isCollapsed } = useContext(SidebarContext);
  const face = (
    <>
      {leading ?? (hue === undefined ? <Icon name={icon} /> : <Icon name={icon} tile={hue} />)}
      {isCollapsed ? <VisuallyHidden>{children}</VisuallyHidden> : <span className={styles.label}>{children}</span>}
      {meta !== undefined && !isCollapsed && <span className={styles.meta}>{meta}</span>}
      {badge !== undefined && badge > 0 && (
        <span className={styles.badge}>
          <Badge count={badge} tone="accent" />
        </span>
      )}
    </>
  );
  const item =
    props.href === undefined ? (
      <AriaButton className={styles.item} onPress={props.onPress}>
        {face}
      </AriaButton>
    ) : (
      <AriaLink
        className={styles.item}
        href={safeHref(props.href)}
        {...(props.isCurrent === true ? { 'aria-current': 'page' as const } : {})}
      >
        {face}
      </AriaLink>
    );
  return isCollapsed ? (
    <Tooltip content={children} placement="end">
      {item}
    </Tooltip>
  ) : (
    item
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
}

/** A folding group of nav items under a quiet label. Collapsed, the sidebar draws its items without the label. */
export function NavSection({
  title,
  children,
  isLoading = false,
  emptyLabel,
  defaultExpanded = true,
}: NavSectionProps) {
  const { isCollapsed } = useContext(SidebarContext);
  const showSkeleton = useDelayedLoading(isLoading);
  const hasItems = Children.toArray(children).length > 0;
  if (isCollapsed) {
    return (
      <div role="group" aria-label={title} className={styles.rail}>
        {!isLoading && children}
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
  } else if (!hasItems && emptyLabel !== undefined) {
    body = <p className={styles.empty}>{emptyLabel}</p>;
  }
  return (
    <div className={styles.section}>
      <Disclosure title={title} variant="label" defaultExpanded={defaultExpanded}>
        <div className={styles.items} aria-busy={isLoading || undefined}>
          {body}
        </div>
      </Disclosure>
    </div>
  );
}
