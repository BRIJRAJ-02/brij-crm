import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import './AppShell.css';

/** Props for AppShell. */
export interface AppShellProps {
  /** The `Sidebar`. */
  readonly sidebar: ReactNode;
  /** The page: a `TopBar`, optionally a `Toolbar`, then the content (often a `PageBody` or an `AsideLayout`). */
  readonly children: ReactNode;
  readonly className?: string;
  /** On a phone the sidebar gives way to this: a bottom tab bar of the section's pages. */
  readonly mobileNav?: ReactNode;
}

/** The app's frame: the sidebar on the grey canvas, and one white surface inset 8px holding the page. Pages are full width. */
export function AppShell({ sidebar, children, className, mobileNav }: AppShellProps) {
  return (
    <div className={cx('tf-shell', mobileNav !== undefined && 'tf-shell--tabbed', className)}>
      <div className="tf-shell__side">{sidebar}</div>
      <main className="tf-shell__main">{children}</main>
      {mobileNav !== undefined && <div className="tf-shell__tabbar">{mobileNav}</div>}
    </div>
  );
}

/** Props for TopBar. */
export interface TopBarProps {
  /** The page title: a `Breadcrumbs` at `size="title"`, or plain text. */
  readonly title: ReactNode;
  /** Right side: presence, Share, a primary action, a "…" menu. */
  readonly actions?: ReactNode;
}

/** The page's one 56px top bar: breadcrumb title on the left, actions on the right. */
export function TopBar({ title, actions }: TopBarProps) {
  return (
    <header className="tf-topbar">
      <div className="tf-topbar__title">{title}</div>
      {actions !== undefined && <div className="tf-topbar__actions">{actions}</div>}
    </header>
  );
}

/** Props for Toolbar. */
export interface ToolbarProps {
  /** Left: the view switcher, Filter, Sort, applied filter chips. */
  readonly start?: ReactNode;
  /** Right: search and the + New action. */
  readonly end?: ReactNode;
  readonly 'aria-label'?: string;
}

/** The row under the top bar that shapes the list: view, filter, sort on the left; search and + New on the right. */
export function Toolbar({ start, end, ...rest }: ToolbarProps) {
  return (
    <div className="tf-toolbar" role="toolbar" aria-label={rest['aria-label'] ?? 'View options'}>
      <div className="tf-toolbar__start">{start}</div>
      {end !== undefined && <div className="tf-toolbar__end">{end}</div>}
    </div>
  );
}

/** The width a SearchField takes in a Toolbar's end: pass it as the field's className. */
export const TOOLBAR_SEARCH = 'tf-toolbar__search';

/** The scrolling content area under the bars, with the page padding. `flush` drops the padding (tables to the edge). */
export function PageBody({ children, flush = false }: { readonly children: ReactNode; readonly flush?: boolean }) {
  return <div className={cx('tf-pagebody', flush && 'tf-pagebody--flush')}>{children}</div>;
}

/** Props for AsideLayout. */
export interface AsideLayoutProps {
  readonly children: ReactNode;
  /** The right panel: a record preview, comments, details. */
  readonly aside: ReactNode;
  readonly isAsideOpen: boolean;
  readonly asideLabel: string;
}

/** Content with a 440px panel on the right that slides in and pushes the content over (record previews, comments). */
export function AsideLayout({ children, aside, isAsideOpen, asideLabel }: AsideLayoutProps) {
  return (
    <div className="tf-aside" data-open={isAsideOpen || undefined}>
      <div className="tf-aside__content">{children}</div>
      <aside className="tf-aside__panel" aria-label={asideLabel} inert={!isAsideOpen} data-open={isAsideOpen || undefined}>
        <div className="tf-aside__inner">{aside}</div>
      </aside>
    </div>
  );
}

/** One page in the phone tab bar. */
export interface TabBarItem {
  readonly id: string;
  /** A short name: one word fits best under the icon. */
  readonly label: string;
  readonly icon: ReactNode;
  /** A count shown on the icon, such as meetings waiting. */
  readonly badge?: number;
}

/** Props for TabBar. */
export interface TabBarProps {
  readonly items: readonly TabBarItem[];
  readonly current: string;
  readonly onChange: (id: string) => void;
  readonly 'aria-label': string;
}

/** The phone's bottom bar: up to six pages of one section, icon over a short name. Pass it to `AppShell` as `mobileNav`; it shows only under 640px. */
export function TabBar({ items, current, onChange, 'aria-label': label }: TabBarProps) {
  return (
    <nav className="tf-shell__tabs" aria-label={label}>
      {items.map((x) => (
        <button key={x.id} type="button" className="tf-shell__tab" aria-current={x.id === current ? 'page' : undefined} onClick={() => onChange(x.id)}>
          <span className="tf-shell__tab-icon">{x.icon}{x.badge ? <span className="tf-shell__tab-badge">{x.badge > 9 ? '9+' : x.badge}</span> : undefined}</span>
          <span className="tf-shell__tab-label">{x.label}</span>
        </button>
      ))}
    </nav>
  );
}
