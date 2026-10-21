import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingChat, type BookingChatLine } from './BookingChat.tsx';

/** A day's offered times, built inside each story so previews stay cheap. */
function times(day: string, labels: readonly string[]) {
  return {
    day,
    times: labels.map((label) => ({ id: `${day} ${label}`, label, name: `${label}, ${day}, 30 minutes` })),
  };
}

function greeting(): BookingChatLine {
  return {
    id: 'greet',
    role: 'assistant',
    text: 'Hi! I book Ada’s Intro call (30 min). Tell me roughly when suits, “tomorrow afternoon” is enough, or tap a time.',
    days: [
      times('Fri 9 Oct', ['9:00 AM', '9:30 AM', '10:00 AM']),
      times('Mon 12 Oct', ['9:00 AM', '9:30 AM', '10:00 AM']),
    ],
    suggestions: ['Something later', 'Next week'],
  };
}

const meta = {
  title: 'Modules/BookingChat',
  component: BookingChat,
  args: { lines: [], onSend: fn(), onPickTime: fn() },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} />
    </Stage>
  ),
} satisfies Meta<typeof BookingChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The greeting with the soonest times and two suggestions; a time, a suggestion and Enter each reach the page. */
export const Greeting: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting()]} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('log', { name: 'Conversation' })).toBeVisible();
    // Lines fade in as they arrive.
    await waitFor(() => expect(canvas.getByRole('group', { name: 'Times on Fri 9 Oct' })).toBeVisible());
    await userEvent.click(canvas.getByRole('button', { name: '9:30 AM, Fri 9 Oct, 30 minutes' }));
    await expect(args.onPickTime).toHaveBeenCalledWith('Fri 9 Oct 9:30 AM');
    await userEvent.click(canvas.getByRole('button', { name: 'Next week' }));
    await expect(args.onSend).toHaveBeenCalledWith('Next week');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
    const field = canvas.getByRole('textbox', { name: 'Message' });
    await userEvent.type(field, 'tuesday afternoon{Enter}');
    await expect(args.onSend).toHaveBeenCalledWith('tuesday afternoon');
    await expect(field).toHaveValue('');
    await expect(field).toHaveFocus();
  },
};

/** A few turns: the visitor's lines at the end edge, and the read back with its two answers. */
export const ReadBack: Story = {
  render: function Render(args) {
    const [lines] = useState<readonly BookingChatLine[]>(() => [
      greeting(),
      { id: 'v1', role: 'visitor', text: 'tomorrow at 3pm' },
      { id: 'a1', role: 'assistant', text: 'Great, tomorrow at 3:00 PM it is. What’s your name and email?' },
      { id: 'v2', role: 'visitor', text: 'Ada Lovelace, ada@example.com' },
      {
        id: 'a2',
        role: 'assistant',
        text: 'Tomorrow at 3:00 PM, 30 minutes, for Ada Lovelace (ada@example.com). Shall I book it?',
        suggestions: ['Yes, book it', 'Something else'],
      },
    ]);
    return (
      <Stage width="fill">
        <BookingChat {...args} lines={lines} />
      </Stage>
    );
  },
  play: async ({ canvas, args }) => {
    // Only the last reply's buttons are live: the greeting's times are gone.
    await expect(canvas.queryByRole('group', { name: 'Times on Fri 9 Oct' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, book it' }));
    await expect(args.onSend).toHaveBeenCalledWith('Yes, book it');
  },
};

/** A turn is out: a spinner line, and the field holds. */
export const Waiting: Story = {
  args: { isWaiting: true },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'next tuesday afternoon' }]} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole('progressbar', { name: 'Finding times' })).toBeVisible());
    await expect(canvas.queryByRole('group', { name: 'Times on Fri 9 Oct' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

/** A turn failed: the reason, with Try again. */
export const Failed: Story = {
  args: { error: 'You’re offline. Check your connection and try again.', onRetry: fn() },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'tomorrow' }]} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

/** Booked: the last reply stays, and the field and buttons are done. */
export const Done: Story = {
  args: { isDone: true },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[
          { id: 'v1', role: 'visitor', text: 'Yes, book it' },
          {
            id: 'a1',
            role: 'assistant',
            text: 'Done. You’re booked for tomorrow at 3:00 PM. The details are on their way to ada@example.com.',
            suggestions: ['Something later'],
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Message' })).toBeDisabled());
    await expect(canvas.queryByRole('button', { name: 'Something later' })).toBeNull();
  },
};
