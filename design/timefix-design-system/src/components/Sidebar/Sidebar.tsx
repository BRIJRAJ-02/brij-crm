import { Button as AriaButton, Link as AriaLink, Disclosure, DisclosurePanel, type Key } from 'react-aria-components';
import { createContext, useContext, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { Avatar, PersonLine } from '../Avatar/Avatar.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import { MenuTrigger, Menu } from '../Menu/Menu.tsx';
import './Sidebar.css';

const SidebarContext = createContext({ isCollapsed: false });
const i = { size: 16, strokeWidth: 1.75 } as const;

/** In the rail, a control is named by a tooltip to its right; expanded, it is drawn plain. */
function RailTip({ label, shortcut, children }: { readonly label: string; readonly shortcut?: string; readonly children: ReactElement }) {
  const { isCollapsed } = useContext(SidebarContext);
  return isCollapsed ? <Tooltip label={label} shortcut={shortcut} placement="right">{children}</Tooltip> : children;
}

/** Props for Sidebar. */
export interface SidebarProps {
  /** The head: a `WorkspaceSwitcher`. */
  readonly header: ReactNode;
  /** `NavItem`s, then `NavSection`s. */
  readonly children: ReactNode;
  /** The bottom: `GettingStarted`, then a `PersonRow`. */
  readonly footer?: ReactNode;
  /** Opens the command palette; the app also answers ⌘K. Shows the search pill. */
  readonly onSearch?: () => void;
  /** The 56px rail: icons only, each named in a tooltip. */
  readonly isCollapsed?: boolean;
  /** Shows the collapse / expand button. */
  readonly onCollapsedChange?: (isCollapsed: boolean) => void;
  /** The navigation landmark's name. */
  readonly label?: string;
}

/** The app's left column, sitting straight on the grey canvas: workspace switcher, search, destinations, folding sections and the person at the bottom. Folds to a 56px rail. */
export function Sidebar({ header, children, footer, onSearch, isCollapsed = false, onCollapsedChange, label = 'Main navigation' }: SidebarProps) {
  return (
    <SidebarContext.Provider value={{ isCollapsed }}>
      <nav aria-label={label} className="tf-sidebar" data-collapsed={isCollapsed || undefined}>
        <div className="tf-sidebar__head">{header}</div>
        {(onSearch || onCollapsedChange) && (
          <div className="tf-sidebar__tools">
            {onSearch && (
              <RailTip label="Search" shortcut="⌘K">
                <AriaButton className="tf-sidebar__search" onPress={onSearch} aria-label={isCollapsed ? 'Search' : undefined}>
                  <Search {...i} /><span className="tf-sidebar__fade">Search</span><span className="tf-sidebar__fade tf-sidebar__kbd"><Kbd>⌘K</Kbd></span>
                </AriaButton>
              </RailTip>
            )}
            {onCollapsedChange && (
              <Tooltip label={isCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} shortcut="[" placement={isCollapsed ? 'right' : 'bottom'}>
                <AriaButton className="tf-sidebar__toggle" aria-label={isCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} onPress={() => onCollapsedChange(!isCollapsed)}>
                  {isCollapsed ? <PanelLeftOpen {...i} /> : <PanelLeftClose {...i} />}
                </AriaButton>
              </Tooltip>
            )}
          </div>
        )}
        <ScrollRegion>{children}</ScrollRegion>
        {footer !== undefined && <div className="tf-sidebar__foot">{footer}</div>}
      </nav>
    </SidebarContext.Provider>
  );
}

/** The nav's middle: the only part that scrolls. Hairlines appear above and below only while there is more to scroll that way. */
function ScrollRegion({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.toggleAttribute('data-scrolled-top', el.scrollTop > 0);
      el.toggleAttribute('data-scrolled-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, []);
  return <div ref={ref} className="tf-sidebar__body"><div className="tf-sidebar__list">{children}</div></div>;
}

/** Props for WorkspaceSwitcher. */
export interface WorkspaceSwitcherProps {
  readonly name: string;
  /** The plan under the name ("Pro plan · 12 members"). */
  readonly plan?: string;
  /** The workspace's logo, or Timefix's `LogoMark`; defaults to the name's square avatar. */
  readonly mark?: ReactNode;
  /** The shared Menu's `MenuItem`s, `MenuSection`s and `MenuSeparator`s. */
  readonly children: ReactNode;
  readonly onAction?: (key: Key) => void;
}

/** The sidebar's head: mark, workspace name and plan, opening the workspace menu (switch, add, settings, theme, sign out). */
export function WorkspaceSwitcher({ name, plan, mark, children, onAction }: WorkspaceSwitcherProps) {
  return (
    <MenuTrigger>
      <RailTip label={name}>
        <AriaButton className="tf-switcher" aria-label={`${name}, workspace menu`}>
          <span className="tf-switcher__mark">{mark ?? <Avatar name={name} shape="square" size={28} />}</span>
          <span className="tf-switcher__text tf-sidebar__fade">
            <span className="tf-switcher__name">{name}</span>
            {plan !== undefined && <span className="tf-switcher__plan">{plan}</span>}
          </span>
          <ChevronsUpDown className="tf-switcher__chev tf-sidebar__fade" size={14} strokeWidth={1.75} aria-hidden="true" />
        </AriaButton>
      </RailTip>
      <Menu aria-label="Workspace" onAction={onAction} placement="bottom start">{children}</Menu>
    </MenuTrigger>
  );
}

/** Props for NavItem. */
export interface NavItemProps {
  readonly label: string;
  /** A 16px Lucide icon. */
  readonly icon?: ReactNode;
  /** A colour dot instead of an icon (favourites, lists). */
  readonly dot?: Hue;
  readonly href?: string;
  readonly onPress?: () => void;
  /** The page you are on: a white pill with a hairline. */
  readonly isCurrent?: boolean;
  /** A quiet count at the right (records in an object, bookings today). */
  readonly count?: number;
  /** Unread: a blue badge that pops in (Inbox). 0 hides it. */
  readonly badge?: number;
  /** A shortcut keycap at the right ("⌘1"). */
  readonly shortcut?: string;
}

/** One destination: 34px pill, icon or dot, label, then a count, an unread badge or a shortcut. */
export function NavItem({ label, icon, dot, href, onPress, isCurrent = false, count, badge, shortcut }: NavItemProps) {
  const lastBadge = useRef(badge ?? 0);
  if (badge) lastBadge.current = badge;
  const unread = badge !== undefined && badge > 0;
  return (
    <RailTip label={unread ? `${label} · ${badge} unread` : label} shortcut={shortcut}>
      <AriaLink href={href} onPress={onPress} aria-current={isCurrent ? 'page' : undefined} className="tf-nav" aria-label={unread ? `${label}, ${badge} unread` : undefined}>
        <span className="tf-nav__icon">{dot ? <span className="tf-nav__dot" style={{ background: `var(--dot-${dot})` }} /> : icon}</span>
        <span className="tf-nav__label tf-sidebar__fade">{label}</span>
        {count !== undefined && !unread && <span className="tf-nav__count tf-sidebar__fade">{count.toLocaleString('en-US')}</span>}
        {shortcut !== undefined && <span className="tf-nav__kbd tf-sidebar__fade"><Kbd>{shortcut}</Kbd></span>}
        {badge !== undefined && (
          <span className="tf-nav__badge" data-open={unread} aria-hidden="true">
            <span className="tf-nav__badge-dot">{lastBadge.current > 99 ? '99+' : lastBadge.current}</span>
          </span>
        )}
      </AriaLink>
    </RailTip>
  );
}

/** Props for NavSection. */
export interface NavSectionProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
  /** Shows a + at the right of the title ("Add a favourite", "New object"). */
  readonly onAdd?: () => void;
  readonly addLabel?: string;
}

/** A titled group in the sidebar (Favourites, Records) that folds away; a hairline in the rail. */
export function NavSection({ title, children, defaultExpanded = true, onAdd, addLabel }: NavSectionProps) {
  return (
    <Disclosure defaultExpanded={defaultExpanded} className="tf-sidebar__section">
      <div className="tf-sidebar__section-head">
        <AriaButton slot="trigger" className="tf-sidebar__section-title">
          <span>{title}</span>
          <svg className="tf-sidebar__section-chev" width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6.5L8 10.5L12 6.5" /></svg>
        </AriaButton>
        {onAdd && (
          <Tooltip label={addLabel ?? `Add to ${title}`}>
            <AriaButton className="tf-sidebar__section-add" aria-label={addLabel ?? `Add to ${title}`} onPress={onAdd}><Plus size={14} strokeWidth={1.75} /></AriaButton>
          </Tooltip>
        )}
      </div>
      <DisclosurePanel className="tf-sidebar__section-panel"><div className="tf-sidebar__section-inner">{children}</div></DisclosurePanel>
    </Disclosure>
  );
}

/** The onboarding checklist's way back in: an ink pill with a progress ring, "Getting started 2/6". */
export function GettingStarted({ done, total, onPress }: { readonly done: number; readonly total: number; readonly onPress?: () => void }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <RailTip label={`Getting started · ${done} of ${total}`}>
      <AriaButton className="tf-getting" onPress={onPress} aria-label={`Getting started, ${done} of ${total} done`}>
        <svg className="tf-getting__ring" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={r} fill="none" strokeWidth={2} className="tf-getting__track" />
          <circle cx="8" cy="8" r={r} fill="none" strokeWidth={2} strokeLinecap="round" className="tf-getting__arc" strokeDasharray={c} strokeDashoffset={c * (1 - done / Math.max(1, total))} transform="rotate(-90 8 8)" />
        </svg>
        <span className="tf-getting__label tf-sidebar__fade">Getting started</span>
        <span className="tf-getting__count tf-sidebar__fade">{done}/{total}</span>
      </AriaButton>
    </RailTip>
  );
}

/** The signed-in person at the bottom: avatar, name and email, opening their menu (profile, shortcuts, theme, sign out). */
export function PersonRow({ name, email, src, children, onAction }: { readonly name: string; readonly email: string; readonly src?: string; readonly children: ReactNode; readonly onAction?: (key: Key) => void }) {
  const { isCollapsed } = useContext(SidebarContext);
  return (
    <MenuTrigger>
      <RailTip label={name}>
        <AriaButton className="tf-person-row" aria-label={`${name}, account menu`}>
          <PersonLine name={name} sub={email} src={src} size={28} status="online" isTextHidden={isCollapsed} />
          <ChevronsUpDown className="tf-switcher__chev tf-sidebar__fade" size={14} strokeWidth={1.75} aria-hidden="true" />
        </AriaButton>
      </RailTip>
      <Menu aria-label="Your account" onAction={onAction} placement="top start">{children}</Menu>
    </MenuTrigger>
  );
}

/** A grey value at the end of a menu row ("Theme · System"), passed as a MenuItem's `badge`. */
export function NavMenuValue({ children }: { readonly children: ReactNode }) {
  return <span className="tf-sidebar__menu-value">{children}</span>;
}

/** Whether the surrounding Sidebar is folded to its rail. */
export function useSidebarCollapsed(): boolean {
  return useContext(SidebarContext).isCollapsed;
}
