import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { VisitorBar } from './VisitorBar.tsx';

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com' };
const CONNECT = '/api/public/booking/abcdefghijklmnop/connect?return=%2Fb%2Fabcdefghijklmnop';

const meta = {
  title: 'Modules/VisitorBar',
  component: VisitorBar,
  args: { connectHref: CONNECT },
  render: (args) => (
    <Stage width="fill">
      <VisitorBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof VisitorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A visitor we don't know: Connect calendar, small, at the end of the row. */
export const Invite: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Connect your calendar' })).toHaveAttribute('href', CONNECT);
  },
};

/** With a match: the same small Connect your calendar link opens the dialog first (spec 0058, AC-24). */
export const Match: Story = {
  render: function Render(args) {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <Stage width="fill">
        <VisitorBar
          {...args}
          match={{
            step: 'why',
            isOpen,
            onOpenChange: setIsOpen,
            host: { name: 'Grace Hopper' },
            connectHref: CONNECT,
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    // Small and secondary, never the row's width: booking stays the page's one ask.
    const link = canvas.getByRole('button', { name: 'Connect your calendar' });
    await expect(link).toHaveAttribute('data-variant', 'link');
    await userEvent.click(link);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.keyboard('{Escape}');
  },
};

/** A visitor we know reaches the same dialog from their own tag's menu. */
export const MatchFromMenu: Story = {
  args: { person: ADA, calendar: 'on', onNotYou: fn() },
  render: function Render(args) {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <Stage width="fill">
        <VisitorBar
          {...args}
          match={{
            step: 'matched',
            isOpen,
            onOpenChange: setIsOpen,
            host: { name: 'Grace Hopper' },
            visitor: ADA,
            result: {
              count: 4,
              best: { id: '2026-10-20T09:30:00.000Z', label: '9:30 AM', name: '9:30 AM, Tue 20 Oct, 30 minutes' },
              when: '9:30 AM on Tue 20 Oct',
            },
            onBook: fn(),
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'See matching times' }));
    await expect(await screen.findByRole('dialog')).toHaveTextContent('4 times matched.');
    await userEvent.keyboard('{Escape}');
  },
};

/** Their calendar is on: the tag opens a menu with Show all times and Not you. */
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
    const tag = canvas.getByRole('button', { name: /Ada Lovelace · Both free/ });
    await userEvent.click(tag);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Show all times/ }));
    await waitFor(() => expect(canvas.getByRole('button', { name: /Ada Lovelace · All times/ })).toBeVisible());
    await expect(canvas.getByRole('status')).toHaveTextContent('Showing all times. Busy ones are marked.');
    await userEvent.click(canvas.getByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Not you?' }));
    await expect(args.onNotYou).toHaveBeenCalledOnce();
  },
};

/** Signed in, with no calendar connected: just who they're booking as. */
export const Known: Story = {
  args: { person: ADA, calendar: 'none', onNotYou: fn() },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole('button', { name: /^Ada Lovelace/ })).toBeVisible());
  },
};

/** Their calendar couldn't be read: every time shows, and a guest may connect again from the menu. */
export const Unreachable: Story = {
  args: { person: ADA, calendar: 'unreachable', onNotYou: fn() },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Calendar unavailable/ }));
    const again = await screen.findByRole('menuitem', { name: 'Connect your calendar again' });
    await waitFor(() => expect(again).toBeVisible());
    await userEvent.keyboard('{Escape}');
  },
};

/** A signed in visitor's calendar refuses us until they reconnect it. */
export const NeedsReconnect: Story = {
  args: { person: ADA, calendar: 'needs-reconnect', onNotYou: fn(), connectHref: undefined },
};

/** While the page asks who the visitor is: the tag's space, held. */
export const Loading: Story = {
  args: { isLoading: true },
};
