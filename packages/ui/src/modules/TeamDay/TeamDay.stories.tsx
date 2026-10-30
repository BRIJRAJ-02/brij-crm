import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import type { BookingListRow } from '../BookingList/BookingList.tsx';
import type { WeekCalendarBlock } from '../WeekCalendar/WeekCalendar.tsx';
import { TeamDay, type TeamDayPerson } from './TeamDay.tsx';

const ADA = '0193a1b2-0000-7000-8000-000000000001';
const GRACE = '0193a1b2-0000-7000-8000-000000000002';
const ALAN = '0193a1b2-0000-7000-8000-000000000003';
const KATHERINE = '0193a1b2-0000-7000-8000-000000000004';
const LINUS = '0193a1b2-0000-7000-8000-000000000005';

/** The frozen clock's day, Thursday 8 October 2026: five people, one away, one off, one in another zone. */
function people(): TeamDayPerson[] {
  return [
    { id: ADA, name: 'Ada Lovelace', title: 'Head of sales', status: '2 booked', tone: 'booked' },
    {
      id: GRACE,
      name: 'Grace Hopper',
      title: 'Account executive',
      status: '1 booked',
      tone: 'booked',
      extra: <Badge text="Reconnect" dot="red" isWhole />,
      extraLabel: 'Reconnect',
    },
    {
      id: ALAN,
      name: 'Alan Turing',
      title: 'Solutions engineer',
      status: 'Away',
      tone: 'away',
      band: { label: 'Away · Vacation', startMinute: 0, endMinute: 1440 },
    },
    { id: KATHERINE, name: 'Katherine Johnson', status: 'Free', tone: 'free', badge: 'UTC+1' },
    { id: LINUS, name: 'Linus Torvalds', status: 'Off', tone: 'off' },
  ];
}

function blocks(): WeekCalendarBlock[] {
  return [
    {
      id: 'a1',
      dayKey: ADA,
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
      title: 'Intro call',
      time: '9:00 – 9:30 AM',
      detail: 'Maya Patel',
      kind: 'booking',
      hue: 'purple',
    },
    {
      id: 'a2',
      dayKey: ADA,
      startMinute: 11 * 60,
      endMinute: 12 * 60,
      title: 'Demo',
      time: '11:00 AM – 12:00 PM',
      detail: 'Jon Reyes',
      kind: 'booking',
      hue: 'blue',
    },
    {
      id: 'a3',
      dayKey: ADA,
      startMinute: 13 * 60,
      endMinute: 14 * 60,
      title: 'Blocked',
      time: '1:00 – 2:00 PM',
      kind: 'blocked',
    },
    {
      id: 'g1',
      dayKey: GRACE,
      startMinute: 10 * 60,
      endMinute: 11 * 60,
      title: 'Busy',
      time: '10:00 – 11:00 AM',
      kind: 'busy',
    },
    {
      id: 'g2',
      dayKey: GRACE,
      startMinute: 14 * 60 + 30,
      endMinute: 15 * 60,
      title: 'Pricing call',
      time: '2:30 – 3:00 PM',
      detail: 'Sana Iqbal',
      kind: 'booking',
      hue: 'green',
      status: 'Outside hours',
    },
    {
      id: 'l1',
      dayKey: ALAN,
      startMinute: 15 * 60,
      endMinute: 15 * 60 + 30,
      title: 'Follow up',
      time: '3:00 – 3:30 PM',
      detail: 'Tom Ruiz',
      kind: 'booking',
      hue: 'orange',
      status: 'Host away',
    },
  ];
}

/** The lane's bookings, as BookingList's rows: the time, the page, who it was with and whose it was. */
function lane(): BookingListRow[] {
  return [
    {
      id: 'l1',
      date: '3:00 PM',
      time: '',
      title: 'Follow up',
      guestName: 'Tom Ruiz',
      hostName: 'Alan Turing',
      badge: 'Host away',
    },
    { id: 'n1', date: '4:30 PM', time: '', title: 'Discovery', guestName: 'Ola Berg', hostName: 'Left the workspace' },
  ];
}

const hours = (person: string) =>
  person === LINUS
    ? []
    : person === KATHERINE
      ? [{ startMinute: 13 * 60, endMinute: 21 * 60 }]
      : [{ startMinute: 9 * 60, endMinute: 17 * 60 }];

const meta = {
  title: 'Modules/TeamDay',
  component: TeamDay,
  args: {
    label: 'Team, Thursday 8 October',
    people: [],
    blocks: [],
    selectedPerson: ADA,
    onSelectPerson: fn(),
    hourLabel: (hour: number) => `${String(hour % 12 === 0 ? 12 : hour % 12)} ${hour < 12 ? 'AM' : 'PM'}`,
    scrollToMinute: 8 * 60,
    onOpen: fn(),
    onClose: fn(),
    onDraw: fn(),
  },
} satisfies Meta<typeof TeamDay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day of five people: bookings, closed time and Busy in their columns, one away, one off, and the lane. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: function Render(args) {
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    return (
      <Stage width="fill" height="page">
        <TeamDay
          {...args}
          people={people()}
          blocks={blocks()}
          openHours={hours}
          now={{ dayKey: '2026-10-08', minute: 14 * 60 + 30 }}
          lane={{
            rows: lane(),
            ...(openId === undefined ? {} : { openId }),
            detail: <p>Reassign</p>,
            onOpen: setOpenId,
            onClose: () => setOpenId(undefined),
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Each person's column is a group named for them: status, then offset, title and trouble, as the head shows.
    await expect(canvas.getByRole('group', { name: 'Alan Turing, Away, Solutions engineer, 1 item' })).toBeVisible();
    await expect(
      canvas.getByRole('group', { name: 'Grace Hopper, 1 booked, Account executive, Reconnect, 2 items' }),
    ).toBeVisible();
    await expect(canvas.getByRole('group', { name: 'Katherine Johnson, Free, UTC+1, nothing on' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Needs a host, 2 bookings' })).toBeVisible();
  },
};

/** The lane's row opens its booking's card beside it; Escape closes it and focus goes back to the row. */
export const LaneOpen: Story = {
  render: function Render(args) {
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    return (
      <Stage width="fill" height="page">
        <TeamDay
          {...args}
          people={people()}
          blocks={blocks()}
          openHours={hours}
          lane={{
            rows: lane(),
            ...(openId === undefined ? {} : { openId }),
            detail: <p>Reassign</p>,
            onOpen: setOpenId,
            onClose: () => setOpenId(undefined),
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole('button', { name: 'Discovery' });
    await userEvent.click(row);
    await settleAnimations();
    await expect(within(document.body).getByRole('dialog')).toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(row).toHaveFocus());
  },
};

/** A colleague the reader may only See: an eye on the head, "view only" in its name, and nothing drawn on Enter. */
export const SeeOnly: Story = {
  render: (args) => (
    <Stage width="fill" height="page">
      <TeamDay
        {...args}
        people={people().map((person) => (person.id === GRACE ? { ...person, canAct: false } : person))}
        blocks={blocks()}
        openHours={hours}
      />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    const column = canvas.getByRole('group', { name: /^Grace Hopper, .*view only/ });
    await expect(column).not.toHaveAttribute('aria-keyshortcuts');
    column.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onDraw).not.toHaveBeenCalled();
    // A column the reader acts on still draws.
    canvas.getByRole('group', { name: /^Ada Lovelace/ }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onDraw).toHaveBeenCalled();
  },
};

/** The keyboard: Right moves to the next person and selects them. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill" height="page">
      <TeamDay {...args} people={people()} blocks={blocks()} openHours={hours} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    canvas.getByRole('group', { name: 'Ada Lovelace, 2 booked, Head of sales, 3 items' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onSelectPerson).toHaveBeenCalledWith(GRACE);
  },
};

/** A phone: one person at a time, Previous and Next in the corner, the lane over the grid. */
export const Phone: Story = {
  render: (args) => (
    <Stage width="phone" height="page">
      <TeamDay
        {...args}
        people={people()}
        blocks={blocks()}
        openHours={hours}
        lane={{ rows: lane(), onOpen: fn(), onClose: fn() }}
      />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: 'Previous person' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Next person' }));
    await expect(args.onSelectPerson).toHaveBeenCalledWith(GRACE);
  },
};

/** A day with nothing on it yet: the heads and hours, and the quiet line in the middle. */
export const Empty: Story = {
  render: (args) => (
    <Stage width="fill" height="page">
      <TeamDay {...args} people={people()} openHours={hours} emptyHint="No meetings this day" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No meetings this day')).toBeVisible();
  },
};

/** While the day loads: the grid in place, busy, the people's heads already there. */
export const Loading: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill" height="page">
      <TeamDay {...args} people={people()} isLoading />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region')).toHaveAttribute('aria-busy', 'true');
  },
};
