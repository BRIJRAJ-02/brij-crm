import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingList, type BookingListGroup } from './BookingList.tsx';

function groups(): BookingListGroup[] {
  return [
    {
      id: '2026-10-08',
      label: 'Today',
      rows: [
        {
          id: 'grace',
          date: 'Thu, 8 Oct',
          time: '4:00 – 4:30 PM',
          join: { href: 'https://meet.google.com/abc-defg-hij', provider: 'Google Meet' },
          title: 'Quick chat',
          note: 'We would like to talk about the pilot for the whole of the operations team next quarter.',
          guestName: 'Grace Hopper',
          guestHref: '/people/grace',
          actions: <Button variant="ghost">Edit</Button>,
        },
      ],
    },
    {
      id: '2026-10-09',
      label: 'Fri, 9 Oct',
      rows: [
        {
          id: 'alan',
          date: 'Fri, 9 Oct',
          time: '10:00 – 11:00 AM',
          title: 'Site visit',
          guestName: 'Alan Turing',
          badge: 'Cancelled',
        },
      ],
    },
  ];
}

const meta = {
  title: 'Modules/BookingList',
  component: BookingList,
  args: { label: 'Upcoming bookings', groups: [], onOpen: fn() },
} satisfies Meta<typeof BookingList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two days: one booking with its Join link, note and linked guest; one cancelled. Pressing a title opens it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <BookingList {...args} groups={groups()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('link', { name: 'Join Google Meet' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Grace Hopper' })).toBeInTheDocument();
    await expect(canvas.getByText('Cancelled')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Site visit' }));
    await expect(args.onOpen).toHaveBeenCalledWith('alan');
  },
};

/** No bookings: the tab's own empty state. */
export const Empty: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingList
        {...args}
        emptyState={<EmptyState title="No upcoming bookings">Bookings people make show here.</EmptyState>}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No upcoming bookings')).toBeInTheDocument();
  },
};

/** Home's Today: one day's bookings and the member's own calendar events, the time in the date column; an event has no guest, so no "You and" line. */
export const Agenda: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingList
        {...args}
        label="Today"
        groups={[
          {
            id: 'earlier',
            label: 'Earlier',
            rows: [{ id: 'standup', date: '9:00 AM', time: '15 min', title: 'Team standup' }],
          },
          {
            id: 'next',
            label: 'Next',
            rows: [
              {
                id: 'grace',
                date: '4:00 PM',
                time: '30 min',
                join: { href: 'https://meet.google.com/abc-defg-hij', provider: 'Google Meet' },
                title: 'Quick chat',
                guestName: 'Grace Hopper',
              },
            ],
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('You and')).toHaveLength(1);
    await expect(canvas.getByRole('button', { name: 'Team standup' })).toBeInTheDocument();
  },
};
