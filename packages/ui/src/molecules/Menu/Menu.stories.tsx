import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { ListSource } from '../../lib/list-source.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ContextMenu, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, SubmenuTrigger } from './Menu.tsx';

const meta = {
  title: 'Molecules/Menu',
  component: Menu,
  args: { label: 'Column options', onAction: fn(), children: null },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

function openMenu() {
  return waitFor(() => {
    const found = document.querySelector('[role="menu"]');
    if (found === null) throw new Error('the menu did not open');
    return found;
  });
}

function ColumnOptions({ onAction }: { readonly onAction?: (key: string | number) => void }) {
  return (
    <Menu label="Column options" {...(onAction === undefined ? {} : { onAction })}>
      <MenuItem id="asc" icon="chevron-up" isChecked>
        Sort ascending
      </MenuItem>
      <MenuItem id="desc" icon="chevron-down">
        Sort descending
      </MenuItem>
      <MenuSeparator />
      <SubmenuTrigger>
        <MenuItem id="format" icon="settings">
          Formatting
        </MenuItem>
        <Menu label="Formatting">
          <MenuItem id="wrap">Wrap text</MenuItem>
          <MenuItem id="clip">Clip text</MenuItem>
        </Menu>
      </SubmenuTrigger>
      <MenuItem id="rename" icon="pencil" kbd="⌘R">
        Edit column label
      </MenuItem>
      <MenuItem id="hide" icon="eye-off">
        Hide from view
      </MenuItem>
      <MenuSeparator />
      <MenuItem id="delete" icon="trash" isDanger>
        Delete attribute
      </MenuItem>
    </Menu>
  );
}

/** Opened from the keyboard: arrows move, Enter acts, and focus returns to the trigger. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <MenuTrigger>
        <Button icon="ellipsis" label="Column options" />
        <ColumnOptions {...(args.onAction === undefined ? {} : { onAction: args.onAction })} />
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Column options' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const menu = await openMenu();
    await expect(menu.closest('[data-opened-by]')).toHaveAttribute('data-opened-by', 'keyboard');
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Sort ascending'));
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith('desc');
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** Open, with a submenu, a shortcut, separators and a destructive item. */
export const Open: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="ellipsis" label="Column options" />
        <ColumnOptions />
      </MenuTrigger>
    </Stage>
  ),
  play: async () => {
    const menu = await openMenu();
    await expect(menu).toHaveAccessibleName('Column options');
    await expect(menu.querySelector('[data-danger]')).toHaveTextContent('Delete attribute');
    // The sort in effect carries a check, which screen readers hear after its label.
    const sorted = [...menu.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent.includes('ascending'),
    );
    await expect(sorted).toHaveAccessibleName('Sort ascending');
    await expect(sorted).toHaveAccessibleDescription('Current');
  },
};

/** A pending row says where something stands: full contrast in the secondary colour, never highlighted or chosen. */
export const PendingRow: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="ellipsis" label="Records" />
        <Menu label="Records" {...(args.onAction === undefined ? {} : { onAction: args.onAction })}>
          <MenuItem id="pending" isPending>
            Searching…
          </MenuItem>
          <MenuItem id="ada">Ada Lovelace</MenuItem>
        </Menu>
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    const menu = await openMenu();
    const pending = menu.querySelector('[data-pending]');
    await expect(pending).toHaveAttribute('aria-disabled', 'true');
    await expect(pending).toHaveAttribute('data-loading');
    const ada = [...menu.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Ada'));
    if (!(ada instanceof HTMLElement)) throw new Error('no Ada row');
    await userEvent.click(ada);
    await waitFor(() => expect(args.onAction).toHaveBeenCalledWith('ada'));
  },
};

/**
 * A choice among plain actions (the command palette's themes under Actions): a
 * group of its own joined to the one above, with no gap or heading of its own,
 * whose items are radio items with the check at the end. Their icons line up
 * with the actions' icons, and screen readers hear which one is checked.
 */
export const ChoiceAmongActions: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="ellipsis" label="Actions" />
        <Menu label="Actions" {...(args.onAction === undefined ? {} : { onAction: args.onAction })}>
          <MenuSection label="Actions">
            <MenuItem id="create" icon="plus">
              Create a company
            </MenuItem>
          </MenuSection>
          <MenuSection label="Theme" isJoined selectionMode="single" selectedKeys={['dark']}>
            <MenuItem id="light" icon="sun" isCheckAtEnd>
              Use light theme
            </MenuItem>
            <MenuItem id="dark" icon="moon" isCheckAtEnd>
              Use dark theme
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    const menu = await openMenu();
    const row = (name: string) => {
      const found = [...menu.querySelectorAll('[role^="menuitem"]')].find((item) => item.textContent.includes(name));
      if (!(found instanceof HTMLElement)) throw new Error(`no ${name} row`);
      return found;
    };
    await expect(row('Use dark theme')).toHaveAttribute('role', 'menuitemradio');
    await expect(row('Use dark theme')).toHaveAttribute('aria-checked', 'true');
    await expect(row('Use light theme')).toHaveAttribute('aria-checked', 'false');
    await expect(row('Create a company')).toHaveAttribute('role', 'menuitem');
    await expect(menu.querySelectorAll('[role="group"]')[1]).toHaveAccessibleName('Theme');
    // No check column before the choice's items: their icons line up with the action's.
    const iconLeft = (name: string) => row(name).querySelector('svg')?.getBoundingClientRect().left;
    await expect(iconLeft('Use light theme')).toBe(iconLeft('Create a company'));
    // Choosing one is still an action.
    await userEvent.click(row('Use light theme'));
    await waitFor(() => expect(args.onAction).toHaveBeenCalledWith('light'));
  },
};

/** The right arrow opens the submenu, the left arrow closes it. */
export const Submenu: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <MenuTrigger>
        <Button icon="ellipsis" label="Column options" />
        <ColumnOptions />
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await openMenu();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Sort ascending'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect(document.activeElement).toHaveTextContent('Formatting');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Wrap text'));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1));
  },
};

const ATTRIBUTES = [
  { id: 'name', name: 'Name', icon: 'building' },
  { id: 'domains', name: 'Domains', icon: 'globe' },
  { id: 'categories', name: 'Categories', icon: 'tag' },
  { id: 'team', name: 'Team', icon: 'users' },
  { id: 'location', name: 'Primary location', icon: 'map-pin' },
  { id: 'phone', name: 'Phone', icon: 'phone' },
] as const;

/** Typing filters the items; the arrows still move through what is left. */
export const Searchable: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="plus">Add column</Button>
        <Menu label="Company attributes" search={{ label: 'Search attributes' }}>
          <MenuSection label="Company attributes">
            {ATTRIBUTES.map((attribute) => (
              <MenuItem key={attribute.id} id={attribute.id} icon={attribute.icon}>
                {attribute.name}
              </MenuItem>
            ))}
          </MenuSection>
        </Menu>
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ userEvent }) => {
    const menu = await openMenu();
    const field = await waitFor(() => {
      const input = document.querySelector('input[type="search"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('no search field');
      return input;
    });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('dom');
    await waitFor(() => expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(1));
    await userEvent.keyboard('zzz');
    await waitFor(() => expect(menu).toHaveTextContent('No matches'));
  },
};

/** A header row above the search, apart from it: typing never filters it. */
export const WithHeader: Story = {
  render: () => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="plus">Add column</Button>
        <Menu
          label="Company attributes"
          header={<StatusDot hue="blue">Companies</StatusDot>}
          search={{ label: 'Search attributes' }}
        >
          {ATTRIBUTES.map((attribute) => (
            <MenuItem key={attribute.id} id={attribute.id} icon={attribute.icon}>
              {attribute.name}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    </Stage>
  ),
  play: async ({ userEvent }) => {
    const menu = await openMenu();
    const popover = menu.closest('[data-trigger]') ?? document.body;
    await waitFor(() => expect(document.activeElement).toHaveAttribute('type', 'search'));
    await userEvent.keyboard('zzz');
    await waitFor(() => expect(menu).toHaveTextContent('No matches'));
    await expect(popover).toHaveTextContent('Companies');
  },
};

function StageChoice() {
  const [stage, setStage] = useState<ReadonlySet<string | number>>(new Set(['won']));
  return (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button iconRight="chevron-down">Stage</Button>
        <Menu label="Stage" selectionMode="single" selectedKeys={stage} onSelectionChange={setStage}>
          <MenuItem id="lead" leading={<StatusDot hue="gray">Lead</StatusDot>}>
            Lead
          </MenuItem>
          <MenuItem id="won" leading={<StatusDot hue="green">Won</StatusDot>}>
            Won
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            id="ada"
            leading={<Avatar name="Ada Lovelace" size="xs" isDecorative />}
            description="ada@example.com"
          >
            Ada Lovelace
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </Stage>
  );
}

/** Single choice with checks, people and statuses as leading pieces. */
export const Choices: Story = {
  render: () => <StageChoice />,
  play: async () => {
    const menu = await openMenu();
    await expect(menu.querySelector('[aria-checked="true"]')).toHaveTextContent('Won');
  },
};

/** 10,000 people from outside: only the rows on screen are drawn, and rows still loading are skeletons (AC-9). */
export const Async: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => {
    const loaded = new Map<number, { id: string; name: string }>();
    const source: ListSource<{ id: string; name: string }> = {
      count: 10_000,
      getItem: (index) =>
        index < 40
          ? (loaded.get(index) ?? { id: `p${String(index)}`, name: `Person ${String(index + 1)}` })
          : undefined,
      getKey: (person) => person.id,
    };
    return (
      <Stage>
        <MenuTrigger defaultOpen>
          <Button icon="users">Assign</Button>
          <Menu label="Members" source={source} renderItem={(person) => ({ children: person.name })} />
        </MenuTrigger>
      </Stage>
    );
  },
  play: async () => {
    const menu = await openMenu();
    await waitFor(() => expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(5));
    await expect(menu.querySelectorAll('[role="menuitem"]').length).toBeLessThan(100);
  },
};

/** ContextMenu: a right click opens the menu (the browser turns Shift F10 and the menu key into the same event); Esc puts focus back. */
export const Context: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <ContextMenu
        menu={
          <Menu label="Record actions">
            <MenuItem id="open" icon="external-link">
              Open record
            </MenuItem>
            <MenuItem id="copy" icon="copy" kbd="⌘C">
              Copy link
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon="trash" isDanger>
              Delete record
            </MenuItem>
          </Menu>
        }
      >
        <Button icon="building">Northwind Traders</Button>
      </ContextMenu>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const target = canvas.getByRole('button', { name: 'Northwind Traders' });
    await userEvent.pointer({ keys: '[MouseRight]', target });
    const menu = await openMenu();
    // Inside a trigger, React Aria names the menu after what opened it.
    await expect(menu).toHaveAccessibleName('Northwind Traders');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    await waitFor(() => expect(target).toHaveFocus());
  },
};

/** A pinned foot: "Create attribute" stays under a hairline at the menu's foot while the list scrolls behind it. */
export const PinnedCreate: Story = {
  render: () => (
    <Stage>
      <MenuTrigger defaultOpen>
        <Button icon="plus">Add column</Button>
        <Menu label="Company attributes" search={{ label: 'Search attributes' }}>
          <MenuSection label="Company attributes">
            {ATTRIBUTES.map((attribute) => (
              <MenuItem key={attribute.id} id={attribute.id} icon={attribute.icon}>
                {attribute.name}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection label="Create" isPinned>
            <MenuItem id="create" icon="plus">
              Create attribute
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
    </Stage>
  ),
  play: async () => {
    const menu = await openMenu();
    // Still a menu item, so the arrow keys reach it; it only sits pinned at the foot.
    const pinned = menu.querySelector('[data-pinned]');
    await expect(pinned).not.toBeNull();
    await expect(pinned).toHaveTextContent('Create attribute');
  },
};

/** The command palette's search (`size: 'lg'`): a bar's height and the title's size, with roomier rows. */
export const SearchLarge: Story = {
  render: () => (
    <Stage>
      <Menu label="Quick actions" isInline search={{ label: 'Search', size: 'lg' }}>
        {ATTRIBUTES.map((attribute) => (
          <MenuItem key={attribute.id} id={attribute.id} icon={attribute.icon}>
            {attribute.name}
          </MenuItem>
        ))}
      </Menu>
    </Stage>
  ),
  play: async () => {
    const field = await waitFor(() => {
      const input = document.querySelector('input[type="search"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('no search field');
      return input;
    });
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--size-bar').trim();
    const height = field.parentElement?.getBoundingClientRect().height ?? 0;
    await expect(`${String(Math.round(height))}px`).toBe(bar);
  },
};
