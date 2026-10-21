import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { ThemeSwitch } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { fakeThemeController } from '../../workbench/theme.ts';
import { NavGroup, NavItem, NavSection, Sidebar } from './Sidebar.tsx';

interface SampleSidebarProps {
  readonly isCollapsed?: boolean;
  readonly isWorkspaceBusy?: boolean;
  readonly isLoading?: boolean;
  readonly hasLists?: boolean;
  readonly onQuickActions?: () => void;
  /** The workspace's name isn't known yet. */
  readonly isWorkspaceLoading?: boolean;
}

/** The sidebar as the app draws it: the fixed destinations, then Favorites, Records and Lists, then Bookings, Captures and the trash in a group of their own. */
function SampleSidebar({
  isCollapsed = false,
  isWorkspaceBusy = false,
  isLoading = false,
  hasLists = true,
  onQuickActions,
  isWorkspaceLoading = false,
}: SampleSidebarProps) {
  const [collapsed, setCollapsed] = useState(isCollapsed);
  const [theme] = useState(fakeThemeController);
  return (
    <Stage height="page">
      <Sidebar
        workspace="Brightline"
        isWorkspaceLoading={isWorkspaceLoading}
        isWorkspaceBusy={isWorkspaceBusy}
        workspaceBusyLabel="Signing out"
        workspaceMenu={
          <Menu label="Workspaces">
            <MenuItem id="brightline">Brightline</MenuItem>
            <MenuItem id="northwind">Northwind</MenuItem>
          </Menu>
        }
        onQuickActions={onQuickActions ?? (() => undefined)}
        isCollapsed={collapsed}
        onCollapsedChange={setCollapsed}
        footer={({ isCollapsed: isRail }) => (
          <>
            <NavItem icon="user-plus" onPress={() => undefined}>
              Invite teammates
            </NavItem>
            <ThemeSwitch controller={theme} isCompact={isRail} orientation={isRail ? 'vertical' : 'horizontal'} />
          </>
        )}
      >
        <NavItem icon="bell" href="/notifications">
          Notifications
        </NavItem>
        <NavItem icon="square-check" href="/tasks" badge={3}>
          Tasks
        </NavItem>
        <NavItem icon="file" href="/notes">
          Notes
        </NavItem>
        <NavSection title="Favorites" emptyLabel="Star a record to keep it here.">
          <NavItem icon="layout-grid" href="/companies/views/uk" meta="Companies">
            UK and EU companies
          </NavItem>
        </NavSection>
        <NavSection title="Records" isLoading={isLoading}>
          <NavItem icon="building" hue="blue" href="/companies" isCurrent>
            Companies
          </NavItem>
          <NavItem icon="user" hue="green" href="/people">
            People
          </NavItem>
          <NavItem icon="circle-dollar-sign" hue="orange" href="/deals">
            Deals
          </NavItem>
        </NavSection>
        <NavSection title="Lists" isLoading={isLoading} emptyLabel="Lists you make show here.">
          {hasLists && (
            <NavItem icon="pin" hue="purple" href="/lists/sales">
              Sales pipeline
            </NavItem>
          )}
        </NavSection>
        <NavGroup label="Scheduling">
          <NavItem icon="calendar-days" href="/bookings">
            Bookings
          </NavItem>
          <NavItem icon="link" href="/captures">
            Captures
          </NavItem>
          <NavItem icon="trash" href="/trash">
            Trash
          </NavItem>
        </NavGroup>
      </Sidebar>
    </Stage>
  );
}

const meta = {
  title: 'Modules/Sidebar',
  component: SampleSidebar,
} satisfies Meta<typeof SampleSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The navigation landmark, with Companies current and a count on Tasks. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('button', { name: 'Records' })).toHaveAttribute('aria-expanded', 'true');
    // The group after the sections is named for screen readers, with no label on screen.
    const group = canvas.getByRole('group', { name: 'Scheduling' });
    await expect(group).toContainElement(canvas.getByRole('link', { name: 'Captures' }));
  },
};

/** Tab moves down the sidebar; Enter folds a section; the shortcut opens Quick actions. */
export const Keyboard: Story = {
  args: { onQuickActions: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Brightline, workspace menu' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: /Quick actions/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onQuickActions).toHaveBeenCalled();
    const records = canvas.getByRole('button', { name: 'Records' });
    records.focus();
    await userEvent.keyboard('{Enter}');
    await expect(records).toHaveAttribute('aria-expanded', 'false');
  },
};

/**
 * Collapsed: a rail of icons, each named in a tooltip, with the expand button
 * at the bottom. The footer is told the sidebar is folded, so the theme
 * switch stacks and stays inside the rail.
 */
export const Collapsed: Story = {
  args: { isCollapsed: true },
  play: async ({ canvas, userEvent }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    const theme = canvas.getByRole('radiogroup', { name: 'Theme' });
    await expect(theme).toHaveAttribute('aria-orientation', 'vertical');
    await expect(theme.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
    const people = canvas.getByRole('link', { name: 'People' });
    await hoverFresh(userEvent, people);
    await expect(await shownTooltip()).toHaveTextContent('People');
    await userEvent.unhover(people);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** Records and lists still loading: skeleton rows under their labels, and the workspace's place too, so no stand in name flashes. */
export const Loading: Story = {
  args: { isLoading: true, isWorkspaceLoading: true },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByText('Loading').length).toBeGreaterThan(0));
    await expect(canvas.getByText('Loading workspace')).toBeInTheDocument();
    await expect(canvas.queryByText('Brightline')).toBeNull();
  },
};

/** Folded and loading: tile marks on the rail where the icons will go, as the open sidebar draws skeleton rows. */
export const CollapsedLoading: Story = {
  args: { isCollapsed: true, isLoading: true },
  play: async ({ canvas }) => {
    const records = canvas.getByRole('group', { name: 'Records' });
    await expect(records).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(records.querySelectorAll('[data-shape="tile"]').length).toBe(3));
    await expect(records).toHaveTextContent('Loading');
    await expect(canvas.queryByRole('link', { name: 'People' })).toBeNull();
  },
};

/** No lists yet: the section says what goes there. */
export const Empty: Story = {
  args: { hasLists: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Lists you make show here.')).toBeInTheDocument();
  },
};

/** Signing out from the workspace menu: the button spins in place of its chevron, says it is busy, and ignores presses. */
export const WorkspaceBusy: Story = {
  args: { isWorkspaceBusy: true },
  play: async ({ canvas, userEvent }) => {
    // React Aria adds what is under way to the button's name while it is pending.
    const button = canvas.getByRole('button', { name: 'Brightline, workspace menu Signing out' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(canvas.getByRole('progressbar', { name: 'Signing out' })).toBeInTheDocument();
    await userEvent.click(button);
    await expect(document.querySelector('[role="menu"]')).toBeNull();
  },
};

/** Signing out with the sidebar folded: the workspace mark spins in place, says what is under way, and ignores presses. */
export const CollapsedWorkspaceBusy: Story = {
  args: { isCollapsed: true, isWorkspaceBusy: true },
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Brightline, workspace menu Signing out' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    const spinner = canvas.getByRole('progressbar', { name: 'Signing out' });
    await expect(button).toContainElement(spinner);
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
    await userEvent.click(button);
    await expect(document.querySelector('[role="menu"]')).toBeNull();
  },
};

/** The settings navigation (spec 0026): a title with the way back, then labelled groups that never fold. */
function SampleSettingsSidebar({ isCollapsed = false }: { readonly isCollapsed?: boolean }) {
  return (
    <Stage height="page">
      <Sidebar
        heading="Settings"
        back={{ label: 'Leave settings', href: '/companies' }}
        label="Settings"
        keyboard="arrows"
        isCollapsed={isCollapsed}
      >
        <NavGroup label="Account" isLabelShown>
          <NavItem icon="sliders-horizontal" href="/settings/account/preferences" isCurrent>
            Preferences
          </NavItem>
          <NavItem icon="calendar" href="/settings/account/calendars">
            Calendars
          </NavItem>
        </NavGroup>
        <NavGroup label="Workspace" isLabelShown>
          <NavItem icon="box" href="/settings/objects">
            Objects
          </NavItem>
          <NavItem icon="list-checks" href="/settings/jobs">
            Background jobs
          </NavItem>
        </NavGroup>
        <NavGroup label="Scheduling" isLabelShown>
          <NavItem icon="link" href="/captures/links" meta="In Captures">
            Booking pages
          </NavItem>
        </NavGroup>
      </Sidebar>
    </Stage>
  );
}

/** Settings: the title and its back link, the groups under their labels, Preferences current. */
export const Settings: Story = {
  render: () => <SampleSettingsSidebar />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    await expect(canvas.getByText('Settings', { selector: 'span' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Leave settings' })).toHaveAttribute('href', '/companies');
    const account = canvas.getByRole('group', { name: 'Account' });
    await expect(account).toHaveTextContent('Account');
    await expect(account).toContainElement(canvas.getByRole('link', { name: 'Preferences' }));
    await expect(canvas.getByRole('link', { name: 'Preferences' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.queryByRole('button', { name: 'Account' })).toBeNull();
  },
};

/** One tab stop for the list, the current page's: the arrow keys, Home and End move inside it, and Tab passes it. */
export const SettingsKeyboard: Story = {
  render: () => (
    <>
      <SampleSettingsSidebar />
      {/* The library's Button: a bare button keeps the browser's light face in dark on Linux WebKit, failing contrast. */}
      <Button>After</Button>
    </>
  ),
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Leave settings' })).toHaveFocus();
    await userEvent.tab();
    const preferences = canvas.getByRole('link', { name: 'Preferences' });
    await expect(preferences).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('link', { name: 'Calendars' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    const last = canvas.getByRole('link', { name: /Booking pages/ });
    await expect(last).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(last).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(preferences).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(preferences).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'After' })).toHaveFocus();
    // Back in, focus lands on the current page's item.
    await userEvent.tab({ shift: true });
    await expect(preferences).toHaveFocus();
  },
};

/** Settings on the rail: the back link alone at the top, each group under a hairline, names in tooltips. */
export const SettingsCollapsed: Story = {
  render: () => <SampleSettingsSidebar isCollapsed />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Leave settings' })).toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: 'Workspace' })).toContainElement(
      canvas.getByRole('link', { name: 'Objects' }),
    );
    // The meta has no room on the rail, so it joins the name.
    await expect(canvas.getByRole('link', { name: 'Booking pages · In Captures' })).toBeInTheDocument();
  },
};

/** The app's sidebar as Timefix draws it: the Timefix mark heading the workspace switcher, and Settings with ⌘, at its foot. */
export const FooterShortcut: Story = {
  render: () => (
    <Stage height="page">
      <Sidebar
        workspace="Brightline"
        mark={<ProviderMark provider="timefix" size="lg" />}
        workspaceMenu={
          <Menu label="Workspaces">
            <MenuItem id="brightline">Brightline</MenuItem>
          </Menu>
        }
        footer={
          <NavItem icon="settings" href="/settings" kbd="⌘,">
            Settings
          </NavItem>
        }
      >
        <NavItem icon="bell" href="/notifications">
          Notifications
        </NavItem>
      </Sidebar>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // The keycap shows, hidden from the name; the shortcut is stated through aria-keyshortcuts.
    const settings = canvas.getByRole('link', { name: 'Settings' });
    await expect(settings.querySelector('kbd')).not.toBeNull();
    await expect(settings.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+,$/);
    // The mark is decoration: the switcher keeps the workspace's name.
    const switcher = canvas.getByRole('button', { name: 'Brightline, workspace menu' });
    await expect(switcher.querySelector('img')).not.toBeNull();
  },
};
