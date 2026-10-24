import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import type { Slot } from '../SlotList/SlotList.tsx';
import { MatchCalendar, MatchCalendarCta, type MatchCalendarProps } from './MatchCalendar.tsx';

const HOST = { name: 'Grace Hopper' };
const ADA = { name: 'Ada Lovelace' };
const CONNECT = '/api/public/booking/abcdefghijklmnop/connect?return=%2Fb%2Fabcdefghijklmnop';

const slot = (id: string, label: string): Slot => ({
  id,
  label,
  name: `${label}, Tue 20 Oct, 30 minutes`,
});

const BEST = { ...slot('2026-10-20T09:30:00.000Z', '9:30 AM'), isBest: true };
const FIRST = slot('2026-10-20T19:00:00.000Z', '7:00 PM');
const RESULT = {
  count: 7,
  best: BEST,
  when: '9:30 AM on Tue 20 Oct',
  days: [
    {
      day: 'Tue 20 Oct',
      times: [slot('2026-10-20T11:00:00.000Z', '11:00 AM'), slot('2026-10-20T14:00:00.000Z', '2:00 PM')],
    },
    { day: 'Wed 21 Oct', times: [slot('2026-10-21T10:00:00.000Z', '10:00 AM')] },
  ],
};

const meta = {
  title: 'Modules/MatchCalendar',
  component: MatchCalendar,
  args: {
    step: 'why',
    isOpen: true,
    onOpenChange: fn(),
    host: HOST,
    connectHref: CONNECT,
  },
  render: (args) => (
    <Stage width="fill">
      <MatchCalendar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof MatchCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page's call to action, above the card: the row's width, with one quiet line under it. */
export const Cta: StoryObj<MatchCalendarProps> = {
  render: function Render() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <Stage width="fill">
        <MatchCalendarCta
          onPress={() => {
            setIsOpen(true);
          }}
        />
        <MatchCalendar step="why" isOpen={isOpen} onOpenChange={setIsOpen} host={HOST} connectHref={CONNECT} />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Match with your calendar' }));
    await expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', CONNECT);
  },
};

/**
 * Why, before Google: what it does, and that free or busy is all it reads.
 * The artifact's preview, since a preview draws with React as a browser global and so may hold no state of its own.
 */
export const Why: Story = {
  parameters: { crm: { preview: true } },
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await expect(dialog).toHaveTextContent('times you’re both free');
    await expect(dialog).toHaveTextContent('never what’s on your calendar');
  },
};

/** Waiting: the two of them side by side while their calendars are matched. */
export const Waiting: Story = {
  args: { step: 'waiting' },
  play: async () => {
    await waitFor(async () => {
      await expect(await screen.findByRole('status')).toHaveTextContent('Matching your calendars');
    });
  },
};

/** Matched: the best time, offered, with how many matched and why this one is first. */
export const Matched: Story = {
  args: { step: 'matched', visitor: ADA, result: RESULT, onBook: fn() },
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog');
    await expect(dialog).toHaveTextContent('You’re both free at 9:30 AM on Tue 20 Oct. Shall we book it?');
    await expect(dialog).toHaveTextContent('7 times matched.');
    await expect(dialog).toHaveTextContent('with a gap either side');
    // Every step offers a way to say no, not only the header's close button.
    await expect(await screen.findByRole('button', { name: /Not now/ })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Book this time' }));
    await expect(args.onBook).toHaveBeenCalledWith(BEST.id);
  },
};

/** The other matching times, revealed in the dialog and bookable where they stand. */
export const OtherTimes: Story = {
  args: { step: 'matched', visitor: ADA, result: RESULT, onBook: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'See the other times' }));
    const times = await screen.findByRole('group', { name: 'The next matching times' });
    // The button went with its press, so focus is on the first time it drew.
    await waitFor(() => expect(document.activeElement).toHaveTextContent('11:00 AM'));
    // The list and the dialog around it both enter with `both` fill, and the runner holds a paused
    // animation at its first frame, opacity 0. Settle the whole page, not just this subtree: the
    // Modal's root and scrim are ancestors, and an invisible ancestor hides a settled child.
    await settleAnimations();
    await expect(times).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: /2:00 PM/ }));
    await expect(args.onBook).toHaveBeenCalledWith('2026-10-20T14:00:00.000Z');
  },
};

/** The call to action's space, held while the page asks who the visitor is: nothing under it moves. */
export const CtaHolding: StoryObj<MatchCalendarProps> = {
  render: () => (
    <Stage width="fill">
      <MatchCalendarCta isLoading onPress={() => undefined} />
    </Stage>
  ),
};

/** No time passed the Best tests: the first shared one is offered without the claim. */
export const SoonestOnly: Story = {
  args: {
    step: 'matched',
    visitor: ADA,
    result: { count: 3, best: FIRST, when: '7:00 PM on Tue 20 Oct' },
    onBook: fn(),
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await expect(dialog).toHaveTextContent('This is the soonest time you’re both free.');
    await expect(dialog).not.toHaveTextContent('with a gap either side');
  },
};

/** One match only: "One time matched", not "1 times matched". */
export const OneMatch: Story = {
  args: {
    step: 'matched',
    visitor: ADA,
    result: { count: 1, best: BEST, when: '9:30 AM on Tue 20 Oct' },
    onBook: fn(),
  },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toHaveTextContent('One time matched.');
    await expect(screen.queryByRole('button', { name: 'See the other times' })).toBeNull();
  },
};

/** Nothing matched: say so, and send the visitor back to the page's own times. */
export const Unmatched: Story = {
  args: { step: 'unmatched', visitor: ADA, onShowAll: fn() },
  play: async ({ args }) => {
    await expect(await screen.findByRole('dialog')).toHaveTextContent('no open time in common');
    await userEvent.click(await screen.findByRole('button', { name: 'Show all times' }));
    await expect(args.onShowAll).toHaveBeenCalledOnce();
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

/** The calendar couldn't be read: nothing was saved, and Google is one press away again. */
export const Failed: Story = {
  args: { step: 'failed' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toHaveTextContent('couldn’t read your calendar');
    await expect(await screen.findByRole('link', { name: 'Try again' })).toHaveAttribute('href', CONNECT);
  },
};

/** The keyboard path: Tab reaches the call to action, Enter opens it, Esc leaves every state. */
export const Keyboard: StoryObj<MatchCalendarProps> = {
  parameters: { crm: { screenshot: false } },
  render: function Render() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <Stage width="fill">
        <MatchCalendarCta
          onPress={() => {
            setIsOpen(true);
          }}
        />
        {/* Waiting is the state a visitor must never be stuck in: Esc still leaves it. */}
        <MatchCalendar step="waiting" isOpen={isOpen} onOpenChange={setIsOpen} host={HOST} connectHref={CONNECT} />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const cta = canvas.getByRole('button', { name: 'Match with your calendar' });
    await userEvent.tab();
    await expect(cta).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(cta).toHaveFocus());
  },
};
