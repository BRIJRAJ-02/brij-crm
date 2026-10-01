import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Separator } from './Separator.tsx';

const meta = {
  title: 'Atoms/Separator',
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Across a column of content, and down between two toolbar groups. */
export const Default: Story = {
  render: () => (
    <Stage direction="column">
      <span>Above</span>
      <Separator />
      <span>Below</span>
      <Stage>
        <span>Left</span>
        <Separator orientation="vertical" />
        <span>Right</span>
      </Stage>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('separator')).toHaveLength(2);
  },
};
