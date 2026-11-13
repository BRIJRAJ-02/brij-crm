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

/** Weekdays open: a week of seven lettered days, Monday first, the first open one picked, the weekend quiet. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    const days = [...canvasElement.querySelectorAll('[data-day]')];
    await expect(days.map((day) => day.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    await expect(days.map((day) => day.getAttribute('data-day'))).toEqual([
      'picked',
      'open',
      'open',
      'open',
      'open',
      'closed',
      'closed',
    ]);
  },
};

/** Every day open. */
export const EveryDay: Story = {
  args: { openDays: [true, true, true, true, true, true, true], hue: 'green', lengths: '15, 30 or 60 min' },
};

/** A weekends page: its first open day, Saturday, is the one picked. */
export const Weekends: Story = {
  args: { openDays: [false, false, false, false, false, true, true], hue: 'yellow' },
  play: async ({ canvasElement }) => {
    const days = [...canvasElement.querySelectorAll('[data-day]')];
    await expect(days[5]).toHaveAttribute('data-day', 'picked');
    await expect(days[6]).toHaveAttribute('data-day', 'open');
  },
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
