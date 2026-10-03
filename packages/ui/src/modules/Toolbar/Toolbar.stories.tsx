import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { AvatarStack } from '../../atoms/Avatar/Avatar.tsx';
import { Button, SplitButton } from '../../atoms/Button/Button.tsx';
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
      canvas.getByRole('button', { name: 'Sorted by Funding raised, descending, and 1 more' }),
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
    const sort = canvas.getByRole('button', { name: /Sorted by/ });
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
    await expect(canvas.getByRole('banner').getBoundingClientRect().height).toBe(46);
  },
};
