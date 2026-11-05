// Spec 0068's stageshow demos (AC-6807), kept as stories: each loop, and its poster (the beat that tells the story
// on its own). The loops play in Storybook; the tests hold each on its poster, since a paused animation proves
// nothing about timing.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookDemo, PublishDemo, SheetDemo } from './MotionDemos.tsx';

const meta = {
  title: 'Modules/MotionDemos',
  component: BookDemo,
  render: (args) => (
    <Stage>
      <BookDemo {...args} />
    </Stage>
  ),
} satisfies Meta<typeof BookDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** (a) A guest picks a time and sees the booking confirmed: the loop. */
export const BookLoop: Story = { parameters: { crm: { screenshot: false } } };

/** (a) Its poster: the booking confirmed, the check drawn, Booked on the button. */
export const BookPoster: Story = {
  args: { beat: 4 },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByText('You’re booked')).toBeVisible();
  },
};

/** (b) An item sheet opens, a size is picked, the price pops: the loop. */
export const SheetLoop: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <SheetDemo {...args} />
    </Stage>
  ),
};

/** (b) Its poster: the sheet open on Large, the price at €4.80. */
export const SheetPoster: Story = {
  args: { beat: 4 },
  render: (args) => (
    <Stage>
      <SheetDemo {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByRole('radio', { name: 'Large' })).toBeChecked();
  },
};

/** (c) Publish turns into Published and the guest view updates: the loop. */
export const PublishLoop: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <PublishDemo {...args} />
    </Stage>
  ),
};

/** (c) Its poster: Published, and the guest's view on the new length. */
export const PublishPoster: Story = {
  args: { beat: 2 },
  render: (args) => (
    <Stage>
      <PublishDemo {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByText('Published')).toBeVisible();
  },
};
