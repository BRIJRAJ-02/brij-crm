import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource } from '../../lib/list-source.ts';
import { Card } from '../../molecules/Card/Card.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RelatedRecords, type RelatedRecordsHandle } from './RelatedRecords.tsx';

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Edsger Dijkstra', 'Barbara Liskov'];
const HUES = ['orange', 'purple', 'blue', 'green', 'red', 'sky'] as const;

const person = (index: number): RecordRefDisplay => ({
  objectId: 'people',
  recordId: `p${String(index)}`,
  name: NAMES[index % NAMES.length] ?? 'Ada Lovelace',
  kind: 'person',
  hue: HUES[index % HUES.length] ?? 'blue',
});

/** The first `count` people, each opening their page. */
const records = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ display: person(index), href: `/records/p${String(index)}` }));

const CANDIDATES: readonly RecordRefDisplay[] = [
  { objectId: 'people', recordId: 'p20', name: 'Margaret Hamilton', kind: 'person', hue: 'green' },
  { objectId: 'people', recordId: 'p21', name: 'Linus Torvalds', kind: 'person', hue: 'blue' },
  { objectId: 'people', recordId: 'p0', name: 'Ada Lovelace', kind: 'person', hue: 'orange' },
];

const meta = {
  title: 'Modules/RelatedRecords',
  component: RelatedRecords,
  args: {
    title: 'Team',
    noun: 'people',
    records: records(5),
    total: 12,
    hasMore: true,
    onShowMore: fn(),
    onRemove: fn(),
    onRetry: fn(),
    picker: {
      onSearch: () => arraySource(CANDIDATES, (display) => display.recordId),
      describeResult: (display) =>
        display.recordId === 'p0'
          ? { isLinked: true }
          : display.recordId === 'p21'
            ? { note: 'At Contoso' }
            : undefined,
      onPick: fn(),
    },
  },
  render: (args) => (
    <Stage width="narrow-fill">
      <RelatedRecords {...args} />
    </Stage>
  ),
} satisfies Meta<typeof RelatedRecords>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A company's Team in the record page's sidebar: its total, five rows held, Show more, Add, and a Remove per row. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('heading', { name: /Team/ })).toBeInTheDocument();
    await expect(canvas.getByText('12')).toBeInTheDocument();
    const list = canvas.getByRole('list', { name: 'Team' });
    await expect(list.querySelectorAll('li')).toHaveLength(5);
    await expect(canvas.getByRole('link', { name: /Ada Lovelace/ })).toHaveAttribute('href', '/records/p0');
    await userEvent.click(canvas.getByRole('button', { name: 'Show more' }));
    await expect(args.onShowMore).toHaveBeenCalledOnce();
  },
};

/** Remove on a row hands the screen that record; the screen asks first, then the row leaves. */
export const Remove: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Grace Hopper from Team' }));
    await expect(args.onRemove).toHaveBeenCalledWith(expect.objectContaining({ display: person(1) }));
  },
};

/** Add opens the record search: a linked one shows its check, one held elsewhere its note; a pick links it. */
export const Add: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add to Team' }));
    const menu = within(document.body).getByRole('menu');
    await expect(within(menu).getByText('At Contoso')).toBeInTheDocument();
    await userEvent.click(within(menu).getByText('Margaret Hamilton'));
    await waitFor(() => expect(args.picker?.onPick).toHaveBeenCalledWith(CANDIDATES[0]));
  },
};

/** Picking a record linked already changes nothing. */
export const AddLinkedAlready: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add to Team' }));
    const menu = within(document.body).getByRole('menu');
    await userEvent.click(within(menu).getByText('Ada Lovelace'));
    await expect(args.picker?.onPick).not.toHaveBeenCalled();
  },
};

/** Every row held: no Show more. */
export const AllShown: Story = {
  args: { records: records(3), total: 3, hasMore: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Show more' })).toBeNull();
  },
};

/** Show more on its way. */
export const LoadingMore: Story = {
  args: { isLoadingMore: true },
};

/** Show more failed: the rows stay, and pressing it again tries again. */
export const MoreFailed: Story = {
  args: { isMoreFailed: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('More didn’t load. Try again.')).toBeInTheDocument();
  },
};

/** A side the member may only read: no Add, no Remove. */
export const ReadOnly: Story = {
  args: { picker: undefined, onRemove: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /Remove/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Add to Team' })).toBeNull();
  },
};

/** Nothing linked yet: one quiet row with Add. */
export const Empty: Story = {
  args: { records: [], total: 0, hasMore: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No people yet')).toBeInTheDocument();
    // One Add, in the empty row: the heading leaves its own out while the side is empty.
    await expect(canvas.getAllByRole('button', { name: 'Add to Team' })).toHaveLength(1);
  },
};

/** Loading: three skeleton rows, and no total yet. */
export const Loading: Story = {
  args: { status: 'loading', records: [], total: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading related records')).toBeInTheDocument();
  },
};

/** The read failed: Try again. */
export const Error: Story = {
  args: { status: 'error', records: [], total: undefined },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** A side the member can't see the records of. */
export const NoAccess: Story = {
  args: { status: 'no-access', records: [], total: undefined },
};

/** A hub: the total in full, however large. */
export const LargeTotal: Story = {
  args: { total: 150_000 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('150,000')).toBeInTheDocument();
  },
};

/** A side the member may only read, with why: a lock after the heading. */
export const ReadOnlyWithReason: Story = {
  args: { picker: undefined, onRemove: undefined, readOnlyReason: 'You can view People but not change them.' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /Remove/ })).toBeNull();
  },
};

/** Removing a row (the screen's confirm done): focus moves to the row now in its place, not the page. */
export const RemoveMovesFocus: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [held, setHeld] = useState(records(3));
    return (
      <Stage width="narrow-fill">
        <RelatedRecords
          {...args}
          records={held}
          total={held.length}
          hasMore={false}
          onRemove={(record) => {
            // As a confirm closing over it: focus falls to the page, then the row leaves.
            (document.activeElement as HTMLElement | null)?.blur();
            setHeld((rows) => rows.filter((row) => row.display.recordId !== record.display.recordId));
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Grace Hopper from Team' }));
    await waitFor(() => expect(canvas.getByRole('link', { name: /Alan Turing/ })).toHaveFocus());
  },
};

/** Folded by the person: the screen's View all (`focus`) opens it and focuses its heading. */
export const FocusOpensFolded: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const handle = useRef<RelatedRecordsHandle>(null);
    return (
      <Stage width="narrow-fill" direction="column">
        <Button
          onPress={() => {
            handle.current?.focus();
          }}
        >
          View all
        </Button>
        <RelatedRecords {...args} ref={handle} />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const heading = canvas.getByRole('button', { name: /^Team/, expanded: true });
    await userEvent.click(heading);
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(canvas.getByRole('button', { name: 'View all' }));
    await waitFor(() => expect(heading).toHaveFocus());
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
  },
};

/** The short form, on Overview: the first five in a Card, which holds View all with the total. */
export const ShortForm: Story = {
  args: { records: records(6), total: 12, limit: 5 },
  render: (args) => (
    <Stage width="fill">
      <Card
        title="Team"
        isBusy={args.status === 'loading'}
        actions={
          <Button variant="ghost" label="View all 12 people in Team">
            View all 12
          </Button>
        }
      >
        <RelatedRecords {...args} />
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Team' }).querySelectorAll('li')).toHaveLength(5);
    await expect(canvas.queryByRole('button', { name: /Remove/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Add to Team' })).toBeNull();
  },
};

/** The short form with nothing linked yet. */
export const ShortFormEmpty: Story = {
  args: { records: [], total: 0, limit: 5 },
  render: ShortForm.render,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No people yet')).toBeInTheDocument();
  },
};

/** The short form loading: its own skeleton rows, the Card marked busy. */
export const ShortFormLoading: Story = {
  args: { records: [], total: undefined, limit: 5, status: 'loading' },
  render: ShortForm.render,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading related records')).toBeInTheDocument();
  },
};

/** The short form failed: Try again, in the card. */
export const ShortFormError: Story = {
  args: { records: [], total: undefined, limit: 5, status: 'error' },
  render: ShortForm.render,
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
