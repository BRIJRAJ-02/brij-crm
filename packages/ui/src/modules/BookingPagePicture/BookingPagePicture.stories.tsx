import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingPagePicture } from './BookingPagePicture.tsx';

const WEEKDAYS = [true, true, true, true, true, false, false];

const meta = {
  title: 'Modules/BookingPagePicture',
  component: BookingPagePicture,
  args: { title: 'Intro call', lengths: '30 min', openDays: WEEKDAYS, hue: 'blue' },
  render: (args) => (
    <Stage width="narrow">
      <BookingPagePicture {...args} />
    </Stage>
  ),
} satisfies Meta<typeof BookingPagePicture>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Weekdays open: five tinted columns, the weekend faint, one day picked. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-day="picked"]')).toHaveLength(1);
    await expect(canvasElement.querySelectorAll('[data-day="closed"]').length).toBeGreaterThan(0);
  },
};

/** Every day open. */
export const EveryDay: Story = {
  args: { openDays: [true, true, true, true, true, true, true], hue: 'green', lengths: '15, 30 or 60 min' },
};

/** No hours at all: every day faint, nothing picked. */
export const NoHours: Story = {
  args: { openDays: [false, false, false, false, false, false, false], hue: 'orange' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-day="picked"]')).toBeNull();
  },
};

/** A long title: one line, cut. */
export const LongTitle: Story = {
  args: { title: 'Quarterly business review with the whole account team and their leads', hue: 'purple' },
};
