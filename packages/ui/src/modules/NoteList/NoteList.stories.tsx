import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource, type ListRange, type ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { ADA, GRACE } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NoteList, type NoteListItem } from './NoteList.tsx';

/** A record's notes, last edited first. */
function sampleNotes(): readonly NoteListItem[] {
  return [
    {
      id: 'n1',
      title: 'Renewal call',
      excerpt:
        'Met Ada at the Portland office to walk through the renewal. They want the API limits raised before signing, and a second workspace for the EU team, which legal still has to look at.',
      author: ADA,
      updatedAt: '2026-10-08T11:30:00.000Z',
    },
    {
      id: 'n2',
      title: 'Security review',
      excerpt: 'Questionnaire sent. Grace owns the follow up.',
      author: GRACE,
      updatedAt: '2026-10-07T09:00:00.000Z',
    },
    {
      id: 'n3',
      title: '',
      excerpt: 'Pricing thoughts for the board pack.',
      author: ADA,
      updatedAt: '2026-10-01T16:45:00.000Z',
    },
  ];
}

/** 2,000 notes made from their index, every fifth still loading. */
function longSource(onRangeChange: (range: ListRange) => void): ListSource<NoteListItem> {
  return {
    count: 2000,
    getItem: (index) =>
      index % 5 === 4
        ? undefined
        : {
            id: `long-${String(index)}`,
            title: `Note ${String(index + 1)}`,
            excerpt: 'Notes from the weekly call.',
            author: index % 2 === 0 ? ADA : GRACE,
            updatedAt: '2026-10-08T10:00:00.000Z',
          },
    getKey: (note) => note.id,
    onRangeChange,
  };
}

interface SampleProps {
  readonly onAction?: (id: string) => void;
  readonly onRetry?: () => void;
  readonly onRangeChange?: (range: ListRange) => void;
  readonly status?: LoadStatus;
  readonly isEmpty?: boolean;
  readonly isLong?: boolean;
  readonly emptyTitle?: string;
  readonly withToolbar?: boolean;
  readonly withEmptyAction?: boolean;
}

/** The list in a fixed height slot, as the Notes tab holds it. */
function SampleNotes({
  onAction = () => undefined,
  onRetry,
  onRangeChange,
  status,
  isEmpty = false,
  isLong = false,
  emptyTitle,
  withToolbar = false,
  withEmptyAction = false,
}: SampleProps) {
  const notes = isLong
    ? longSource(onRangeChange ?? (() => undefined))
    : arraySource(isEmpty ? [] : sampleNotes(), (note) => note.id);
  return (
    <Stage height="grid">
      <NoteList
        label="Notes"
        notes={notes}
        onAction={onAction}
        {...(status === undefined ? {} : { status })}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(emptyTitle === undefined ? {} : { emptyTitle })}
        {...(withToolbar ? { toolbar: <Button variant="primary">New note</Button> } : {})}
        {...(withEmptyAction ? { emptyActions: <Button variant="primary">New note</Button> } : {})}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/NoteList',
  component: SampleNotes,
} satisfies Meta<typeof SampleNotes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Notes with their title, a two line excerpt, the author and when they were last edited; an untitled one says so. */
export const Default: Story = {
  args: { onAction: fn() },
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('grid', { name: 'Notes' })).toBeInTheDocument();
    await expect(canvas.getByText('Untitled note')).toBeInTheDocument();
    await expect(canvas.getAllByText('Edited', { exact: false })).toHaveLength(3);
    await userEvent.click(canvas.getByText('Security review'));
    await expect(args.onAction).toHaveBeenCalledWith('n2');
  },
};

/** By keyboard: the arrows move between rows and Enter opens one. */
export const Keyboard: Story = {
  args: { onAction: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await waitFor(() => expect(canvas.getAllByRole('row')[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(canvas.getAllByRole('row')[1]).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith('n2');
  },
};

/** "New note" above the list, in every state. */
export const WithToolbar: Story = {
  args: { withToolbar: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'New note' })).toBeInTheDocument();
  },
};

/** 2,000 notes draw only the rows on screen, with skeletons for those still loading. */
export const RowsStillLoading: Story = {
  args: { isLong: true, onRangeChange: fn() },
  play: async ({ args, canvas }) => {
    await waitFor(() => expect(args.onRangeChange).toHaveBeenCalled());
    await expect(canvas.getAllByRole('row').length).toBeLessThan(40);
  },
};

/** The notes are still coming: skeleton rows after the loading delay. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading notes')).toBeInTheDocument();
  },
};

/** No notes yet, in the screen's words, with New note above. */
export const Empty: Story = {
  args: { isEmpty: true, emptyTitle: 'No notes yet. Write the first one.', withToolbar: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No notes yet. Write the first one.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'New note' })).toBeInTheDocument();
  },
};

/** Empty, with the way to start inside the empty state (a record's Notes tab): one New note, under the words. */
export const EmptyWithAction: Story = {
  args: { isEmpty: true, emptyTitle: 'No notes yet', withEmptyAction: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No notes yet')).toBeInTheDocument();
    await expect(canvas.getAllByRole('button', { name: 'New note' })).toHaveLength(1);
  },
};

/** The notes failed to load. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The viewer may not see these notes. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see these notes')).toBeInTheDocument();
  },
};
