import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SuccessCheck } from './SuccessCheck.tsx';

const meta = {
  title: 'Atoms/SuccessCheck',
  component: SuccessCheck,
} satisfies Meta<typeof SuccessCheck>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beside words that say it: decoration. */
export const Small: Story = {};

/** Leading a confirmation, named for screen readers. */
export const Large: Story = {
  parameters: { crm: { preview: true } },
  args: { size: 'lg', label: 'Published' },
  render: (args) => (
    <Stage>
      <SuccessCheck {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Published' })).toBeInTheDocument();
  },
};
