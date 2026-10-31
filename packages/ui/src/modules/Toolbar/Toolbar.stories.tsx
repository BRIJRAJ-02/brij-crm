import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { AvatarStack } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { SplitButton } from '../../atoms/Button/SplitButton.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { FilterChip } from '../../molecules/FilterChip/FilterChip.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkListToolbar } from '../LinkList/LinkList.tsx';
import {
  SortChip,
  Toolbar,
  ToolbarSearch,
  TopBar,
  ViewBar,
  type ViewChoice,
  type ViewLayoutSwitch,
} from './Toolbar.tsx';

const VIEWS: readonly ViewChoice[] = [
  { id: 'all', name: 'All companies' },
  { id: 'uk', name: 'UK and EU companies' },
  { id: 'board', name: 'By stage', icon: 'kanban' },
];

/** Table or Board, as a view passes it: icons on both, so a phone shows the icons alone. */
function useLayoutSwitch(initial = 'table'): ViewLayoutSwitch {
  const [value, setValue] = useState(initial);
  return {
    label: 'Layout',
    segments: [
      { value: 'table', label: 'Table', icon: 'table' },
      { value: 'board', label: 'Board', icon: 'kanban' },
    ],
    value,
    onChange: setValue,
  };
}

interface BarsProps {
  readonly isLoading?: boolean;
  readonly isChanged?: boolean;
  readonly onViewChange?: (id: string) => void;
}

/** The three bars above a table, as a view draws them. */
function Bars({ isLoading = false, isChanged = true, onViewChange }: BarsProps) {
  const [view, setView] = useState('all');
  const layout = useLayoutSwitch();
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
        settings={{ onPress: () => undefined }}
        layout={layout}
      />
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
      settings={{ onPress: fn() }}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
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
    // The pointer leaves the switcher for the empty page, so the shot never catches its hover.
    await userEvent.hover(canvasElement);
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

/** Who can see it: one action whose submenu holds its three states, the current one checked; choosing runs `id/choice`. */
export const WhoCanSeeIt: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => {
    function Bar() {
      const [ran, setRan] = useState('');
      return (
        <>
          <ViewBar
            views={VIEWS}
            currentViewId="all"
            onViewChange={fn()}
            actions={[
              {
                id: 'who',
                label: 'Who can see it',
                icon: 'users',
                choices: [
                  { id: 'private', label: 'Only me', reason: 'Make another view the default first.' },
                  { id: 'workspace', label: 'Everyone', isSelected: true },
                  { id: 'locked', label: 'Everyone, only admins edit' },
                ],
              },
            ]}
            onAction={setRan}
          />
          <output>{ran}</output>
        </>
      );
    }
    return <Bar />;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All companies' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Who can see it' }));
    const locked = await within(document.body).findByRole('menuitem', { name: 'Everyone, only admins edit' });
    await expect(within(document.body).getByRole('menuitem', { name: /Only me/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(locked);
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('who/locked'));
  },
};

/** In the switcher, Alt with an arrow moves a movable view up or down its group; focus stays on it. */
export const MoveViewByKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => {
    function Bar() {
      const [moved, setMoved] = useState('');
      return (
        <>
          <ViewBar
            views={VIEWS.map((view) => ({ ...view, isMovable: view.id !== 'all' }))}
            currentViewId="all"
            onViewChange={fn()}
            onMoveView={(id, direction) => {
              setMoved(`${id} ${direction}`);
            }}
          />
          <output>{moved}</output>
        </>
      );
    }
    return <Bar />;
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All companies' }));
    const item = await within(document.body).findByRole('menuitemradio', { name: 'By stage' });
    await expect(item).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    item.focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('board up'));
    await expect(item).toHaveFocus();
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

/** The default order nobody chose: a muted "Sorted by Created at" with no remove; pressing it opens the sort builder. */
export const DefaultSortChip: Story = {
  render: () => <DefaultChip />,
  play: async ({ canvas, userEvent }) => {
    const chip = canvas.getByRole('group', { name: 'Sort: Created at, descending, the default order' });
    await expect(chip).toHaveTextContent('Sorted by Created at');
    await expect(within(chip).queryByRole('button', { name: /Remove/ })).toBeNull();
    await userEvent.click(within(chip).getByRole('button', { name: /Sorted by Created at/ }));
    await waitFor(() => expect(canvas.getByText('Opened 1')).toBeInTheDocument());
  },
};

/** The default order's chip, counting presses as a screen opening the sort builder would. */
function DefaultChip() {
  const [opened, setOpened] = useState(0);
  return (
    <Toolbar label="View options">
      <SortChip
        attribute="Created at"
        direction="descending"
        isDefault
        onPress={() => {
          setOpened((count) => count + 1);
        }}
      />
      <Button variant="dashed" icon="list-filter">
        Filter
      </Button>
      <span>{`Opened ${String(opened)}`}</span>
    </Toolbar>
  );
}

/** The view's search, holding its own text as a screen would. */
function SearchBar() {
  const [typed, setTyped] = useState('');
  return (
    <Toolbar label="View options" search={<ToolbarSearch label="Search people" value={typed} onChange={setTyped} />}>
      <Button variant="dashed" icon="list-filter">
        Filter
      </Button>
      <span>{`Typed ${typed}`}</span>
    </Toolbar>
  );
}

/** Search beside Filter: a real field from the start, wider while focused or holding text; Esc clears it. */
export const Search: Story = {
  render: () => <SearchBar />,
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search people' });
    await expect(field).toHaveAttribute('placeholder', 'Search people');
    await userEvent.click(field);
    await userEvent.keyboard('ada');
    await expect(canvas.getByText('Typed ada')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(field).toHaveFocus();
    await expect(canvas.getByText('Typed')).toBeInTheDocument();
  },
};

/** Past seven views the switcher's menu gets a search field, which narrows the views as you type. */
export const ManyViews: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <ViewBar
      views={['All', 'Pipeline', 'Mine', 'Hot', 'Cold', 'London', 'Paris', 'Berlin'].map((name) => ({
        id: name.toLowerCase(),
        name,
      }))}
      currentViewId="all"
      onViewChange={fn()}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'All' }));
    const search = await within(document.body).findByRole('searchbox', { name: 'Search views' });
    await userEvent.type(search, 'par');
    await waitFor(() => expect(within(document.body).queryByRole('menuitemradio', { name: 'Berlin' })).toBeNull());
    await expect(within(document.body).getByRole('menuitemradio', { name: 'Paris' })).toBeInTheDocument();
  },
};

/** A list page with no saved views (Booking pages, Forms; spec 0034): the tile, title, count and New, then the search. */
function ListPage() {
  const [query, setQuery] = useState('');
  return (
    <div>
      <TopBar
        title="Booking pages"
        icon="link"
        hue="orange"
        meta={<Badge count={3} max={Infinity} label="booking pages" />}
      >
        <Button variant="primary" icon="plus" label="New booking page">
          New
        </Button>
      </TopBar>
      <ViewBar>
        <LinkListToolbar searchLabel="Search booking pages" query={query} onQueryChange={setQuery} size="sm" />
      </ViewBar>
      <ViewBar views={VIEWS} currentViewId="all" onViewChange={fn()} />
    </div>
  );
}

/** A view bar as a view draws it: the switcher, then View settings and Table or Board on one line, at their own state. */
function ViewBarEnd({ layoutValue = 'table', isOpen = false, isLocked = false, isDisabled = false }) {
  const layout = { ...useLayoutSwitch(layoutValue), isDisabled };
  return (
    <ViewBar
      views={VIEWS}
      currentViewId="all"
      onViewChange={fn()}
      onCreateView={fn()}
      settings={{ onPress: fn(), isOpen, isDisabled }}
      layout={layout}
    >
      {isLocked && <Callout placement="bar">Locked by Ada Lovelace</Callout>}
    </ViewBar>
  );
}

/**
 * The bar with no switcher: the page's search at its end, in the same bar an object's views take, so the page's
 * content starts where a view's does (the second bar is drawn under it to compare).
 */
export const ToolsOnly: Story = {
  render: () => <ListPage />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Booking pages' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'New booking page' })).toHaveTextContent('New');
    const search = canvas.getByRole('searchbox', { name: 'Search booking pages' });
    const tools = barOf(search);
    const views = tools.nextElementSibling;
    await expect(views).toContainElement(canvas.getByRole('button', { name: 'All companies' }));
    // The same height as the switcher's bar: nothing moves between a list page and an object's view.
    await expect(tools.getBoundingClientRect().height).toBe(views?.getBoundingClientRect().height);
  },
};

/** The bar holding `element`: its ancestor that sits beside the TopBar's header. */
function barOf(element: HTMLElement): HTMLElement {
  let bar = element;
  while (bar.parentElement !== null && bar.parentElement.querySelector(':scope > header') === null) {
    bar = bar.parentElement;
  }
  return bar;
}

/**
 * The end of the view bar (the owner, 22 October 2026): one secondary View settings button, then a compact Table
 * and Board switch, both size-control tall on the switcher's line. Add attribute lives under View settings and in
 * the table's "+" column; the view's actions live in the switcher's menu.
 */
export const ViewBarEndDefault: Story = {
  name: 'View bar end',
  render: () => <ViewBarEnd />,
  play: async ({ canvas, userEvent }) => {
    const settings = canvas.getByRole('button', { name: 'View settings' });
    const layout = canvas.getByRole('radiogroup', { name: 'Layout' });
    await expect(canvas.queryByRole('button', { name: /Add attribute/ })).toBeNull();
    // One line: the button and the switch are the same height, centred on the same line.
    const button = settings.getBoundingClientRect();
    const segmented = layout.getBoundingClientRect();
    await expect(Math.abs(button.height - segmented.height)).toBeLessThan(1);
    await expect(Math.abs(button.top - segmented.top)).toBeLessThan(1);
    await expect(settings).toHaveTextContent('View settings');
    await userEvent.click(canvas.getByRole('radio', { name: 'Board' }));
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeChecked();
  },
};

/** Board chosen, with View settings open (expanded) and a locked view's line before it. */
export const ViewBarEndBoardOpen: Story = {
  name: 'View bar end, board, settings open, locked',
  render: () => <ViewBarEnd layoutValue="board" isOpen isLocked />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'View settings' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeChecked();
  },
};

/** Keyboard: Tab goes switcher, View settings, then the chosen layout; the arrows switch the layout. */
export const ViewBarEndKeyboard: Story = {
  name: 'View bar end, keyboard',
  parameters: { crm: { screenshot: false } },
  render: () => <ViewBarEnd />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'All companies' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'View settings' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Table' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeChecked();
  },
};

/** On a phone (390 wide) View settings and Table or Board drop their words for their icons, and keep their names. */
export const ViewBarEndPhone: Story = {
  name: 'View bar end, phone',
  render: () => (
    <Stage width="phone">
      <ViewBarEnd />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const settings = canvas.getByRole('button', { name: 'View settings' });
    await expect(settings.getBoundingClientRect().width).toBeLessThan(40);
    await expect(canvas.getByRole('radio', { name: 'Table' })).toBeInTheDocument();
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeInTheDocument();
    const layout = canvas.getByRole('radiogroup', { name: 'Layout' });
    await expect(
      Math.abs(settings.getBoundingClientRect().height - layout.getBoundingClientRect().height),
    ).toBeLessThan(1);
  },
};

/** Disabled: View settings and Table or Board keep their places, and say they can't be used now. */
export const ViewBarEndDisabled: Story = {
  name: 'View bar end, disabled',
  render: () => <ViewBarEnd isDisabled />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'View settings' })).toBeDisabled();
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeDisabled();
  },
};
