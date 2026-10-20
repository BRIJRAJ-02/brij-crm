import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { VisitorBar } from './VisitorBar.tsx';

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' };

const meta = {
  title: 'Modules/VisitorBar',
  component: VisitorBar,
  args: { connectHref: '/api/public/booking/abcdefghijklmnop/connect?return=%2Fb%2Fabcdefghijklmnop' },
  render: (args) => (
    <Stage width="fill">
      <VisitorBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof VisitorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A visitor we don't know: connect a calendar to see when you're both free. */
export const Invite: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText('See when you’re both free')).toBeVisible());
    await expect(canvas.getByRole('link', { name: 'Connect calendar' })).toHaveAttribute(
      'href',
      '/api/public/booking/abcdefghijklmnop/connect?return=%2Fb%2Fabcdefghijklmnop',
    );
  },
};

/** Their calendar is on: only times you're both free, and Show all times. */
export const BothFree: Story = {
  args: { person: ADA, calendar: 'on', onNotYou: fn() },
  render: function Render(args) {
    const [showAll, setShowAll] = useState(false);
    return (
      <Stage width="fill">
        <VisitorBar {...args} showAll={showAll} onShowAllChange={setShowAll} />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    await waitFor(() => expect(canvas.getByText('Showing times you’re both free')).toBeVisible());
    await userEvent.click(canvas.getByRole('switch', { name: 'Show all times' }));
    await waitFor(() => expect(canvas.getByText('Showing all times, yours that clash marked busy')).toBeVisible());
    await userEvent.click(canvas.getByRole('button', { name: 'Not you?' }));
    await expect(args.onNotYou).toHaveBeenCalledOnce();
  },
};

/** Signed in, with no calendar connected: who they're booking as. */
export const Known: Story = {
  args: { person: ADA, calendar: 'none', onNotYou: fn() },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText('Booking as Ada Lovelace')).toBeVisible());
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};

/** Their calendar couldn't be read: every time shows, and a guest may connect again. */
export const Unreachable: Story = {
  args: { person: ADA, calendar: 'unreachable', onNotYou: fn() },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText('Couldn’t read your calendar. Showing all times.')).toBeVisible());
    await waitFor(() => expect(canvas.getByRole('link', { name: 'Connect again' })).toBeVisible());
  },
};

/** A signed in visitor's calendar refuses us until they reconnect it. */
export const NeedsReconnect: Story = {
  args: { person: ADA, calendar: 'needs-reconnect', onNotYou: fn(), connectHref: undefined },
};

/** On a phone: the controls drop under the words. */
export const Narrow: Story = {
  args: { person: ADA, calendar: 'on', onNotYou: fn(), onShowAllChange: fn() },
  parameters: { crm: { screenshot: true } },
  render: (args) => (
    <Stage width="narrow">
      <VisitorBar {...args} />
    </Stage>
  ),
};
