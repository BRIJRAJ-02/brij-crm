import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
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
    facts: [
      { term: 'What', description: 'Intro call' },
      { term: 'Who', description: 'Ada Lovelace (host), Grace Hopper' },
      { term: 'Where', description: 'Video call' },
    ],
    joinUrl: 'https://meet.google.com/abc-defg-hij',
    calendars: {
      google: 'https://calendar.google.com/calendar/render',
      outlook: 'https://outlook.live.com/calendar/0/deeplink/compose',
      ics: '/booking.ics',
    },
  },
} satisfies Meta<typeof BookingReceipt>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Right after booking: "You're booked", Join the call and Add to calendar. */
export const Welcome: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill" height="page">
      <BookingReceipt {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'You’re booked' })).toHaveFocus();
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

/** The guest's own pages end as the hosted form does: the Timefix wordmark alone, opening in a new tab. */
export const WithBrand: Story = {
  parameters: { crm: { screenshot: false } },
  args: { brand: { href: 'https://www.timefix.com/?utm_source=timefix', label: 'Powered by Timefix (opens in a new tab)' } },
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
