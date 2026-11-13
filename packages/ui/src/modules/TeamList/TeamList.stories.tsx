import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TeamList } from './TeamList.tsx';

const meta = {
  title: 'Modules/TeamList',
  component: TeamList,
  args: {
    label: 'Team today',
    rows: [
      {
        id: '0193a1b2-0000-7000-8000-000000000001',
        name: 'Ada Lovelace',
        presence: 'busy',
        status: 'In a meeting',
        detail: 'Until 3:30 PM · Next: Pipeline review, 4:00 PM',
      },
      {
        id: '0193a1b2-0000-7000-8000-000000000002',
        name: 'Grace Hopper',
        presence: 'free',
        status: 'Free now',
        detail: 'Next: Busy, 5:00 PM',
      },
      {
        id: '0193a1b2-0000-7000-8000-000000000003',
        name: 'Linus Pauling',
        presence: 'clear',
        status: 'Free',
        detail: 'Nothing else today',
      },
    ],
  },
} satisfies Meta<typeof TeamList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three members: one in a meeting, one free with a meeting later, one clear. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow-fill">
      <TeamList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Team today' });
    await expect(list.querySelectorAll('li')).toHaveLength(3);
    await expect(canvas.getByText('Free now')).toBeInTheDocument();
  },
};

/**
 * On a narrow card (spec 0072): rows with a hairline between them and no wash, since nothing opens; a long detail
 * wraps under the status rather than pushing the row wide, and every row keeps its name and its status in words.
 */
export const NarrowCard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <TeamList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const rows = canvas.getAllByRole('listitem');
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveTextContent('In a meeting');
    await expect(canvas.getByText('Until 3:30 PM · Next: Pipeline review, 4:00 PM')).toBeVisible();
  },
};

/** No rows: nothing at all. */
export const Empty: Story = {
  args: { rows: [] },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow-fill">
      <TeamList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('list')).toBeNull();
  },
};

/** Loading: three skeleton rows. */
export const Loading: Story = {
  args: { isLoading: true, rows: [] },
  render: (args) => (
    <Stage width="narrow-fill">
      <TeamList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Team today' })).toHaveAttribute('aria-busy', 'true');
  },
};
