import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
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

/** No rows yet. */
export const Empty: Story = {
  args: {
    rows: [],
    emptyState: <EmptyState title="No members yet">Invite your team to share this workspace.</EmptyState>,
  },
};

/** The first rows still loading. */
export const Loading: Story = {
  args: { rows: [], isLoading: true },
};
