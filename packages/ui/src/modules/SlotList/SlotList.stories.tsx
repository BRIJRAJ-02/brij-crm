import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SlotList, type Slot } from './SlotList.tsx';

/** Half hours from 9 AM, as a page would give them. */
function slots(count: number, marks: Partial<Record<number, Partial<Slot>>> = {}): readonly Slot[] {
  return Array.from({ length: count }, (_, index) => {
    const hour = 9 + Math.floor(index / 2);
    const minute = index % 2 === 0 ? '00' : '30';
    const label = `${String(hour > 12 ? hour - 12 : hour)}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
    return {
      id: `2026-10-08T${String(hour).padStart(2, '0')}:${minute}`,
      label,
      name: `${label}, Thu Oct 8, 30 minutes`,
      ...marks[index],
    };
  });
}

const meta = {
  title: 'Modules/SlotList',
  component: SlotList,
  args: {
    heading: 'Thu Oct 8',
    slots: slots(8),
    value: undefined,
    onChange: fn(),
    onConfirm: fn(),
    hour12: true,
    onHour12Change: fn(),
  },
} satisfies Meta<typeof SlotList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day's times. Picking one splits it: the time, and Next beside it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <Stage width="narrow" height="page">
        <SlotList {...args} value={value} onChange={setValue} />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^10:00 AM/ }));
    await expect(canvas.getByRole('button', { name: /^10:00 AM/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await expect(args.onConfirm).toHaveBeenCalled();
  },
};

/** With the visitor's calendar on: Best times tagged; asked to show every time, the busy ones read quieter. */
export const Overlay: Story = {
  args: { slots: slots(6, { 1: { isBest: true }, 2: { isBest: true }, 4: { isBusy: true }, 5: { isBusy: true } }) },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^9:30 AM.*best time/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^11:00 AM.*busy/ })).toBeInTheDocument();
  },
};

/** Two to four across, as room allows: the List view, and phones. */
export const Grid: Story = {
  args: { layout: 'grid', slots: slots(12), value: '2026-10-08T10:00' },
  render: (args) => (
    <Stage width="fill">
      <SlotList {...args} />
    </Stage>
  ),
};

/** The 24 hour clock. */
export const TwentyFourHours: Story = {
  parameters: { crm: { screenshot: false } },
  args: { hour12: false },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '12h' }));
    await expect(args.onHour12Change).toHaveBeenCalledWith(true);
  },
};

/** While the day's times load. */
export const Loading: Story = {
  args: { isLoading: true },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
};

/** Every time hidden as busy: the page says so in the list's place. */
export const Empty: Story = {
  args: { slots: [], empty: 'You’re busy for every time Ada has open this day.' },
  render: (args) => (
    <Stage width="narrow">
      <SlotList {...args} />
    </Stage>
  ),
};
