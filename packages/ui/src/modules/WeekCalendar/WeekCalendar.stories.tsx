import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SpanCard } from '../SpanCard/SpanCard.tsx';
import { WeekCalendar, type WeekCalendarBlock, type WeekCalendarDay, type WeekCalendarSpan } from './WeekCalendar.tsx';

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

/** Drawing on empty time: Enter on a day draws the default length from the working start, and its card opens beside it. */
export const Draw: Story = {
  render: function Render(args) {
    const [draft, setDraft] = useState<WeekCalendarSpan | undefined>(undefined);
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={blocks()}
          now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
          scrollToMinute={8 * 60}
          minuteLabel={(minute) =>
            `${String(Math.floor(minute / 60) % 12 === 0 ? 12 : Math.floor(minute / 60) % 12)}:${String(minute % 60).padStart(2, '0')} ${minute < 720 ? 'AM' : 'PM'}`
          }
          onDraw={(span) => {
            args.onDraw?.(span);
            setDraft(span);
          }}
          {...(draft === undefined ? {} : { draft })}
          draftLabel="Monday 5 October, 9:00 to 9:30 AM"
          draftCard={
            <SpanCard
              title="9:00 – 9:30 AM"
              meta="Monday 5 October · 30 min"
              focusKey="choose"
              choices={[
                { id: 'block', label: 'Block this time', icon: 'circle-slash', onPress: fn() },
                { id: 'hold', label: 'Hold for a private page', icon: 'bookmark', onPress: fn() },
              ]}
            />
          }
          onDraftClose={() => setDraft(undefined)}
        />
      </Stage>
    );
  },
  args: { onDraw: fn(), selectedDay: '2026-10-05' },
  play: async ({ canvas, args, canvasElement }) => {
    canvas.getByRole('group', { name: 'Monday, 5 October, nothing on' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onDraw).toHaveBeenCalledWith({ dayKey: '2026-10-05', startMinute: 540, endMinute: 570 });
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(body.getByRole('dialog', { name: 'Monday 5 October, 9:00 to 9:30 AM' })).toBeInTheDocument(),
    );
  },
};

/** A drawn span that is not yet anything: the solid ghost, under the day's blocks. */
export const DrawnSpan: Story = {
  args: { onDraw: fn(), selectedDay: '2026-10-08' },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar
        {...args}
        days={days()}
        blocks={blocks()}
        draft={{ dayKey: '2026-10-08', startMinute: 15 * 60, endMinute: 17 * 60 }}
        minuteLabel={(minute) => `${String(Math.floor(minute / 60))}:${String(minute % 60).padStart(2, '0')}`}
      />
    </Stage>
  ),
};

/** A finger taps to draw the default length; one that scrolls draws nothing. */
export const DrawByTouch: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onDraw: fn(), selectedDay: '2026-10-05' },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={[]} scrollToMinute={0} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    const column = canvas.getByRole('group', { name: 'Monday, 5 October, nothing on' });
    const box = column.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const yAt = (minute: number) => box.top + (minute / 1440) * box.height;
    const touch = (type: string, minute: number) =>
      column.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 7,
          pointerType: 'touch',
          clientX: x,
          clientY: yAt(minute),
        }),
      );
    // A scroll: the finger moves, then the browser takes the pointer.
    touch('pointerdown', 600);
    touch('pointermove', 700);
    column.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7, pointerType: 'touch' }));
    await expect(args.onDraw).not.toHaveBeenCalled();
    // A tap.
    touch('pointerdown', 600);
    touch('pointerup', 600);
    await expect(args.onDraw).toHaveBeenCalledWith({ dayKey: '2026-10-05', startMinute: 600, endMinute: 630 });
  },
};

/** A drag across a day draws the span between press and release, snapped to the quarter hour. */
export const DrawByDragging: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onDraw: fn(), selectedDay: '2026-10-05' },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={[]} scrollToMinute={0} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    const column = canvas.getByRole('group', { name: 'Monday, 5 October, nothing on' });
    const box = column.getBoundingClientRect();
    const yAt = (minute: number) => box.top + (minute / 1440) * box.height;
    const x = box.left + box.width / 2;
    column.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: yAt(62),
      }),
    );
    column.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: yAt(148),
      }),
    );
    column.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: yAt(148),
      }),
    );
    await waitFor(() =>
      expect(args.onDraw).toHaveBeenCalledWith({ dayKey: '2026-10-05', startMinute: 60, endMinute: 150 }),
    );
  },
};
