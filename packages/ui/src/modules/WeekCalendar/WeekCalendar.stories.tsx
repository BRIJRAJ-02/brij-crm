import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
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

/** Busy time (spec 0024): the member's own calendar time with nobody else invited, beside a booking and closed time. */
export const Busy: Story = {
  // Its screenshot baseline comes with the testing batch's run in the pinned image (phase 12).
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar
        {...args}
        days={days()}
        blocks={[
          ...blocks(),
          {
            id: 'busy-gym',
            dayKey: '2026-10-07',
            startMinute: 13 * 60,
            endMinute: 14 * 60 + 30,
            title: 'Busy',
            time: '1:00 – 2:30 PM',
            kind: 'busy',
            provider: 'google-calendar',
          },
          {
            id: 'busy-call',
            dayKey: '2026-10-08',
            startMinute: 15 * 60 + 45,
            endMinute: 16 * 60 + 15,
            title: 'Busy',
            time: '3:45 – 4:15 PM',
            kind: 'busy',
            provider: 'google-calendar',
          },
        ]}
        now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
      />
    </Stage>
  ),
};

/** Short blocks on one day: a booking of 15, 30, 45 and 60 minutes, a 15 minute event and a 15 minute hold. */
function shortBlocks(): WeekCalendarBlock[] {
  const day = '2026-10-06';
  const block = (
    id: string,
    start: number,
    minutes: number,
    rest: Pick<WeekCalendarBlock, 'title' | 'time' | 'kind'> & Partial<WeekCalendarBlock>,
  ): WeekCalendarBlock => ({ id, dayKey: day, startMinute: start, endMinute: start + minutes, ...rest });
  return [
    block('b15', 9 * 60, 15, { title: 'Grace Hopper', time: '9:00 AM', kind: 'booking', provider: 'timefix' }),
    block('b30', 10 * 60, 30, {
      title: 'Ada Lovelace',
      time: '10:00 – 10:30 AM',
      kind: 'booking',
      provider: 'timefix',
    }),
    block('b45', 11 * 60, 45, { title: 'Alan Turing', time: '11:00 – 11:45 AM', kind: 'booking', detail: 'Intro' }),
    block('b60', 12 * 60, 60, { title: 'Katherine Johnson', time: '12:00 – 1:00 PM', kind: 'booking', detail: 'Demo' }),
    block('e15', 14 * 60, 15, {
      title: 'Check in',
      time: '2:00 PM',
      kind: 'event',
      hue: 'blue',
      provider: 'google-calendar',
    }),
    block('h15', 15 * 60, 15, { title: 'Held', time: '3:00 PM', kind: 'held' }),
  ];
}

/** Each piece's words and its box: whether the words sit inside it, centred for a quarter hour. */
function wordsInside(piece: HTMLElement, words: HTMLElement): { readonly centred: boolean; readonly inside: boolean } {
  const box = piece.getBoundingClientRect();
  const text = words.getBoundingClientRect();
  const middle = (rect: DOMRect) => rect.top + rect.height / 2;
  return {
    centred: Math.abs(middle(box) - middle(text)) <= 1,
    inside: text.top >= box.top - 1 && text.top <= box.bottom,
  };
}

/**
 * Short blocks and a short span (the owner's 15 minute click, 21 October 2026): a quarter hour is shorter than
 * a label's line, so its words are one compact line, centred in the block and clipped at its edge, never running
 * over its border; half an hour puts the title and time on one line at the top; 45 minutes the title over the
 * time. The drawn quarter hour on Thursday reads its start inside its box.
 */
export const ShortBlocks: Story = {
  args: { selectedDay: '2026-10-06', scrollToMinute: 8 * 60 + 45 },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar
        {...args}
        days={days()}
        blocks={shortBlocks()}
        draft={{ dayKey: '2026-10-08', startMinute: 16 * 60, endMinute: 16 * 60 + 15 }}
        minuteLabel={(minute) =>
          `${String(Math.floor(minute / 60) % 12 === 0 ? 12 : Math.floor(minute / 60) % 12)}:${String(minute % 60).padStart(2, '0')} ${minute < 720 ? 'AM' : 'PM'}`
        }
      />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const pieces = [...canvasElement.querySelectorAll<HTMLElement>('button[data-size]')];
    await expect(pieces).toHaveLength(6);
    for (const piece of pieces) {
      const title = piece.querySelector<HTMLElement>('[class*="block-title"]');
      if (title === null) throw new Error('a block without its title');
      const { centred, inside } = wordsInside(piece, title);
      // A quarter hour centres its one line; longer ones start at their top, inside.
      await expect(piece.dataset.size === 'tiny' ? centred : inside).toBe(true);
    }
    const ghost = canvasElement.querySelector<HTMLElement>('div[class*="ghost"][data-size="tiny"]');
    if (ghost === null) throw new Error('no drawn span');
    const start = ghost.querySelector<HTMLElement>('[class*="ghost-start"]');
    if (start === null) throw new Error('a drawn span without its start');
    await expect(start).toHaveTextContent('4:00 PM');
    await expect(wordsInside(ghost, start).centred).toBe(true);
  },
};

/** A week with a booking beside an overlapping calendar event, a cancelled one, and the now line. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={blocks()} now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }} />
    </Stage>
  ),
};

/** The week while its blocks load: the grid in place, busy, each day saying it is loading. */
export const Loading: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar
        {...args}
        days={days()}
        blocks={[]}
        isLoading
        now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
      />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const week = within(canvasElement).getByRole('region');
    await expect(week).toHaveAttribute('aria-busy', 'true');
    await expect(within(week).getAllByRole('group', { name: /, loading$/ })).toHaveLength(7);
  },
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

/**
 * A block removed outside its card (the screen's confirm): its card closed, the block went, and the screen asks for
 * its day, which takes focus once nothing else has it.
 */
export const FocusDay: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [shown, setShown] = useState(blocks);
    const [request, setRequest] = useState<{ readonly dayKey: string; readonly blockId?: string } | undefined>(
      undefined,
    );
    return (
      <Stage width="fill">
        {/* The confirm's commit, gone with the block it removed, as a confirm's is: focus falls to the page. */}
        {request === undefined && (
          <Button
            onPress={() => {
              setShown((before) => before.filter((block) => block.id !== 'dentist'));
              setRequest({ dayKey: '2026-10-07', blockId: 'dentist' });
            }}
          >
            Remove the block
          </Button>
        )}
        <WeekCalendar
          {...args}
          days={days()}
          blocks={shown}
          {...(request === undefined ? {} : { focusDay: request })}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove the block' }));
    await waitFor(() => expect(canvas.getByRole('group', { name: 'Wednesday, 7 October, nothing on' })).toHaveFocus());
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
