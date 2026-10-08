import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Badge } from './Badge.tsx';

const meta = {
  title: 'Atoms/Badge',
  component: Badge,
  args: { count: 12 },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A count beside a label. */
export const Default: Story = {};

/** Neutral and accent, and a count over the limit. */
export const Tones: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Badge count={4} />
      <Badge count={3} tone="accent" label="unread" />
      <Badge count={240} />
      <Badge count={1280} max={9999} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('99+')).toBeInTheDocument();
    await expect(canvas.getByText('1,280')).toBeInTheDocument();
    await expect(canvas.getByText('unread')).toBeInTheDocument();
  },
};

/** A capped count (a filtered view past 10,000), and short labels (a grid row's notes). */
export const AtLeastAndLabel: Story = {
  render: () => (
    <Stage>
      <Badge count={10_000} max={Infinity} isAtLeast label="people" />
      <Badge text="New" />
      <Badge text="Doesn’t match this view" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('10,000+')).toBeInTheDocument();
    await expect(canvas.getByText('New')).toBeInTheDocument();
    await expect(canvas.getByText('Doesn’t match this view')).toBeInTheDocument();
  },
};
