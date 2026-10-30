import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import type { WeekCalendarBlock } from '../WeekCalendar/WeekCalendar.tsx';
import { TeamDay, type TeamDayLaneItem, type TeamDayPerson } from './TeamDay.tsx';

const ADA = '0193a1b2-0000-7000-8000-000000000001';
const GRACE = '0193a1b2-0000-7000-8000-000000000002';
const ALAN = '0193a1b2-0000-7000-8000-000000000003';
const KATHERINE = '0193a1b2-0000-7000-8000-000000000004';
const LINUS = '0193a1b2-0000-7000-8000-000000000005';

/** The frozen clock's day, Thursday 8 October 2026: five people, one away, one with no hours. Built in a function. */
function people(): TeamDayPerson[] {
  return [
    {
      id: ADA,
      name: 'Ada Lovelace',
      title: 'Head of sales',
      status: '2 booked',
      tone: 'booked',
      label: 'Ada Lovelace, Head of sales, 2 booked',
    },
    {
      id: GRACE,
      name: 'Grace Hopper',
      title: 'Account executive',
      status: '1 booked',
      tone: 'booked',
      label: 'Grace Hopper, Account executive, 1 booked',
    },
    {
      id: ALAN,
      name: 'Alan Turing',
      title: 'Solutions engineer',
      status: 'Away',
      tone: 'away',
      label: 'Alan Turing, Solutions engineer, away',
      band: { label: 'Away · Vacation', startMinute: 0, endMinute: 1440 },
    },
    {
      id: KATHERINE,
      name: 'Katherine Johnson',
      status: 'Free',
      tone: 'free',
      badge: 'UTC+5:30',
      label: 'Katherine Johnson, free, UTC+5:30',
    },
    { id: LINUS, name: 'Linus Torvalds', status: 'No hours', tone: 'off', label: 'Linus Torvalds, no hours' },
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

function lane(): TeamDayLaneItem[] {
  return [
    {
      id: 'l1',
      time: '3:00 PM',
      title: 'Follow up',
      detail: 'Tom Ruiz · Alan Turing',
      status: 'Host away',
      label: 'Follow up, 3:00 PM, Tom Ruiz, Alan Turing is away',
    },
    {
      id: 'n1',
      time: '4:30 PM',
      title: 'Discovery',
      detail: 'Ola Berg · left the workspace',
      status: 'Needs a host',
      label: 'Discovery, 4:30 PM, Ola Berg, needs a host',
    },
  ];
}

const hours = (person: string) =>
  person === LINUS
    ? []
    : person === KATHERINE
      ? [{ startMinute: 3 * 60 + 30, endMinute: 11 * 60 + 30 }]
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
  },
} satisfies Meta<typeof TeamDay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day of five people: bookings, closed time and Busy in their columns, one away, one with no hours, and the lane. */
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
            items: lane(),
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
    // Each person's column is a group named for them, with what is on it.
    await expect(canvas.getByRole('group', { name: 'Alan Turing, Solutions engineer, away, 1 item' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Needs a host, 2 bookings' })).toBeVisible();
  },
};

/** The lane's card opens its booking's card beside it; Escape closes it. */
export const LaneOpen: Story = {
  parameters: { crm: { screenshot: false } },
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
            items: lane(),
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
    const item = canvas.getByRole('button', { name: 'Discovery, 4:30 PM, Ola Berg, needs a host' });
    await userEvent.click(item);
    await settleAnimations();
    await expect(within(document.body).getByRole('dialog')).toBeVisible();
    await expect(item).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await expect(item).toHaveAttribute('aria-expanded', 'false');
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
    canvas.getByRole('group', { name: 'Ada Lovelace, Head of sales, 2 booked, 3 items' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onSelectPerson).toHaveBeenCalledWith(GRACE);
  },
};

/** A phone: one person at a time, Previous and Next in the corner. */
export const Phone: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="phone" height="page">
      <TeamDay {...args} people={people()} blocks={blocks()} openHours={hours} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: 'Previous person' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Next person' }));
    await expect(args.onSelectPerson).toHaveBeenCalledWith(GRACE);
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
