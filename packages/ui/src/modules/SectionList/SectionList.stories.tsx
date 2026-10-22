import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkList, type LinkRow } from '../LinkList/LinkList.tsx';
import { SectionList, type SectionListSection } from './SectionList.tsx';

/** One section of a profile, as the story holds it. */
interface Group {
  readonly id: string;
  readonly title?: string;
  readonly rows: readonly LinkRow[];
}

function page(id: string, title: string, chips: readonly string[], isPaused = false): LinkRow {
  return { id, title, address: '', chips, ...(isPaused ? { badge: 'Paused' } : {}) };
}

/** A profile's pages under three sections, the last one for the pages with none. */
function groups(): Group[] {
  return [
    {
      id: 'sales',
      title: 'Sales',
      rows: [page('intro', 'Intro call', ['30 min']), page('demo', 'Product demo', ['45 min', '60 min'])],
    },
    { id: 'support', title: 'Support', rows: [page('help', 'Help session', ['15 min'], true)] },
    { id: 'none', title: 'No section', rows: [page('coffee', 'Coffee chat', ['20 min'])] },
  ];
}

/** The list with the item at `from` taken to `to`. */
function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

/** A section's menu: Move up and Move down, only the moves there is room for. */
function sectionMenu(title: string, at: number, count: number, move: (to: number) => void) {
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={`${title} options`} />
      <Menu
        label={`${title} options`}
        onAction={(key) => {
          move(key === 'up' ? at - 1 : at + 1);
        }}
      >
        {at > 0 && (
          <MenuItem id="up" icon="arrow-up">
            Move up
          </MenuItem>
        )}
        {at < count - 1 && (
          <MenuItem id="down" icon="arrow-down">
            Move down
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

/** A profile's sections that move as the person moves them, each holding its rows, which move within it. */
function Profile({
  onMove,
  start = groups(),
  isReadOnly = false,
}: {
  readonly onMove: (id: string, toIndex: number) => void;
  readonly start?: readonly Group[];
  readonly isReadOnly?: boolean;
}) {
  const [shown, setShown] = useState(start);
  const moveSection = (id: string, to: number) => {
    onMove(id, to);
    setShown((was) =>
      moved(
        was,
        was.findIndex((group) => group.id === id),
        to,
      ),
    );
  };
  const moveRow = (groupId: string) => (id: string, to: number) => {
    onMove(id, to);
    setShown((was) =>
      was.map((group) =>
        group.id === groupId
          ? {
              ...group,
              rows: moved(
                group.rows,
                group.rows.findIndex((row) => row.id === id),
                to,
              ),
            }
          : group,
      ),
    );
  };
  const sections: SectionListSection[] = shown.map((group, at) => ({
    id: group.id,
    ...(group.title === undefined ? {} : { title: group.title }),
    ...(isReadOnly || shown.length < 2 || group.title === undefined
      ? {}
      : { actions: sectionMenu(group.title, at, shown.length, (to) => moveSection(group.id, to)) }),
    content: (
      <LinkList
        label={group.title === undefined ? 'Your pages' : `Pages under ${group.title}`}
        searchLabel="Search pages"
        density="compact"
        placement="card"
        isToolbarHidden
        rows={group.rows}
        onOpen={() => undefined}
        {...(isReadOnly ? {} : { onMove: moveRow(group.id) })}
      />
    ),
  }));
  return (
    <SectionList
      label="Sections on your profile"
      sections={sections}
      {...(isReadOnly ? {} : { onMove: moveSection })}
    />
  );
}

const meta = {
  title: 'Modules/SectionList',
  component: SectionList,
  args: { label: 'Sections on your profile', sections: [], onMove: fn() },
} satisfies Meta<typeof SectionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A profile's sections (Settings › Profile's order): each a Card with its grip and menu, its pages moving within
 * it by their own grips. Drag a section's grip to move it whole.
 */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <Profile onMove={args.onMove ?? (() => undefined)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Sections on your profile' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Sales',
      'Support',
      'No section',
    ]);
    await expect(canvas.getByRole('button', { name: 'Move the Support section' })).toBeInTheDocument();
    // The rows' grips load with the drag wrapper, on demand.
    await expect(await canvas.findByRole('button', { name: 'Move Intro call' })).toBeInTheDocument();
  },
};

/** By keyboard: Enter on a section's grip lifts it, an arrow moves it, Enter drops it, and each step is said. */
export const KeyboardMove: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Profile onMove={args.onMove ?? (() => undefined)} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const grip = canvas.getByRole('button', { name: 'Move the Sales section' });
    grip.focus();
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the rows' own arrow keys.
    await waitFor(() => expect(grip).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    // The drag wrapper's live region sits at the end of the page, outside the story's canvas.
    await waitFor(() =>
      expect(within(document.body).getByText('Sales, moved to position 2 of 3.')).toBeInTheDocument(),
    );
    await expect(args.onMove).toHaveBeenCalledWith('sales', 1);
    await waitFor(() => expect(canvas.getAllByRole('heading')[1]).toHaveTextContent('Sales'));
    // Focus is back on the grip, wherever the section landed.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Move the Sales section' })).toHaveFocus());
  },
};

/** A page moves within its section by its own grip, while the sections hold still. */
export const RowMove: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Profile onMove={args.onMove ?? (() => undefined)} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const grip = await canvas.findByRole('button', { name: 'Move Intro call' });
    grip.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(grip).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(document.body).getByText('Intro call, moved to position 2 of 2.')).toBeInTheDocument(),
    );
    await expect(args.onMove).toHaveBeenCalledWith('intro', 1);
    await expect(args.onMove).not.toHaveBeenCalledWith('sales', expect.anything());
    const sales = within(canvas.getByRole('grid', { name: 'Pages under Sales' }));
    await waitFor(() => expect(sales.getAllByRole('row')[1]).toHaveTextContent('Intro call'));
  },
};

/** The section's menu moves it too, for a pointer that can't drag. */
export const MenuMove: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Profile onMove={args.onMove ?? (() => undefined)} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'No section options' }));
    const menu = await within(document.body).findByRole('menu', { name: 'No section options' });
    await expect(within(menu).queryByRole('menuitem', { name: 'Move down' })).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
    await expect(args.onMove).toHaveBeenCalledWith('none', 1);
    await waitFor(() => expect(canvas.getAllByRole('heading')[1]).toHaveTextContent('No section'));
  },
};

/** One section with no title (every page without one): a plain Card, with no grip of its own. */
export const OneSection: Story = {
  render: (args) => (
    <Stage width="fill">
      <Profile
        onMove={args.onMove ?? (() => undefined)}
        start={[
          {
            id: 'none',
            rows: [page('intro', 'Intro call', ['30 min']), page('coffee', 'Coffee chat', ['20 min'])],
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('heading')).toBeNull();
    await expect(canvas.queryByRole('button', { name: /section/ })).toBeNull();
    await expect(await canvas.findByRole('button', { name: 'Move Coffee chat' })).toBeInTheDocument();
  },
};

/** Read only (no `onMove`, and none on the rows): no grips and no menus. */
export const ReadOnly: Story = {
  render: (args) => (
    <Stage width="fill">
      <Profile onMove={args.onMove ?? (() => undefined)} isReadOnly />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('heading')).toHaveLength(3);
    await expect(canvas.queryByRole('button', { name: /^Move/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /options$/ })).toBeNull();
  },
};

/** On a phone: the cards keep their headers, and each row takes a second line for its facts. */
export const Narrow: Story = {
  render: (args) => (
    <Stage width="narrow-fill">
      <Profile onMove={args.onMove ?? (() => undefined)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Move Product demo' })).toBeVisible();
    await expect(canvas.getByText('45 min · 60 min')).toBeVisible();
  },
};

/** No sections at all: the caller's empty state. */
export const Empty: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    emptyState: <EmptyState title="No pages on your profile yet">Public booking pages show here.</EmptyState>,
  },
  render: (args) => (
    <Stage width="fill">
      <SectionList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No pages on your profile yet')).toBeInTheDocument();
    await expect(canvas.queryByRole('list')).toBeNull();
  },
};
