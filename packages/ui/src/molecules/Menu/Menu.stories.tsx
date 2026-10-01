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
      <MenuItem id="asc" icon="chevron-up">
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
