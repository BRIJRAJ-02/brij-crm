import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { ThemeSwitch } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { fakeThemeController } from '../../workbench/theme.ts';
import { NavItem, NavSection, Sidebar } from './Sidebar.tsx';

interface SampleSidebarProps {
  readonly isCollapsed?: boolean;
  readonly isWorkspaceBusy?: boolean;
  readonly isLoading?: boolean;
  readonly hasLists?: boolean;
  readonly onQuickActions?: () => void;
}

/** The sidebar as the app draws it: the fixed destinations, then Favorites, Records and Lists. */
function SampleSidebar({
  isCollapsed = false,
  isWorkspaceBusy = false,
  isLoading = false,
  hasLists = true,
  onQuickActions,
}: SampleSidebarProps) {
  const [collapsed, setCollapsed] = useState(isCollapsed);
  const [theme] = useState(fakeThemeController);
  return (
    <Stage height="page">
      <Sidebar
        workspace="Brightline"
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
            <ThemeSwitch controller={theme} isCompact orientation={isRail ? 'vertical' : 'horizontal'} />
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

/** Records and lists still loading: skeleton rows under their labels. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByText('Loading').length).toBeGreaterThan(0));
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
