import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Panel } from '../../molecules/Panel/Panel.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NavItem, NavSection, Sidebar } from '../Sidebar/Sidebar.tsx';
import { Toolbar, TopBar, ViewBar } from '../Toolbar/Toolbar.tsx';
import { AppShell } from './AppShell.tsx';

/** A screen in the shell: the sidebar, the three bars, and a view with nothing in it yet. */
function SampleShell({
  withPanel = false,
  withBanner = false,
  withPushingPanel = false,
  isRail = false,
  withFloatingPanel = false,
}: {
  readonly withPanel?: boolean;
  readonly withBanner?: boolean;
  readonly withPushingPanel?: boolean;
  /** The sidebar folded to its rail. */
  readonly isRail?: boolean;
  readonly withFloatingPanel?: boolean;
}) {
  return (
    <Stage height="page">
      <AppShell
        sidebar={
          <Sidebar workspace="Brightline" onQuickActions={() => undefined} isCollapsed={isRail}>
            <NavItem icon="square-check" href="/tasks">
              Tasks
            </NavItem>
            <NavSection title="Records">
              <NavItem icon="building" hue="blue" href="/companies" isCurrent>
                Companies
              </NavItem>
              <NavItem icon="user" hue="green" href="/people">
                People
              </NavItem>
            </NavSection>
          </Sidebar>
        }
        topBar={<TopBar title="Companies" icon="building" hue="blue" />}
        viewBar={
          <ViewBar
            views={[{ id: 'all', name: 'All companies' }]}
            currentViewId="all"
            onViewChange={() => undefined}
            settings={{ onPress: () => undefined }}
          />
        }
        toolbar={
          <Toolbar label="View options">
            <Button variant="dashed" icon="list-filter">
              Filter
            </Button>
          </Toolbar>
        }
        {...(withBanner
          ? {
              banner: (
                <Callout tone="warning" placement="banner" actions={<Button variant="ghost">Reconnect</Button>}>
                  Your Google calendar disconnected. Your meetings and busy times stop updating until you reconnect it.
                </Callout>
              ),
            }
          : {})}
        {...(withPanel
          ? {
              panel: (
                <EmptyState title="No record open" icon="file">
                  Choose a record to see its details here.
                </EmptyState>
              ),
            }
          : {})}
      >
        <EmptyState title="No companies yet">Companies you add or import show here.</EmptyState>
        {withFloatingPanel && (
          <Panel title="Northwind Traders" variant="floating" isOpen onClose={() => undefined}>
            A record opened from its table.
          </Panel>
        )}
        {withPushingPanel && (
          <Panel title="Grace Hopper" isOpen onClose={() => undefined} pushesPage>
            A submission opened beside its table.
          </Panel>
        )}
      </AppShell>
    </Stage>
  );
}

const meta = {
  title: 'Modules/AppShell',
  component: SampleShell,
} satisfies Meta<typeof SampleShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The landmarks in order: the skip link, the navigation, then the main column with the page's heading. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    await expect(canvas.getByRole('main')).toContainElement(
      canvas.getByRole('heading', { level: 1, name: 'Companies' }),
    );
  },
};

/** The sidebar folded to its rail (spec 0072): the page's surface, inset on the canvas, takes the room it leaves. */
export const Rail: Story = {
  args: { isRail: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('main')).toContainElement(
      canvas.getByRole('heading', { level: 1, name: 'Companies' }),
    );
  },
};

/**
 * The record panel's floating Panel over the content area (spec 0074, AC-7411): below every bar (the top bar, the
 * view's bar and the toolbar stay in reach), at the content area's full height less its inset, at the right, and the
 * page beside it keeps its width.
 */
export const FloatingInTheView: Story = {
  parameters: { crm: { screenshot: false } },
  args: { withFloatingPanel: true },
  play: async ({ canvas, canvasElement }) => {
    const panel = canvas.getByRole('dialog', { name: 'Northwind Traders' }).closest('section') ?? canvasElement;
    // The page under the panel is hidden from assistive tech while it is open, so it is found by its place instead.
    const view = canvasElement.querySelector('.ws-app-shell-view');
    await expect(view).not.toBeNull();
    const toolbar = (
      canvasElement.querySelector('[aria-label="View options"]') ?? canvasElement
    ).getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const area = (view as Element).getBoundingClientRect();
    // Under the bars, inside the content area, never past its foot or its end.
    await expect(box.top).toBeGreaterThanOrEqual(toolbar.bottom);
    await expect(box.top).toBeGreaterThan(area.top);
    // At the window's foot and end, less its inset: in the app the shell fills the window, so those are the content
    // area's (the story's stage leaves a margin round the shell).
    await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(box.bottom).toBeGreaterThan(area.top);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(box.left).toBeGreaterThan(area.left);
    // The content area keeps its width: the panel floats over it rather than pushing it.
    await expect(Math.round(area.width)).toBe(
      Math.round((view as Element).parentElement?.getBoundingClientRect().width ?? 0),
    );
  },
};

/** The skip link is the first Tab stop, shows while focused, and jumps to the main column. */
export const SkipLink: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const skip = canvas.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toHaveFocus();
    await expect(skip.matches(':focus-visible')).toBe(true);
    await expect(skip.getBoundingClientRect().width).toBeGreaterThan(1);
    await expect(skip).toHaveAttribute('href', `#${canvas.getByRole('main').id}`);
  },
};

/** A banner under the bars, for a state of the whole app for this person: a calendar that stopped syncing. */
export const WithBanner: Story = {
  args: { withBanner: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const main = canvas.getByRole('main');
    await expect(main).toHaveTextContent(/Your Google calendar disconnected/);
    // It comes after the bars, so its action follows them in Tab order.
    const filter = canvas.getByRole('button', { name: 'Filter' });
    const reconnect = canvas.getByRole('button', { name: 'Reconnect' });
    await expect(filter.compareDocumentPosition(reconnect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/**
 * No sidebar (spec 0070): a screen embedded in another product's frame, which brings its own navigation. The page
 * has the whole width, and with nothing to skip there is no skip link.
 */
export const WithoutSidebar: Story = {
  render: () => (
    <Stage height="page">
      <AppShell topBar={<TopBar title="Link page" icon="id-card" />}>
        <EmptyState title="No blocks yet">Links and sections you add show here.</EmptyState>
      </AppShell>
    </Stage>
  ),
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.queryByRole('navigation')).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'Skip to content' })).toBeNull();
    await expect(canvas.getByRole('main')).toContainElement(
      canvas.getByRole('heading', { level: 1, name: 'Link page' }),
    );
    await userEvent.tab();
    await expect(canvas.queryByRole('link', { name: 'Skip to content' })).toBeNull();
  },
};

/** A side panel beside the view, as a record's details sit. */
export const WithPanel: Story = {
  args: { withPanel: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('complementary')).toHaveTextContent('No record open');
  },
};

/**
 * A Panel that pushes the page (`pushesPage`): the main column, bars and all, gives up the panel's width, so the
 * Filter at the bar's end stays clear of it (a form's submission beside its table, lane 3c).
 */
export const PushedByPanel: Story = {
  args: { withPushingPanel: true },
  play: async ({ canvas }) => {
    const main = canvas.getByRole('main');
    await expect(main).toHaveAttribute('data-pushed', 'md');
    const panel = canvas.getByRole('dialog', { name: 'Grace Hopper' });
    const filter = canvas.getByRole('button', { name: 'Filter' });
    await expect(filter.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().left);
  },
};

/** A settings page on a phone (`phoneSidebar="hidden"`): the page alone, its TopBar's chevron the way back up. */
export const PhonePage: Story = {
  render: () => (
    <Stage width="phone" height="page">
      <AppShell
        phoneSidebar="hidden"
        sidebar={
          <Sidebar heading="Settings" back={{ label: 'Leave settings', href: '/' }} label="Settings">
            <NavItem icon="user-round" href="/settings/profile" isCurrent>
              Profile
            </NavItem>
          </Sidebar>
        }
        topBar={<TopBar title="Profile" back={{ label: 'All settings', href: '/settings' }} />}
      >
        <EmptyState title="Your details">Name and photo.</EmptyState>
      </AppShell>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Settings', hidden: true })).not.toBeVisible();
    await expect(canvas.getByRole('link', { name: 'All settings' })).toBeVisible();
  },
};

/** Settings on a phone (`phoneSidebar="full"`): the sidebar alone, open and the whole width, every entry labelled. */
export const PhoneList: Story = {
  render: () => (
    <Stage width="phone" height="page">
      <AppShell
        phoneSidebar="full"
        sidebar={
          <Sidebar heading="Settings" back={{ label: 'Leave settings', href: '/' }} label="Settings">
            <NavItem icon="user-round" href="/settings/profile">
              Profile
            </NavItem>
            <NavItem icon="bell" href="/settings/notifications">
              Notifications
            </NavItem>
          </Sidebar>
        }
        topBar={<TopBar title="Settings" />}
      >
        <EmptyState title="Nothing here">The list is the page.</EmptyState>
      </AppShell>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Notifications' })).toBeVisible();
    await expect(canvas.getByRole('main', { hidden: true })).not.toBeVisible();
  },
};
