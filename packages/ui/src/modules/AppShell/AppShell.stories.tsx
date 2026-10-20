import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NavItem, NavSection, Sidebar } from '../Sidebar/Sidebar.tsx';
import { Toolbar, TopBar, ViewBar } from '../Toolbar/Toolbar.tsx';
import { AppShell } from './AppShell.tsx';

/** A screen in the shell: the sidebar, the three bars, and a view with nothing in it yet. */
function SampleShell({
  withPanel = false,
  withBanner = false,
}: {
  readonly withPanel?: boolean;
  readonly withBanner?: boolean;
}) {
  return (
    <Stage height="page">
      <AppShell
        sidebar={
          <Sidebar workspace="Brightline" onQuickActions={() => undefined}>
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
          <ViewBar views={[{ id: 'all', name: 'All companies' }]} currentViewId="all" onViewChange={() => undefined}>
            <Button icon="settings">View settings</Button>
          </ViewBar>
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

/** The skip link is the first Tab stop, shows while focused, and jumps to the main column. */
export const SkipLink: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const skip = canvas.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toHaveFocus();
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

/** A side panel beside the view, as a record's details sit. */
export const WithPanel: Story = {
  args: { withPanel: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('complementary')).toHaveTextContent('No record open');
  },
};
