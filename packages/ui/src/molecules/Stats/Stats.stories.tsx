import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Stats } from './Stats.tsx';

const meta = {
  title: 'Molecules/Stats',
  component: Stats,
  args: {
    label: 'This week',
    items: [
      { id: 'meetings', label: 'Meetings booked', value: '12', comparison: '8 last week', trend: 'up' },
      { id: 'people', label: 'New people', value: '34', comparison: '41 last week', trend: 'down' },
      { id: 'deals', label: 'New deals', value: '5', comparison: '5 last week', trend: 'same' },
      { id: 'won', label: 'Deals won', value: '$4,200', comparison: '$0 last week', trend: 'up' },
      { id: 'submissions', label: 'Form submissions', value: '0', comparison: '3 last week', trend: 'down' },
    ],
  },
} satisfies Meta<typeof Stats>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five figures against last week. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <Stats {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'This week' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('term')).toHaveLength(5);
    // Two figures rose: meetings booked and deals won.
    await expect(canvas.getAllByText(/Up from/)).toHaveLength(2);
  },
};

/** On a phone: the figures wrap. */
export const Narrow: Story = {
  render: (args) => (
    <Stage width="phone">
      <Stats {...args} />
    </Stage>
  ),
};

/** No figures: nothing at all, so the screen leaves its card out. */
export const Empty: Story = {
  args: { items: [] },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Stats {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('group')).toBeNull();
  },
};

/** Loading: a skeleton per figure. */
export const Loading: Story = {
  args: { isLoading: true, items: [] },
  render: (args) => (
    <Stage width="fill">
      <Stats {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'This week' })).toHaveAttribute('aria-busy', 'true');
  },
};
