import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { WeekCalendar, type WeekCalendarBlock, type WeekCalendarDay } from './WeekCalendar.tsx';

/** The frozen clock's week: Monday 5 to Sunday 11 October 2026, today Thursday the 8th. */
function days(): WeekCalendarDay[] {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const long = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return names.map((weekday, index) => ({
    key: `2026-10-${String(5 + index).padStart(2, '0')}`,
    weekday,
    dayNumber: String(5 + index),
    label: `${long[index] ?? weekday}, ${String(5 + index)} October`,
    isToday: index === 3,
    isPast: index < 3,
  }));
}

function blocks(): WeekCalendarBlock[] {
  return [
    {
      id: 'grace',
      dayKey: '2026-10-08',
      startMinute: 15 * 60 + 30,
      endMinute: 16 * 60,
      title: 'Grace Hopper',
      time: '3:30 – 4:00 PM',
      detail: 'Quick chat',
      kind: 'booking',
      provider: 'timefix',
    },
    {
      id: 'standup',
      dayKey: '2026-10-08',
      startMinute: 15 * 60,
      endMinute: 16 * 60,
      title: 'Team standup',
      time: '3:00 – 4:00 PM',
      kind: 'event',
      hue: 'green',
      provider: 'google-calendar',
    },
    {
      id: 'dentist',
      dayKey: '2026-10-07',
      startMinute: 16 * 60,
      endMinute: 17 * 60 + 30,
      title: 'Blocked',
      time: '4:00 – 5:30 PM',
      detail: 'Dentist',
      kind: 'blocked',
    },
    {
      id: 'hold',
      dayKey: '2026-10-09',
      startMinute: 17 * 60,
      endMinute: 18 * 60,
      title: 'Held',
      time: '5:00 – 6:00 PM',
      kind: 'held',
    },
    {
      id: 'alan',
      dayKey: '2026-10-09',
      startMinute: 10 * 60,
      endMinute: 11 * 60,
      title: 'Alan Turing',
      time: '10:00 – 11:00 AM',
      detail: 'Site visit',
      kind: 'booking',
      provider: 'timefix',
      isCancelled: true,
    },
  ];
}

const meta = {
  title: 'Modules/WeekCalendar',
  component: WeekCalendar,
  args: {
    label: 'Bookings, 5 – 11 October 2026',
    days: [],
    blocks: [],
    selectedDay: '2026-10-08',
    onSelectDay: fn(),
    hourLabel: (hour: number) => `${String(hour % 12 === 0 ? 12 : hour % 12)} ${hour < 12 ? 'AM' : 'PM'}`,
    scrollToMinute: 15 * 60,
    onOpen: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof WeekCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A week with a booking beside an overlapping calendar event, a cancelled one, and the now line. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={blocks()} now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }} />
    </Stage>
  ),
};

/** Pressing a block opens its card beside it; Escape closes it. */
export const OpenCard: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [open, setOpen] = useState<string | undefined>(undefined);
    const [day, setDay] = useState(args.selectedDay);
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={blocks()}
          selectedDay={day}
          onSelectDay={setDay}
          now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
          {...(open === undefined ? {} : { openId: open })}
          detail={<p>Grace Hopper, 3:30 – 4:00 PM</p>}
          onOpen={setOpen}
          onClose={() => setOpen(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Grace Hopper, 3:30 – 4:00 PM' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Details' })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument());
  },
};

/** The keyboard: Right moves to the next day and selects it. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={blocks()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    canvas.getByRole('group', { name: 'Thursday, 8 October, 2 items' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onSelectDay).toHaveBeenCalledWith('2026-10-09');
  },
};
