import { useState } from 'react';
import { Home, Inbox, CalendarDays, Link2, FileText, Building2, Users, Handshake, Plus, Settings, UserPlus, Sun, LogOut, User, Keyboard, LifeBuoy } from 'lucide-react';
import { Sidebar, WorkspaceSwitcher, NavItem, NavSection, GettingStarted, PersonRow, NavMenuValue } from './Sidebar.tsx';
import { MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import { Button } from '../Button/Button.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;

/** The Timefix sidebar with realistic destinations, shared by the Sidebar and AppShell demos. */
export function TimefixSidebar({ current, onNavigate, isCollapsed, onCollapsedChange, onSearch, unread }: {
  readonly current: string; readonly onNavigate: (id: string) => void; readonly isCollapsed: boolean;
  readonly onCollapsedChange?: (v: boolean) => void; readonly onSearch?: () => void; readonly unread: number;
}) {
  const go = (id: string) => () => onNavigate(id);
  const [workspace, setWorkspace] = useState('ws-timefix');
  return (
    <Sidebar
      isCollapsed={isCollapsed}
      onCollapsedChange={onCollapsedChange}
      onSearch={onSearch ?? (() => undefined)}
      header={
        <WorkspaceSwitcher name="Timefix" plan="Pro plan · 12 members" mark={<LogoMark size={28} />}>
          <MenuSection title="Workspaces" selectionMode="single" selectedKeys={[workspace]} onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) setWorkspace(String(k)); }}>
            <MenuItem id="ws-timefix" icon={<LogoMark size={20} />}>Timefix</MenuItem>
            <MenuItem id="ws-northwind" icon={<Building2 {...i} />}>Northwind Studio</MenuItem>
          </MenuSection>
          <MenuItem id="ws-new" icon={<Plus {...i} />}>New workspace</MenuItem>
          <MenuSeparator />
          <MenuItem id="settings" icon={<Settings {...i} />} kbd="⌘,">Workspace settings</MenuItem>
          <MenuItem id="invite" icon={<UserPlus {...i} />}>Invite members</MenuItem>
          <MenuItem id="theme" icon={<Sun {...i} />} badge={<NavMenuValue>System</NavMenuValue>}>Theme</MenuItem>
          <MenuSeparator />
          <MenuItem id="signout" icon={<LogOut {...i} />}>Sign out</MenuItem>
        </WorkspaceSwitcher>
      }
      footer={
        <>
          <GettingStarted done={2} total={6} />
          <PersonRow name="Priya Raman" email="priya@timefix.com">
            <MenuItem id="profile" icon={<User {...i} />}>Profile</MenuItem>
            <MenuItem id="shortcuts" icon={<Keyboard {...i} />} kbd="?">Keyboard shortcuts</MenuItem>
            <MenuItem id="help" icon={<LifeBuoy {...i} />}>Help and support</MenuItem>
            <MenuSeparator />
            <MenuItem id="signout" icon={<LogOut {...i} />}>Sign out</MenuItem>
          </PersonRow>
        </>
      }
    >
      <NavItem label="Home" icon={<Home {...i} />} isCurrent={current === 'home'} onPress={go('home')} />
      <NavItem label="Inbox" icon={<Inbox {...i} />} badge={unread} isCurrent={current === 'inbox'} onPress={go('inbox')} />
      <NavItem label="Bookings" icon={<CalendarDays {...i} />} count={8} isCurrent={current === 'bookings'} onPress={go('bookings')} />
      <NavItem label="Links" icon={<Link2 {...i} />} isCurrent={current === 'links'} onPress={go('links')} />
      <NavItem label="Forms" icon={<FileText {...i} />} count={3} isCurrent={current === 'forms'} onPress={go('forms')} />
      <NavSection title="Favourites" onAdd={() => undefined} addLabel="Add a favourite">
        <NavItem label="Acme Corp" dot="blue" shortcut="⌘1" isCurrent={current === 'acme'} onPress={go('acme')} />
        <NavItem label="Q4 pipeline" dot="purple" shortcut="⌘2" isCurrent={current === 'q4'} onPress={go('q4')} />
        <NavItem label="Discovery call 30 min" dot="green" shortcut="⌘3" isCurrent={current === 'discovery'} onPress={go('discovery')} />
      </NavSection>
      <NavSection title="Records" onAdd={() => undefined} addLabel="New object">
        <NavItem label="Companies" icon={<Building2 {...i} />} count={1284} isCurrent={current === 'companies'} onPress={go('companies')} />
        <NavItem label="People" icon={<Users {...i} />} count={3412} isCurrent={current === 'people'} onPress={go('people')} />
        <NavItem label="Deals" icon={<Handshake {...i} />} count={86} isCurrent={current === 'deals'} onPress={go('deals')} />
      </NavSection>
    </Sidebar>
  );
}

export function SidebarDemo() {
  const [current, setCurrent] = useState('bookings');
  const [unread, setUnread] = useState(2);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'flex', gap: 'var(--space-24)', alignItems: 'stretch', height: 640 }}>
      <TimefixSidebar current={current} onNavigate={setCurrent} unread={unread} isCollapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div style={{ width: 1, background: 'var(--border-subtle)' }} />
      <TimefixSidebar current={current} onNavigate={setCurrent} unread={unread} isCollapsed />
      <div className="tf-stack" style={{ alignSelf: 'flex-start', maxWidth: 260 }}>
        <p className="tf-demo-label" style={{ margin: 0 }}>Try it</p>
        <div className="tf-row">
          <Button size="sm" variant="secondary" onPress={() => setUnread((n) => n + 1)}>New message</Button>
          <Button size="sm" variant="ghost" isDisabled={unread === 0} onPress={() => setUnread(0)}>Mark all read</Button>
        </div>
        <p className="tf-muted" style={{ margin: 0, fontSize: 13 }}>The left sidebar folds to the rail with the button beside Search. The rail names each item in a tooltip. Fold Favourites or Records from their titles; open the workspace and person menus.</p>
      </div>
    </div>
  );
}
