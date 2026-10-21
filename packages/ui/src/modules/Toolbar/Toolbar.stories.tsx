import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { AvatarStack } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { SplitButton } from '../../atoms/Button/SplitButton.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { FilterChip } from '../../molecules/FilterChip/FilterChip.tsx';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { SortChip, Toolbar, TopBar, ViewBar, type ViewChoice } from './Toolbar.tsx';

const VIEWS: readonly ViewChoice[] = [
  { id: 'all', name: 'All companies' },
  { id: 'uk', name: 'UK and EU companies' },
  { id: 'board', name: 'By stage', icon: 'kanban' },
];

interface BarsProps {
  readonly isLoading?: boolean;
  readonly isChanged?: boolean;
  readonly onViewChange?: (id: string) => void;
}

/** The three bars above a table, as a view draws them. */
function Bars({ isLoading = false, isChanged = true, onViewChange }: BarsProps) {
  const [view, setView] = useState('all');
  return (
    <div>
      <TopBar
        title="Companies"
        icon="building"
        hue="blue"
        meta={<Button variant="ghost" icon="info" label="About Companies" />}
      >
        <AvatarStack
          people={[
            { id: 'm1', name: 'Ada Lovelace', hue: 'orange' },
            { id: 'm2', name: 'Grace Hopper', hue: 'sky' },
          ]}
        />
      </TopBar>
      <ViewBar
        views={VIEWS}
        currentViewId={view}
        onViewChange={(id) => {
          setView(id);
          onViewChange?.(id);
        }}
        onCreateView={() => undefined}
        isLoading={isLoading}
      >
        <Button icon="settings">View settings</Button>
        <Button icon="download" iconRight="chevron-down">
          Import / Export
        </Button>
      </ViewBar>
      <Toolbar
        label="View options"
        {...(isChanged
          ? {
              end: (
                <>
                  <Button variant="ghost">Discard changes</Button>
                  <SplitButton
                    menu={
                      <Menu label="Save options">
                        <MenuItem id="new">Save as new view</MenuItem>
                      </Menu>
                    }
                  >
                    Save
                  </SplitButton>
                </>
              ),
            }
          : {})}
      >
        <SortChip attribute="Funding raised" direction="descending" more={1} />
        <FilterChip attribute={['Segment']} icon="tag" operator="is" value={<Tag hue="blue">SaaS</Tag>} />
        <Button variant="dashed" icon="list-filter">
          Filter
        </Button>
      </Toolbar>
    </div>
  );
}

const meta = {
  title: 'Modules/Toolbar',
  component: Bars,
} satisfies Meta<typeof Bars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The top bar's title is the page's heading; the view bar switches views; the toolbar states the sort and filters, and Save while the view has changes. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Companies' })).toBeInTheDocument();
    await expect(canvas.getByRole('toolbar', { name: 'View options' })).toBeInTheDocument();
    await expect(
      canvas.getByRole('group', { name: 'Sort: Funding raised, descending, and 1 more' }),
    ).toBeInTheDocument();
  },
};

/** The switcher's menu marks the current view; choosing one changes it. */
export const SwitchView: Story = {
  args: { onViewChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All companies' }));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onViewChange).toHaveBeenCalledWith('uk');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'UK and EU companies' })).toBeInTheDocument());
  },
};

/** Tab enters the toolbar once; the arrow keys move between its controls. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const sort = canvas.getByRole('button', { name: 'Funding raised' });
    sort.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(sort).not.toHaveFocus();
    await expect(canvas.getByRole('toolbar')).toContainElement(document.activeElement as HTMLElement);
  },
};

/** The views are still coming: the switcher is a skeleton, and nothing to save. */
export const Loading: Story = {
  args: { isLoading: true, isChanged: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading views')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull();
  },
};

/** A record page's top bar: where it sits, then its name. */
export const RecordPage: Story = {
  render: () => (
    <TopBar
      title="Northwind Traders"
      crumbs={[{ id: 'companies', label: 'Companies', href: '/companies', icon: 'building' }]}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Companies' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Northwind Traders' })).toBeInTheDocument();
  },
};

/** A page still loading: the top bar keeps its height with a skeleton line for its title; the h1 says it is loading. */
export const TopBarLoading: Story = {
  render: () => <TopBar title="Loading" isLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Loading' })).toBeInTheDocument();
    await expect(canvas.getByRole('banner')).toHaveAttribute('aria-busy', 'true');
    // The skeleton shows after the loading delay; the bar is its full height before and after.
    await waitFor(() => expect(canvas.getByRole('banner').querySelector('[aria-hidden="true"]')).not.toBeNull());
    const banner = canvas.getByRole('banner');
    const bar = Number.parseFloat(getComputedStyle(banner).getPropertyValue('--size-bar'));
    await expect(bar).toBeGreaterThan(0);
    await expect(banner.getBoundingClientRect().height).toBe(bar);
  },
};

/** A record page that loads in place: its title arrives in the same h1, so focus the app gave it stays there. */
function ArrivingTitle() {
  const [isLoading, setLoading] = useState(true);
  return (
    <div>
      <TopBar
        title={isLoading ? 'Loading' : 'Northwind Traders'}
        crumbs={[{ id: 'companies', label: 'Companies', href: '/companies', icon: 'building' }]}
        isLoading={isLoading}
      />
      <Button
        onPress={() => {
          setLoading(false);
        }}
      >
        Arrive
      </Button>
    </div>
  );
}

/** The title focused while loading keeps focus once the record arrives. */
export const TopBarArrives: Story = {
  render: () => <ArrivingTitle />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const loading = canvas.getByRole('heading', { level: 1, name: 'Loading' });
    loading.focus();
    // Pressed by script, so focus stays on the title, as when the data layer answers.
    canvas.getByRole('button', { name: 'Arrive' }).click();
    const arrived = await canvas.findByRole('heading', { level: 1, name: 'Northwind Traders' });
    await expect(arrived).toBe(loading);
    await expect(arrived).toHaveFocus();
  },
};

/** What the filter matches, spoken to screen readers and never shown (spec 0020, AC-487). */
export const MatchStatus: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Toolbar label="View options" status="124 people match">
      <SortChip attribute="Created at" direction="descending" />
      <Button variant="dashed" icon="list-filter">
        Filter
      </Button>
    </Toolbar>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('124 people match');
  },
};

/** Shared views, then a Private section, with a locked view marked by its lock (spec 0020, milestone 2). */
export const GroupedAndLocked: Story = {
  render: () => (
    <ViewBar
      views={[
        { id: 'all', name: 'All companies' },
        { id: 'pipeline', name: 'Pipeline', isLocked: true },
        { id: 'mine', name: 'My accounts', section: 'Private' },
        { id: 'later', name: 'Follow up', section: 'Private' },
      ]}
      currentViewId="pipeline"
      onViewChange={fn()}
      onCreateView={fn()}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Pipeline' });
    await userEvent.click(trigger);
    // The pointer leaves the trigger, so the picture never catches its hover tint (it flaked in CI).
    await userEvent.unhover(trigger);
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('No menu yet.');
      return found as HTMLElement;
    });
    await expect(within(menu).getByRole('group', { name: 'Private' })).toBeInTheDocument();
    await expect(within(menu).getByRole('menuitemradio', { name: /Pipeline/ })).toHaveTextContent('Locked');
    await expect(within(menu).getByRole('menuitemradio', { name: 'Create view' })).toBeInTheDocument();
    // The menu fades in; axe reads colours next, so let the fade end (Firefox was measuring mid fade).
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  },
};

/**
 * The view's own actions under "This view" at the end of the switcher's menu (the bar's "···" button folded in,
 * 21 October 2026): plain menu items, grouped by hairlines, one disabled with its short reason, the danger one
 * last; the menu stays narrow, its reasons wrapping under their items.
 */
export const WithViewActions: Story = {
  render: () => (
    <ViewBar
      views={VIEWS}
      currentViewId="all"
      onViewChange={fn()}
      onCreateView={fn()}
      actions={[
        { id: 'rename', label: 'Rename', icon: 'pencil' },
        { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
        { id: 'copy-link', label: 'Copy link', icon: 'link' },
        {
          id: 'make-private',
          label: 'Make private',
          icon: 'lock',
          startsGroup: true,
          reason: 'Make another view the default first.',
        },
        { id: 'lock', label: 'Lock', icon: 'lock' },
        {
          id: 'delete',
          label: 'Delete view',
          icon: 'trash',
          isDanger: true,
          startsGroup: true,
          reason: 'Make another view the default first.',
        },
      ]}
      onAction={fn()}
    >
      <Button variant="ghost" icon="settings">
        View settings
      </Button>
    </ViewBar>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All companies' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('No menu yet.');
      return found as HTMLElement;
    });
    const section = within(menu).getByRole('group', { name: 'This view' });
    await expect(within(section).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await expect(within(section).getByRole('menuitem', { name: /Delete view/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Long reasons wrap under their items rather than widening the menu.
    await expect(menu.getBoundingClientRect().width).toBeLessThan(300);
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  },
};

/** A bar whose view actions say which one ran, for the story below. */
function RunsActions() {
  const [ran, setRan] = useState('');
  return (
    <>
      <ViewBar
        views={VIEWS}
        currentViewId="all"
        onViewChange={fn()}
        actions={[{ id: 'duplicate', label: 'Duplicate', icon: 'copy' }]}
        onAction={setRan}
      />
      <output>{ran}</output>
    </>
  );
}

/** Choosing one of the view's actions runs it by its id, and the menu closes. */
export const RunViewAction: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <RunsActions />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All companies' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('duplicate'));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};

/** The sort chip in the filter chips' shape: one sort, more, a long name, and read only. */
export const SortChips: Story = {
  render: () => (
    <Toolbar label="View options">
      <SortChip attribute="Created at" direction="descending" onPress={fn()} onRemove={fn()} />
      <SortChip attribute="Name" direction="ascending" more={2} onPress={fn()} onRemove={fn()} />
      <SortChip
        attribute="Last email interaction with the account owner"
        direction="ascending"
        onPress={fn()}
        onRemove={fn()}
      />
      <SortChip attribute="Updated by" direction="descending" />
    </Toolbar>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('group', { name: 'Sort: Name, ascending, and 2 more' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('button', { name: 'Remove sorts' })).toHaveLength(1);
    await expect(canvas.getAllByRole('button', { name: 'Remove sort' })).toHaveLength(2);
    const readOnly = canvas.getByRole('group', { name: 'Sort: Updated by, descending' });
    await expect(within(readOnly).queryByRole('button', { name: /Remove/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: '+2' }));
  },
};
