import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { InfoTip } from '../InfoTip/InfoTip.tsx';
import { Table, type TableColumn } from './Table.tsx';

interface Member {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly lastSeen: string;
  readonly seats: number;
}

const MEMBERS: readonly Member[] = [
  { id: 'm1', name: 'Ada Lovelace', role: 'Admin', lastSeen: '2026-10-08T13:10:00.000Z', seats: 1 },
  { id: 'm2', name: 'Grace Hopper', role: 'Member', lastSeen: '2026-10-07T09:00:00.000Z', seats: 1 },
  { id: 'm3', name: 'Alan Turing', role: 'Guest', lastSeen: '2026-09-20T16:45:00.000Z', seats: 0 },
];

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: 'Name', isRowHeader: true },
  { id: 'role', label: 'Role' },
  { id: 'lastSeen', label: 'Last seen' },
  { id: 'seats', label: 'Seats', align: 'end' },
  { id: 'actions', label: 'Actions', isLabelHidden: true, align: 'end' },
];

function cell(member: Member, column: string) {
  switch (column) {
    case 'name':
      return <RecordChip display={{ type: 'member', id: member.id, name: member.name }} isFlat />;
    case 'role':
      return member.role;
    case 'lastSeen':
      return <RelativeTime value={member.lastSeen} />;
    case 'seats':
      return <Badge count={member.seats} />;
    default:
      return <Button variant="ghost" icon="ellipsis" label={`Actions for ${member.name}`} />;
  }
}

const meta = {
  title: 'Molecules/Table',
  component: Table<Member>,
  args: {
    label: 'Members',
    columns: COLUMNS,
    rows: MEMBERS,
    getRowId: (member) => member.id,
    renderCell: cell,
    onRowAction: fn(),
  },
} satisfies Meta<typeof Table<Member>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Members, with a row header and an actions column. Enter opens a row. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
    await expect(canvas.getByRole('rowheader', { name: /Ada Lovelace/ })).toBeInTheDocument();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(args.onRowAction).toHaveBeenCalledWith('m1');
  },
};

/** A header with help beside it: an InfoTip that opens by press or keyboard. */
export const ColumnInfo: Story = {
  args: {
    columns: COLUMNS.map((column) =>
      column.id === 'role'
        ? { ...column, info: <InfoTip label="Role">What each person may do in the workspace.</InfoTip> }
        : column,
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'About Role' }));
    // The help opens in a popover, outside the story's canvas.
    await expect(await screen.findByRole('dialog', { name: 'About Role' })).toBeInTheDocument();
  },
};

/** No rows yet. */
export const Empty: Story = {
  args: {
    rows: [],
    emptyState: <EmptyState title="No members yet">Invite your team to share this workspace.</EmptyState>,
  },
};

/** Rows that move (objects in settings): a handle starts each row, and a drop or a keyboard move reorders them. */
export const Reorderable: Story = {
  args: {
    onReorder: fn(),
    getRowLabel: (member: Member) => member.name,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Move Ada Lovelace' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(6);
  },
};

/** Picked up by keyboard: a drop target takes focus, and its accent line shows where the row would land. */
export const KeyboardMove: Story = {
  args: {
    onReorder: fn(),
    getRowLabel: (member: Member) => member.name,
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const handle = canvas.getByRole('button', { name: 'Move Ada Lovelace' });
    handle.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{Escape}');
  },
};

/** The first rows still loading. */
export const Loading: Story = {
  args: { rows: [], isLoading: true },
};

/** Rows picked for a bulk action, with a sticky header: the header's checkbox picks every row. */
function SelectableMembers() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <Table
      label="Members"
      columns={COLUMNS}
      rows={MEMBERS}
      getRowId={(member) => member.id}
      renderCell={cell}
      selected={selected}
      onSelectedChange={setSelected}
      getSelectLabel={(member) => member.name}
      isHeaderSticky
    />
  );
}

/** A checkbox per row and one in the header, for a bulk action. */
export const Selectable: Story = {
  render: () => <SelectableMembers />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Ada Lovelace' }));
    await expect(canvas.getByRole('checkbox', { name: /Select all/i })).toBePartiallyChecked();
    await userEvent.click(canvas.getByRole('checkbox', { name: /Select all/i }));
    await expect(canvas.getByRole('checkbox', { name: 'Select Grace Hopper' })).toBeChecked();
  },
};

/** A phone's width: the columns keep their width and the table scrolls sideways in its own box. */
export const Scrollable: Story = {
  args: { isScrollable: true },
  render: (args) => (
    <Stage width="phone">
      <Table<Member> {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const table = canvas.getByRole('grid', { name: 'Members' });
    const box = table.parentElement;
    await expect(box).not.toBeNull();
    await expect(canvas.getByRole('columnheader', { name: 'Seats' })).toBeInTheDocument();
  },
};

const CALENDARS = [
  { id: 'c1', name: 'ada@acme.dev' },
  { id: 'c2', name: 'Team offsites, launches and the long running quarterly planning calendar' },
  { id: 'c3', name: 'Holidays in the United Kingdom' },
];

/**
 * Control columns (`size`, `showsOnHover`): the name fills and truncates, the two checkbox columns fit their
 * labels, and each row's options button shows on hover or focus (Settings › Calendars).
 */
export const ControlColumns: Story = {
  render: () => (
    <Stage width="phone">
      <Table<(typeof CALENDARS)[number]>
        label="Calendars"
        columns={[
          { id: 'name', label: 'Calendar', isRowHeader: true, size: 'fill' },
          { id: 'conflicts', label: 'Conflicts', size: 'fit' },
          { id: 'week', label: 'Show on my week', size: 'fit' },
          { id: 'more', label: 'Options', isLabelHidden: true, size: 'fit', align: 'end', showsOnHover: true },
        ]}
        rows={CALENDARS}
        getRowId={(row) => row.id}
        renderCell={(row, column) => {
          if (column === 'name') return <TruncatedText>{row.name}</TruncatedText>;
          if (column === 'more') return <Button variant="ghost" icon="ellipsis" label={`${row.name} options`} />;
          return <Checkbox label={`${column === 'week' ? 'Show' : 'Check'} ${row.name}`} isLabelHidden />;
        }}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: 'Calendars' });
    // The long name truncates inside the slot rather than widening the table past it.
    await expect(grid.getBoundingClientRect().width).toBeLessThanOrEqual(
      (grid.parentElement?.parentElement?.getBoundingClientRect().width ?? 0) + 1,
    );
  },
};
