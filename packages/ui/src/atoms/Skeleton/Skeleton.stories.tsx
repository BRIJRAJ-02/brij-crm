import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Skeleton } from './Skeleton.tsx';

const meta = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One line of text loading. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Skeleton {...args} />
    </Stage>
  ),
};

/** A row the way a list loads: an avatar, a name and a few lines. */
export const Shapes: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column" width="narrow">
      <Skeleton shape="circle" />
      <Skeleton width="medium" />
      <Skeleton lines={3} />
      <Skeleton shape="block" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    for (const skeleton of canvasElement.querySelectorAll('[data-shape]')) {
      await expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  },
};
