import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { timefixLinkTags, timefixTags } from '../../workbench/timefix-links.ts';
import { BookingReceipt } from './BookingReceipt.tsx';

const meta = {
  title: 'Modules/BookingReceipt',
  component: BookingReceipt,
  args: {
    state: 'confirmed',
    isWelcome: true,
    hostName: 'Ada Lovelace',
    date: { weekday: 'Fri', day: '9', month: 'Oct' },
    range: '9:30 – 10:00 AM',
    when: 'Friday, October 9, 2026 · London time (GMT+1)',
    relative: 'Tomorrow morning',
    summary: { what: 'Intro call', who: 'with Ada Lovelace' },
    facts: [
      { term: 'Who', description: 'Grace Hopper', address: 'grace@example.com' },
      { term: 'Where', description: 'Video call' },
    ],
    joinUrl: 'https://meet.google.com/abc-defg-hij',
    calendars: {
      google: 'https://calendar.google.com/calendar/render',
      outlook: 'https://outlook.live.com/calendar/0/deeplink/compose',
      ics: '/booking.ics',
    },
    share: {
      title: 'Intro call with Ada Lovelace',
      lines: [
        'Intro call with Ada Lovelace',
        'Friday, October 9, 2026, 9:30 – 10:00 AM',
        'London time (GMT+1)',
        'Video call',
      ],
      calendarUrl: 'https://calendar.google.com/calendar/render',
    },
  },
} satisfies Meta<typeof BookingReceipt>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Right after booking: "You're booked" and one warm line, then the summary with Join the call and Add to calendar. */
export const Welcome: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'You’re booked' })).toHaveFocus();
    // The heading and its line rise in: let them land before reading them.
    await settleAnimations();
    await expect(canvas.getByText('Ada Lovelace will see you then.')).toBeVisible();
    // The summary leads (spec 0058, AC-19): what and who over the time, and the one action right with it.
    const card = canvas.getByRole('article', { name: 'Confirmed' });
    await expect(card).toHaveTextContent(/^Fri9OctIntro callwith Ada Lovelace9:30 – 10:00 AM/);
    await expect(canvas.getByRole('link', { name: 'Join the call' })).toHaveAttribute('target', '_blank');
    // With no brand of its own, the foot's Timefix link is tagged as the page just after booking.
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_confirmation', 'footer_logo')]);
  },
};

/** Cancelled: the time struck through, and a way to book again. */
export const Cancelled: Story = {
  args: {
    state: 'cancelled',
    isWelcome: false,
    again: { label: 'Book another time with Ada Lovelace', href: '/b/abc' },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    // Opened again later, the foot's Timefix link is tagged as the guest's page.
    await expect(timefixLinkTags(canvasElement)).toEqual([timefixTags('booking_manage', 'footer_logo')]);
  },
};

/** A request right after it was made (spec 0062, AC-6203): no call or calendar entry until the host confirms it. */
export const Requested: Story = {
  args: { state: 'requested', isWelcome: true },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: 'Join the call' })).toBeNull();
  },
};

/** A request the host declined, or that ran out of time: a way to book another time. */
export const Declined: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    state: 'declined',
    isWelcome: false,
    again: { label: 'Book another time with Ada Lovelace', href: '/b/abc' },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'This request was declined' })).toBeInTheDocument();
  },
};

/** Passed. */
export const Past: Story = {
  parameters: { crm: { screenshot: false } },
  args: { state: 'past', isWelcome: false, again: { label: 'Book again', href: '/b/abc' } },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
};

/** A file fetched when pressed (a table reservation's, spec 0066 B7): the Apple button runs it, no address holds it. */
export const IcsOnPress: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    isWelcome: false,
    calendars: {
      google: 'https://calendar.google.com/calendar/render',
      outlook: 'https://outlook.live.com/calendar/0/deeplink/compose',
      ics: fn(),
    },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Apple/ }));
    await expect(args.calendars?.ics).toHaveBeenCalledTimes(1);
  },
};

/** The guest's own pages tag the wordmark themselves and open it in a new tab, in the same foot as every public page. */
export const WithBrand: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    brand: { href: 'https://www.timefix.com/?utm_source=timefix', label: 'Powered by Timefix (opens in a new tab)' },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Powered by Timefix (opens in a new tab)' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
};

/** Share: one quiet button at the end of Add to calendar, opening the meeting in two lines with Copy details. */
export const Sharing: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Share' }));
    const panel = await screen.findByRole('dialog', { name: 'Share this meeting' });
    await expect(within(panel).getByText('Intro call with Ada Lovelace')).toBeInTheDocument();
    await expect(within(panel).getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
  },
};
