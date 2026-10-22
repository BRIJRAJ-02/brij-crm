import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AsideLayout } from '../AsideLayout/AsideLayout.tsx';
import { PageColumn } from '../PageColumn/PageColumn.tsx';
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
      title: 'Reserved time',
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
    block('h15', 15 * 60, 15, { title: 'Reserved time', time: '3:00 PM', kind: 'held' }),
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
    // Half an hour shows its start alone, so the title keeps its room, but still reads the whole time.
    const half = within(canvasElement).getByRole('button', { name: 'Ada Lovelace, 10:00 – 10:30 AM' });
    await expect(half.querySelector('[class*="block-time"]')).toHaveTextContent(/^10:00 AM$/);
    // A longer block shows the whole time, and says who it is with in its name.
    const long = within(canvasElement).getByRole('button', { name: 'Alan Turing, 11:00 – 11:45 AM, Intro' });
    await expect(long.querySelector('[class*="block-time"]')).toHaveTextContent('11:00 – 11:45 AM');
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

/**
 * The zone the hours are in, over the hour axis ("GMT+5:30"), read out in full: the member's zone from their
 * Preferences, which may not be the device's. Out of the screenshots until its baseline is taken in the pinned
 * image; Default shows the same grid.
 */
export const Zone: Story = {
  parameters: { crm: { screenshot: false } },
  args: { zone: { short: 'GMT+5:30', name: 'Times in Kolkata time (GMT+5:30)' } },
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={blocks()} now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const corner = canvasElement.querySelector('[title^="Times in"]');
    await expect(corner?.textContent).toContain('GMT+5:30');
    await expect(corner?.getAttribute('title')).toBe('Times in Kolkata time (GMT+5:30)');
    // Read out as focus enters the week: the section is described by the zone's full name.
    const described = canvasElement.querySelector('section')?.getAttribute('aria-describedby') ?? '';
    await expect(canvasElement.ownerDocument.getElementById(described)?.textContent).toBe(
      'Times in Kolkata time (GMT+5:30)',
    );
  },
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
          detail={
            <>
              <p>Grace Hopper, 3:30 – 4:00 PM</p>
              <p>Quick chat</p>
            </>
          }
          onOpen={setOpen}
          onClose={() => setOpen(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    // A cancelled block says so in its name, not by its strike alone.
    await expect(
      canvas.getByRole('button', { name: 'Alan Turing, 10:00 – 11:00 AM, Site visit, canceled' }),
    ).toBeInTheDocument();
    // Its name says who and when, and what it is about (the block's detail).
    await userEvent.click(canvas.getByRole('button', { name: 'Grace Hopper, 3:30 – 4:00 PM, Quick chat' }));
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
                { id: 'hold', label: 'Reserve for link only pages', icon: 'bookmark', onPress: fn() },
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

/** A Thursday packed full, laid out like Google Calendar. */
function crowded(): WeekCalendarBlock[] {
  const thursday = '2026-10-08';
  const block = (
    id: string,
    from: number,
    to: number,
    title: string,
    kind: WeekCalendarBlock['kind'],
    hue?: WeekCalendarBlock['hue'],
  ): WeekCalendarBlock => ({
    id,
    dayKey: thursday,
    startMinute: from * 60,
    endMinute: to * 60,
    title,
    time: `${String(from)}:00`,
    kind,
    ...(hue === undefined ? {} : { hue }),
  });
  return [
    // Side by side: they start together.
    block('planning', 9, 11, 'Planning', 'event', 'green'),
    block('ada', 9, 10, 'Ada Lovelace', 'booking'),
    // Indented over Planning: it starts an hour after.
    block('review', 10, 11, 'Design review', 'event', 'purple'),
    // Six at once: two lanes and "+4".
    block('one', 13, 14, 'One', 'event', 'blue'),
    block('two', 13, 14, 'Two', 'event', 'orange'),
    block('three', 13, 14, 'Three', 'event', 'sky'),
    block('four', 13, 14, 'Four', 'booking'),
    block('five', 13, 14, 'Five', 'event', 'red'),
    block('six', 13, 14, 'Six', 'event', 'lime'),
  ];
}

/** Overlaps: side by side when they start together, indented over an earlier one when they start well after it, and "+N" when a lane would be too narrow; the "+N" list opens each block's card. */
export const Overlap: Story = {
  // Its screenshot baseline comes from CI's run in the pinned image.
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [openId, setOpenId] = useState<string>();
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={crowded()}
          scrollToMinute={9 * 60}
          openId={openId}
          detail={<span>{openId}</span>}
          onOpen={setOpenId}
          onClose={() => setOpenId(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const day = canvas.getByRole('group', { name: 'Thursday, 8 October, 9 items' });
    const review = within(day).getByRole('button', { name: 'Design review, 10:00' });
    await expect(review).toHaveAttribute('data-nested');
    await expect(within(day).queryByRole('button', { name: 'Five, 13:00' })).not.toBeInTheDocument();
    const chip = within(day).getByRole('button', { name: '4 more items at 13:00' });
    await userEvent.click(chip);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('menuitem', { name: /Five/ }));
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Details' })).toBeInTheDocument());
    // While a folded block's card is open, its chip shows as open.
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    // Escape: focus goes back to the chip, the list item it came from being gone.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument());
    await waitFor(() => expect(chip).toHaveFocus());
    // From the keyboard: Enter opens the list on its first item, and Enter on it opens that block's card.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByRole('menuitem', { name: /Three/ })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Details' })).toHaveTextContent('three'));
  },
};

/** Filling a page: PageColumn `align="fill"`, AsideLayout `isFill` and the grid's `isFill`, the hours scrolling inside. */
export const Fill: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill" height="page">
      <PageColumn align="fill">
        <AsideLayout aside={null} asideLabel="Calendars" isAsideOpen={false} onAsideClose={() => undefined} isFill>
          <WeekCalendar {...args} days={days()} blocks={blocks()} isFill />
        </AsideLayout>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector('section');
    const page = canvasElement.querySelector('[data-align="fill"]');
    // The grid reaches the column's foot rather than stopping at twelve hours.
    await waitFor(() =>
      expect(grid?.getBoundingClientRect().bottom).toBeGreaterThan((page?.getBoundingClientRect().bottom ?? 0) - 40),
    );
  },
};

/** Weekday hours of 9 to 5: the rest a step darker. */
const nineToFive = (dayKey: string) => {
  const weekday = new Date(`${dayKey}T12:00:00`).getDay();
  return weekday === 0 || weekday === 6 ? [] : [{ startMinute: 9 * 60, endMinute: 17 * 60 }];
};

/** All day items in their row over the hours, and the hours outside 9 to 5 shaded; an all day chip opens its card. */
export const AllDayAndHours: Story = {
  render: function Render(args) {
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={blocks()}
          scrollToMinute={8 * 60}
          now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
          allDay={[
            { id: 'offsite-9', dayKey: '2026-10-09', title: 'Team offsite', hue: 'blue' },
            { id: 'offsite-10', dayKey: '2026-10-10', title: 'Team offsite', hue: 'blue' },
            { id: 'holiday', dayKey: '2026-10-06', title: 'Holiday', hue: 'purple' },
          ]}
          openHours={nineToFive}
          {...(openId === undefined ? {} : { openId })}
          detail={<p>Team offsite</p>}
          onOpen={setOpenId}
          onClose={() => setOpenId(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('All day')).toBeInTheDocument();
    // Saturday is a day off: one shaded stretch, the whole day; a weekday has two, before 9 and after 5.
    const columns = canvasElement.querySelectorAll('[role="group"]');
    await expect(columns[5]?.querySelectorAll('[data-off-hours]').length).toBe(1);
    await expect(columns[0]?.querySelectorAll('[data-off-hours]').length).toBe(2);
    await userEvent.click(canvas.getByRole('button', { name: /^Holiday, all day/ }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('dialog')).toHaveTextContent('Team offsite'));
    await userEvent.keyboard('{Escape}');
  },
};

/** A week with nothing on it: one quiet line in the middle of the grid. */
export const EmptyWeek: Story = {
  render: (args) => (
    <Stage width="fill">
      <WeekCalendar {...args} days={days()} blocks={[]} emptyHint="No meetings this week" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No meetings this week')).toBeVisible();
  },
};

/**
 * A busy all day row: a day over three items shows two and "+N more", which lists the rest (a Menu in a Popover);
 * choosing one opens its card on the chip. The chips are in the day's arrow key order, above its blocks.
 */
export const AllDayCapped: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={blocks()}
          allDay={[
            { id: 'mon-1', dayKey: '2026-10-05', title: 'Conference', hue: 'blue' },
            { id: 'mon-2', dayKey: '2026-10-05', title: 'Out of office', hue: 'purple' },
            { id: 'mon-3', dayKey: '2026-10-05', title: 'Release week', hue: 'green' },
            { id: 'mon-4', dayKey: '2026-10-05', title: 'Birthday', hue: 'orange' },
            { id: 'mon-5', dayKey: '2026-10-05', title: 'On call', hue: 'red' },
            { id: 'thu-1', dayKey: '2026-10-08', title: 'Team offsite', hue: 'blue' },
          ]}
          {...(openId === undefined ? {} : { openId })}
          detail={<p>{openId}</p>}
          onOpen={setOpenId}
          onClose={() => setOpenId(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    // The chips are not tab stops; the day's column is.
    const offsite = canvas.getByRole('button', { name: /^Team offsite, all day/ });
    await expect(offsite).toHaveAttribute('tabindex', '-1');
    // Down from Thursday's column: its all day chip first, then its blocks by start.
    canvas.getByRole('group', { name: 'Thursday, 8 October, 3 items' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(offsite).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('button', { name: 'Team standup, 3:00 – 4:00 PM' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(offsite).toHaveFocus();
    // Monday holds five: two show, the rest fold into "+3 more".
    await expect(canvas.queryByRole('button', { name: /^Release week/ })).not.toBeInTheDocument();
    const more = canvas.getByRole('button', { name: '3 more all day items on Monday, 5 October' });
    await expect(more).toHaveTextContent('+3 more');
    // Left from a chip moves to the day before, as from its column.
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(canvas.getByRole('group', { name: 'Wednesday, 7 October, 1 item' })).toHaveFocus());
    await userEvent.click(more);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Birthday' }));
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Details' })).toHaveTextContent('mon-4'));
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(more).toHaveFocus());
  },
};

/** On a phone a block's card is a sheet at the window's foot, not a popover over the day; Escape closes it. */
export const PhoneCard: Story = {
  parameters: { crm: { screenshot: false } },
  args: { selectedDay: '2026-10-08' },
  render: function Render(args) {
    const [open, setOpen] = useState<string | undefined>(undefined);
    return (
      <Stage width="phone">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={blocks()}
          now={{ dayKey: '2026-10-08', minute: 15 * 60 + 30 }}
          scrollToMinute={15 * 60}
          {...(open === undefined ? {} : { openId: open })}
          detail={<p>Grace Hopper, 3:30 – 4:00 PM</p>}
          onOpen={setOpen}
          onClose={() => setOpen(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: /^Grace Hopper, 3:30 – 4:00 PM/ }));
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await waitFor(() => body.getByRole('dialog', { name: 'Details' }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    // The window's width, on its foot.
    await expect(Math.round(sheet.getBoundingClientRect().width)).toBe(globalThis.innerWidth);
    await expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(globalThis.innerHeight);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument());
  },
};

/**
 * Escape after drawing (the owner's stray highlight, 22 October 2026): the span and its card go, focus goes back
 * to the day, and a span drawn with the pointer gives the day no ring; one drawn with Enter does, for the keyboard.
 */
export const DrawThenEscape: Story = {
  parameters: { crm: { screenshot: false } },
  args: { selectedDay: '2026-10-05' },
  render: function Render(args) {
    const [draft, setDraft] = useState<WeekCalendarSpan | undefined>(undefined);
    return (
      <Stage width="fill">
        <WeekCalendar
          {...args}
          days={days()}
          blocks={[]}
          scrollToMinute={8 * 60}
          onDraw={setDraft}
          {...(draft === undefined ? {} : { draft })}
          draftCard={<button type="button">Book someone in</button>}
          onDraftClose={() => setDraft(undefined)}
        />
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const column = canvas.getByRole('group', { name: 'Monday, 5 October, nothing on' });
    const box = column.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + (10 / 24) * box.height };
    const mouse = (type: string) =>
      column.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 3, pointerType: 'mouse', ...at }),
      );
    mouse('pointerdown');
    mouse('pointerup');
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('button', { name: 'Book someone in' })).toBeInTheDocument());
    await expect(canvasElement.querySelector('[class*="ghost"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('button', { name: 'Book someone in' })).toBeNull());
    // Nothing of the span is left, focus is on its day, and the day draws no ring.
    await expect(canvasElement.querySelector('[class*="ghost"]')).toBeNull();
    await waitFor(() => expect(column).toHaveFocus());
    await expect(getComputedStyle(column).outlineStyle).toBe('none');
    // Enter draws from the keyboard; Escape then hands focus back with the ring.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByRole('button', { name: 'Book someone in' })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(column).toHaveFocus());
    await expect(getComputedStyle(column).outlineStyle).toBe('solid');
  },
};
