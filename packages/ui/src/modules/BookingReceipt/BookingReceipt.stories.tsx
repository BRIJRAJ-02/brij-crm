import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { GuestLook } from '../GuestLook/GuestLook.tsx';
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

/**
 * The booked moment (the v5 mock, `headline`): the check lands over "You're booked", who will see you and where the
 * details went, then the card: the whole time and its zone, What, Who and Where, Join the call across it, and Add to
 * calendar and Share quiet under it.
 */
export const BookedMoment: Story = {
  args: {
    headline: { when: 'Friday 9 October, 9:30 – 10:00 AM', meta: 'London time (GMT+1) · tomorrow morning' },
    sentTo: 'grace@example.com',
    facts: [
      { term: 'What', description: 'Intro call with Ada Lovelace, 30 min' },
      { term: 'Who', description: 'Grace Hopper', address: 'grace@example.com' },
    ],
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'You’re booked' })).toHaveFocus();
    await settleAnimations();
    await expect(canvas.getByText('We sent the details to grace@example.com.')).toBeVisible();
    await expect(canvas.getByText('Friday 9 October, 9:30 – 10:00 AM')).toBeVisible();
    const join = canvas.getByRole('link', { name: /Join the call/ });
    await expect(join).toBeVisible();
    // The one action wears the page's accent (the light theme's #2457e6 here), not the app's ink primary (spec 0072).
    await expect(getComputedStyle(join).backgroundColor).toBe('rgb(36, 87, 230)');
    await userEvent.click(canvas.getByRole('button', { name: 'Add to calendar' }));
    await expect(await screen.findByRole('menuitem', { name: /Apple Calendar/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  },
};

/** Opened again later from the email: the same card, without the celebration. */
export const Returning: Story = {
  args: {
    ...BookedMoment.args,
    isWelcome: false,
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Your booking' })).toBeInTheDocument();
    await expect(canvas.queryByText(/We sent the details/)).toBeNull();
  },
};

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

/**
 * The booking page's last step (critic C1): drawn inside the page's own card right after Confirm, a section under the
 * frame's heading, with no ground, card or foot of its own.
 */
export const InTheBookingCard: Story = {
  args: { placement: 'card' },
  render: (args) => (
    <Stage width="narrow">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'You’re booked' })).toHaveFocus();
    await expect(canvasElement.querySelector('main')).toBeNull();
    await expect(timefixLinkTags(canvasElement)).toEqual([]);
  },
};

/** A long ended booking's link (B-13): its own heading, the time and title, and no guest details, which aren't kept. */
export const Ended: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    state: 'past',
    isWelcome: false,
    heading: 'This booking ended',
    facts: [],
    again: { label: 'Book again', href: '/b/abc' },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'This booking ended' })).toHaveFocus();
    await expect(canvas.queryByText('Who')).toBeNull();
  },
};

/** A restaurant's reservation (inside GuestLook, its token fallbacks here): the ink in place of the app's blue. */
export const MenuLook: Story = {
  render: (args) => (
    <GuestLook>
      <Stage width="fill" height="page">
        <BookingReceipt {...args} />
      </Stage>
    </GuestLook>
  ),
  play: async () => {
    await settleAnimations();
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
