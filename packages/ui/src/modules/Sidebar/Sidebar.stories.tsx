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

/**
 * The sidebar as the app draws it: the fixed destinations, then Favorites, Records and Lists, then Bookings and
 * Captures in a group of their own, and Settings and Help at the foot (owner, 22 October 2026; the trash moved to Settings).
 */
function SampleSidebar({
  isCollapsed = false,
  isWorkspaceBusy = false,
  isLoading = false,
  hasLists = true,
  onQuickActions,
  isWorkspaceLoading = false,
}: SampleSidebarProps) {
  const [collapsed, setCollapsed] = useState(isCollapsed);
  return (
    <Stage height="page">
      <Sidebar
        workspace="Brightline"
        isWorkspaceLoading={isWorkspaceLoading}
        isWorkspaceBusy={isWorkspaceBusy}
        workspaceBusyLabel="Signing out"
        workspaceMenu={
          <Menu label="Workspace menu">
            {/* The role sits with the open workspace's name, not as a heading over the shortcuts. */}
            <MenuItem id="brightline" isChecked description="Owner">
              Brightline
            </MenuItem>
            <MenuItem id="northwind">Northwind</MenuItem>
            <MenuItem id="sign-out" icon="log-out">
              Sign out
            </MenuItem>
          </Menu>
        }
        onQuickActions={onQuickActions ?? (() => undefined)}
        isCollapsed={collapsed}
        onCollapsedChange={setCollapsed}
        footer={
          <>
            <NavItem icon="settings" href="/settings" kbd="⌘,">
              Settings
            </NavItem>
            <NavItem icon="circle-question-mark" onPress={() => undefined} kbd="?">
              Help and shortcuts
            </NavItem>
          </>
        }
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
 * Collapsed (owner, 22 October 2026): a calm rail. Every item a plain icon in a size-nav-item square (object tiles are the
 * open sidebar's), Expand at the top where Collapse sits when open, then Quick actions with its shortcut in the
 * tooltip rather than a keycap, a hairline only where the open sidebar has a section label, the current item
 * highlighted as when open, and the foot's Settings and Help alike. Every icon is named in a tooltip.
 */
export const Collapsed: Story = {
  args: { isCollapsed: true },
  play: async ({ canvas, userEvent }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    // No keycap squeezed into the rail, and no hue tile beside the plain icons (the workspace's ink mark aside).
    await expect(nav.querySelector('kbd')).toBeNull();
    await expect(nav.querySelector('[data-hue]:not([data-hue="ink"])')).toBeNull();
    // Expand comes first after the workspace, then Quick actions, at the top.
    const controls = [...nav.querySelectorAll('a[href], button')].map((each) => each.textContent.trim());
    await expect(controls.slice(1, 3)).toEqual(['Expand the sidebar', 'Quick actions']);
    // Every item on the rail is a size-nav-item square target, the foot's too.
    const side = Math.round(Number.parseFloat(getComputedStyle(nav).getPropertyValue('--size-nav-item')));
    for (const name of ['Expand the sidebar', 'Quick actions', 'Help and shortcuts']) {
      const box = canvas.getByRole('button', { name }).getBoundingClientRect();
      await expect([name, Math.round(box.width), Math.round(box.height)]).toEqual([name, side, side]);
    }
    for (const name of ['Companies', 'People', 'Bookings', 'Settings']) {
      const box = canvas.getByRole('link', { name }).getBoundingClientRect();
      await expect([name, Math.round(box.width), Math.round(box.height)]).toEqual([name, side, side]);
    }
    await expect(canvas.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    // The unlabelled Scheduling group keeps its space but draws no rule; Records keeps its hairline.
    const style = (name: string) => getComputedStyle(canvas.getByRole('group', { name }));
    await expect(style('Scheduling').borderTopStyle).toBe('none');
    await expect(style('Records').borderTopStyle).toBe('solid');
    const search = canvas.getByRole('button', { name: 'Quick actions' });
    await hoverFresh(userEvent, search);
    await expect(await shownTooltip()).toHaveTextContent(/^Quick actions (⌘K|Ctrl\+K)$/);
    await userEvent.unhover(search);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
    const people = canvas.getByRole('link', { name: 'People' });
    await hoverFresh(userEvent, people);
    await expect(await shownTooltip()).toHaveTextContent('People');
    await userEvent.unhover(people);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** The workspace's mark on the rail is named in a tooltip, as every rail icon is. */
export const CollapsedWorkspaceTip: Story = {
  args: { isCollapsed: true },
  play: async ({ canvas, userEvent }) => {
    const mark = canvas.getByRole('button', { name: 'Brightline, workspace menu' });
    await hoverFresh(userEvent, mark);
    await expect(await shownTooltip()).toHaveTextContent('Brightline');
    // The tooltip never stands in the way: pressing the mark still opens the workspace menu, and the tip goes.
    await userEvent.click(mark);
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** The workspace menu: the workspaces with the role under the open one, and Sign out; the trash and shortcuts live in the foot. */
export const WorkspaceMenu: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Brightline, workspace menu' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('the menu did not open');
      return found;
    });
    await expect(menu).toHaveTextContent('Owner');
    await expect(menu.querySelector('header')).toBeNull();
    await expect(menu).not.toHaveTextContent('Trash');
    await expect(menu).not.toHaveTextContent('Keyboard shortcuts');
  },
};

/** A ThemeSwitch in the foot, as the artifact's card has it: on the rail it stacks and stays inside. */
export const RailThemeSwitch: Story = {
  render: () => {
    const theme = fakeThemeController();
    return (
      <Stage height="page">
        <Sidebar
          workspace="Brightline"
          isCollapsed
          onCollapsedChange={() => undefined}
          footer={({ isCollapsed: isRail }) => (
            <ThemeSwitch controller={theme} isCompact={isRail} orientation={isRail ? 'vertical' : 'horizontal'} />
          )}
        >
          <NavItem icon="house" href="/home">
            Home
          </NavItem>
        </Sidebar>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    const theme = canvas.getByRole('radiogroup', { name: 'Theme' });
    await expect(theme).toHaveAttribute('aria-orientation', 'vertical');
    await expect(theme.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
  },
};

/**
 * The rail keeps favourites (spec 0034, AC-935), as plain icons like every rail item: a view's tooltip names it
 * with its object, a record's with its name.
 */
export const RailFavourites: Story = {
  render: () => (
    <Stage height="page">
      <Sidebar workspace="Brightline" isCollapsed onCollapsedChange={() => undefined}>
        <NavSection title="Favourites">
          <NavItem icon="building" hue="blue" href="/companies/views/uk" meta="Companies">
            UK and EU companies
          </NavItem>
          <NavItem icon="user" hue="green" href="/people/ada">
            Ada Lovelace
          </NavItem>
        </NavSection>
        <NavSection title="Records">
          <NavItem icon="building" hue="blue" href="/companies">
            Companies
          </NavItem>
        </NavSection>
      </Sidebar>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const favourites = canvas.getByRole('group', { name: 'Favourites' });
    await expect(favourites.querySelectorAll('a')).toHaveLength(2);
    const view = canvas.getByRole('link', { name: 'UK and EU companies · Companies' });
    await hoverFresh(userEvent, view);
    await expect(await shownTooltip()).toHaveTextContent('UK and EU companies · Companies');
    await userEvent.unhover(view);
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
  play: async ({ canvas, canvasElement, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Brightline, workspace menu Signing out' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    const spinner = canvas.getByRole('progressbar', { name: 'Signing out' });
    await expect(button).toContainElement(spinner);
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
    await userEvent.click(button);
    await expect(document.querySelector('[role="menu"]')).toBeNull();
    // The pointer rests on the empty page, not the button, and its name tooltip is gone before the screenshot.
    await userEvent.hover(canvasElement);
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull(), { timeout: 4000 });
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

/** A section whose fold the screen keeps (spec 0034: stored for each member): only `onFoldChange` changes it. */
function KeptFoldSidebar() {
  const [isFolded, setFolded] = useState(true);
  return (
    <Stage height="page">
      <Sidebar workspace="Brightline">
        <NavSection title="Scheduling" isFolded={isFolded} onFoldChange={setFolded}>
          <NavItem icon="calendar-days" href="/bookings">
            Bookings
          </NavItem>
          <NavItem icon="clock" href="/availability">
            Availability
          </NavItem>
        </NavSection>
      </Sidebar>
    </Stage>
  );
}

/**
 * Folded where the screen says; pressing the label (or Enter on it) tells the screen, and the section follows what
 * the screen keeps, so it opens and folds only through `onFoldChange`.
 */
export const KeptFold: Story = {
  render: () => <KeptFoldSidebar />,
  play: async ({ canvas, userEvent }) => {
    const label = canvas.getByRole('button', { name: 'Scheduling' });
    await expect(label).toHaveAttribute('aria-expanded', 'false');
    // Folded, its items are out of reach.
    await expect(canvas.queryByRole('link', { name: 'Bookings' })).toBeNull();
    label.focus();
    await userEvent.keyboard('{Enter}');
    await expect(label).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('link', { name: 'Bookings' })).toBeInTheDocument();
    await userEvent.click(label);
    await expect(label).toHaveAttribute('aria-expanded', 'false');
  },
};

/** Records that reorder, with item menus, a section menu, a stored fold and a section grip (spec 0034). */
function CustomisableSidebar({
  onReorder,
  onHide,
}: {
  readonly onReorder: (id: string, to: number) => void;
  readonly onHide: (id: string) => void;
}) {
  const [objects, setObjects] = useState(['Companies', 'People', 'Deals']);
  const [isFolded, setFolded] = useState(false);
  return (
    <Stage height="page">
      <Sidebar workspace="Brightline">
        <NavSection
          title="Records"
          isFolded={isFolded}
          onFoldChange={setFolded}
          position={{ index: 0, count: 2 }}
          onMoveSection={() => undefined}
          menu={
            <Menu label="Records options">
              <MenuItem id="down">Move down</MenuItem>
              <MenuItem id="customise">Customise sidebar</MenuItem>
            </Menu>
          }
          onReorder={(id, to) => {
            onReorder(id, to);
            setObjects((current) => {
              const rest = current.filter((name) => name !== id);
              return [...rest.slice(0, to), id, ...rest.slice(to)];
            });
          }}
        >
          {objects.map((name) => (
            <NavItem
              key={name}
              id={name}
              icon="building"
              hue="blue"
              href={`/${name.toLowerCase()}`}
              menu={
                <Menu label={`${name} options`} onAction={() => onHide(name)}>
                  <MenuItem id="hide">Hide from sidebar</MenuItem>
                </Menu>
              }
            >
              {name}
            </NavItem>
          ))}
        </NavSection>
        <NavSection title="Scheduling" position={{ index: 1, count: 2 }} onMoveSection={() => undefined}>
          <NavItem icon="calendar-days" href="/bookings">
            Bookings
          </NavItem>
        </NavSection>
      </Sidebar>
    </Stage>
  );
}

/** Waits until one of the reorder's live regions says `text` (each message lands a frame after the region clears). */
const said = (text: string) =>
  waitFor(() => {
    const regions = [...document.querySelectorAll('[role="status"]')];
    if (!regions.some((region) => region.textContent.includes(text))) throw new Error(`Not said: ${text}`);
  });

/**
 * Reorder from the keyboard (AC-932): Space on an item's grip lifts it, the
 * arrows move it, Space drops it; each step is announced. Esc puts it back.
 */
export const Reorder: Story = {
  render: () => <CustomisableSidebar onReorder={fn()} onHide={fn()} />,
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole('button', { name: 'Move Deals' });
    grip.focus();
    await userEvent.keyboard(' ');
    await expect(grip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    await said('Deals, position 1 of 3.');
    await userEvent.keyboard(' ');
    await said('Deals, moved to position 1 of 3.');
    const links = canvas.getAllByRole('link').map((link) => link.textContent);
    await expect(links.slice(0, 3)).toEqual(['Deals', 'Companies', 'People']);
    // Esc puts a lifted item back.
    const people = canvas.getByRole('button', { name: 'Move People' });
    people.focus();
    await userEvent.keyboard(' {ArrowUp}{Escape}');
    await said('People, put back at position 3 of 3.');
  },
};

/** An item's menu: More opens Hide from sidebar. */
export const ItemMenu: Story = {
  render: () => <CustomisableSidebar onReorder={fn()} onHide={fn()} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More for People' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('No menu.');
      return found;
    });
    await expect(menu).toHaveTextContent('Hide from sidebar');
  },
};

/** A section's menu and grip after its label; the fold is the screen's (stored per member). */
export const SectionMenuAndFold: Story = {
  render: () => <CustomisableSidebar onReorder={fn()} onHide={fn()} />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: 'Records options' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Move the Records section' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Records' }));
    await expect(canvas.getByRole('button', { name: 'Records' })).toHaveAttribute('aria-expanded', 'false');
  },
};

/** A section moves among the sections from the keyboard on its grip, announced; Esc puts it back. */
export const MoveSection: Story = {
  render: () => <MovableSections />,
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole('button', { name: 'Move the Scheduling section' });
    grip.focus();
    await userEvent.keyboard(' {ArrowUp} ');
    await said('Scheduling, moved to position 1 of 2.');
    const labels = canvas
      .getAllByRole('button', { name: /^(Records|Scheduling)$/ })
      .map((button) => button.textContent);
    await expect(labels).toEqual(['Scheduling', 'Records']);
  },
};

/** Two sections the screen keeps in order, each with a grip after its label. */
function MovableSections() {
  const [order, setOrder] = useState(['Records', 'Scheduling']);
  return (
    <Stage height="page">
      <Sidebar workspace="Brightline">
        {order.map((title, index) => (
          <NavSection
            key={title}
            title={title}
            position={{ index, count: order.length }}
            onMoveSection={(to) => {
              setOrder((current) => {
                const rest = current.filter((each) => each !== title);
                return [...rest.slice(0, to), title, ...rest.slice(to)];
              });
            }}
          >
            <NavItem icon="calendar-days" href={`/${title.toLowerCase()}`}>
              {`${title} home`}
            </NavItem>
          </NavSection>
        ))}
      </Sidebar>
    </Stage>
  );
}
