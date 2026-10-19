import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SlotPicker, type SlotDay, type SlotTime } from './SlotPicker.tsx';

/** A week of 2 to 8 November 2026, the weekend closed. */
function week(): SlotDay[] {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const long = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return names.map((weekday, index) => ({
    id: `2026-11-0${String(index + 2)}`,
    weekday,
    day: String(index + 2),
    label: `${long[index] ?? weekday} ${String(index + 2)} November`,
    hasSlots: index < 5,
  }));
}

function times(): SlotTime[] {
  return ['09:00', '09:30', '10:00', '11:30', '14:00', '15:30', '16:00'].map((label) => ({
    id: `2026-11-02T${label}:00.000Z`,
    label,
  }));
}

const meta = {
  title: 'Molecules/SlotPicker',
  component: SlotPicker,
  args: {
    weekLabel: '2 to 8 November 2026',
    days: [],
    slots: [],
    selectedDayId: '2026-11-02',
    onSelectDay: fn(),
    onPickSlot: fn(),
    onPreviousWeek: fn(),
    onNextWeek: fn(),
    canGoBack: false,
    canGoForward: true,
    status: 'ready',
  },
} satisfies Meta<typeof SlotPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A week with times, Monday chosen: picking a time moves on. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => {
    function Picker() {
      const [day, setDay] = useState('2026-11-02');
      return <SlotPicker {...args} days={week()} slots={times()} selectedDayId={day} onSelectDay={setDay} />;
    }
    return (
      <Stage>
        <Picker />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('radio', { name: 'Saturday 7 November, no open times' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('radio', { name: 'Tuesday 3 November' }));
    await expect(canvas.getByRole('radio', { name: 'Tuesday 3 November' })).toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: '09:30' }));
    await expect(args.onPickSlot).toHaveBeenCalledWith('2026-11-02T09:30:00.000Z');
  },
};

/** The week's times are loading. */
export const Loading: Story = {
  args: { status: 'loading' },
  render: (args) => (
    <Stage>
      <SlotPicker {...args} days={week()} />
    </Stage>
  ),
};

/** They failed to load: a retry. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  render: (args) => (
    <Stage>
      <SlotPicker {...args} days={week()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** A week with no open time offers the next one. */
export const EmptyWeek: Story = {
  render: (args) => (
    <Stage>
      <SlotPicker {...args} days={week().map((day) => ({ ...day, hasSlots: false }))} selectedDayId={undefined} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'Next week' })[1] ?? canvas.getByText('Next week'));
    await expect(args.onNextWeek).toHaveBeenCalled();
  },
};

/** The last week the page offers: the next week arrow is disabled. */
export const LastWeek: Story = {
  args: { canGoBack: true, canGoForward: false },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <SlotPicker {...args} days={week()} slots={times().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  },
};
