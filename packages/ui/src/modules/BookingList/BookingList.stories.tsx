import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
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

/**
 * Two days: one booking with its Join link, note and linked guest; one cancelled. Pressing a title, or anywhere
 * on its row but its links and actions, opens it.
 */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <BookingList {...args} groups={groups()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole('link', { name: 'Join Google Meet' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Grace Hopper' })).toBeInTheDocument();
    await expect(canvas.getByText('Cancelled')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Site visit' }));
    await expect(args.onOpen).toHaveBeenCalledWith('alan', expect.any(HTMLElement));
    // Each title says which meeting it opens: its time and who it is with describe it.
    await expect(canvas.getByRole('button', { name: 'Quick chat' })).toHaveAccessibleDescription(
      /4:00 – 4:30 PM.*You and Grace Hopper/,
    );
    // A press anywhere on the row opens it, but its own actions stay their own.
    await userEvent.click(canvas.getByText('4:00 – 4:30 PM'));
    await expect(args.onOpen).toHaveBeenLastCalledWith('grace', expect.any(HTMLElement));
    const opened = args.onOpen.mock.calls.length;
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }));
    await expect(args.onOpen).toHaveBeenCalledTimes(opened);
    // The pointer leaves the title for the empty page, so the shot never catches its hover.
    await userEvent.hover(canvasElement);
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

/** A colleague's bookings (an admin's view of a team page): the host is named in place of "You", and one needs a host. */
export const Colleagues: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingList
        {...args}
        groups={groups().map((group) => ({
          ...group,
          rows: group.rows.map((row) => ({
            ...row,
            hostName: 'Sam Lee',
            badge: 'Needs a host',
            badgeTone: 'accent' as const,
          })),
        }))}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(/^Sam Lee and/u)).toHaveLength(2);
    await expect(canvas.queryByText(/^You and/u)).not.toBeInTheDocument();
  },
};

/** Home's Today, in its Card: the card is the frame; one day's bookings and the member's own events, the time in a narrow date column; an event has no guest, so no "You and" line; an all day event has no length. */
export const Agenda: Story = {
  render: (args) => (
    <Stage width="fill">
      <Card title="Today">
        <BookingList
          {...args}
          label="Today"
          placement="card"
          groups={[
            {
              id: 'earlier',
              label: 'Earlier',
              rows: [{ id: 'standup', date: '9:00 AM', time: '15 min', title: 'Team standup' }],
            },
            {
              id: 'next',
              label: 'Coming up',
              rows: [
                { id: 'offsite', date: 'All day', time: '', title: 'Offsite' },
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
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // The who line is one element holding "You and" and the guest's name.
    await expect(canvas.getAllByText(/^You and/)).toHaveLength(1);
    await expect(canvas.getByRole('button', { name: 'Team standup' })).toBeInTheDocument();
    await expect(canvas.getByText('All day')).toBeInTheDocument();
  },
};

/** Home's Today on a phone: under 320px of card the time sits above the meeting. */
export const AgendaNarrow: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Card title="Today">
        <BookingList
          {...args}
          label="Today"
          placement="card"
          groups={[
            {
              id: 'next',
              label: 'Coming up',
              rows: [{ id: 'grace', date: '4:00 PM', time: '30 min', title: 'Quick chat', guestName: 'Grace Hopper' }],
            },
          ]}
        />
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Quick chat' })).toBeInTheDocument();
  },
};

/** Every meeting: a booking with its link's tag, and synced calendar events with their calendar and attendees. */
export const Meetings: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingList
        {...args}
        label="Upcoming meetings"
        groups={[
          {
            id: '2026-10-08',
            label: 'Today',
            rows: [
              {
                id: 'b1',
                date: 'Thu, 8 Oct',
                time: '9:00 – 9:30 AM',
                title: 'Intro call',
                guestName: 'Grace Hopper',
              },
              {
                id: 'e1',
                date: 'Thu, 8 Oct',
                time: '1:00 – 2:00 PM',
                title: 'Pipeline sync',
                calendar: { name: 'Team', hue: 'green' },
                attendees: ['cy@globex.com', 'di@globex.com'],
                moreAttendees: 3,
              },
            ],
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Named with whoever hosts it: "You and Grace Hopper".
    await expect(canvas.getByText(/and Grace Hopper$/)).toBeInTheDocument();
    await expect(canvas.getByText('cy@globex.com, di@globex.com and 3 more')).toBeInTheDocument();
    await expect(canvas.getByText('Team')).toBeInTheDocument();
  },
};
