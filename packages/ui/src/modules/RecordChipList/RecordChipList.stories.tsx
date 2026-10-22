import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RecordChipList } from './RecordChipList.tsx';

const meta = {
  title: 'Modules/RecordChipList',
  component: RecordChipList,
  args: {
    label: 'Recently viewed',
    emptyTitle: 'Nothing viewed yet',
    emptyText: 'Records you open show here.',
    onRetry: fn(),
    records: [
      {
        display: { objectId: 'companies', recordId: 'c1', name: 'Northwind Traders', kind: 'company', hue: 'blue' },
        href: '/records/c1',
      },
      {
        display: { objectId: 'people', recordId: 'p1', name: 'Ada Lovelace', kind: 'person', hue: 'orange' },
        href: '/records/p1',
      },
      {
        display: { objectId: 'deals', recordId: 'd1', name: 'Renewal for the year ahead', kind: 'other', hue: 'green' },
        href: '/records/d1',
      },
      {
        display: { objectId: 'people', recordId: 'p2', name: 'Grace Hopper', kind: 'person', hue: 'purple' },
        href: '/records/p2',
      },
      {
        display: { objectId: 'companies', recordId: 'c2', name: 'Contoso', kind: 'company', hue: 'red' },
        href: '/records/c2',
      },
    ],
  },
  render: (args) => (
    <Stage width="narrow-fill">
      <RecordChipList {...args} />
    </Stage>
  ),
} satisfies Meta<typeof RecordChipList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five records, wrapping, each a link to its record. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Recently viewed' });
    await expect(list.querySelectorAll('li')).toHaveLength(5);
    await expect(canvas.getByRole('link', { name: /Northwind Traders/ })).toHaveAttribute('href', '/records/c1');
  },
};

/** Loading: two skeleton lines. */
export const Loading: Story = {
  args: { status: 'loading', records: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading records')).toBeInTheDocument();
  },
};

/** Nothing yet: one quiet row. */
export const Empty: Story = {
  args: { records: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing viewed yet')).toBeInTheDocument();
  },
};

/** The read failed: Try again. */
export const Error: Story = {
  args: { status: 'error', records: [] },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The reader may not see these records: a locked row. */
export const NoAccess: Story = {
  args: { status: 'no-access', records: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see these records')).toBeInTheDocument();
  },
};
