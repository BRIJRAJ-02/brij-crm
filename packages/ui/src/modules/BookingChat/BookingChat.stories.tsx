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
    text: 'I can book your 30 minute Intro call with Ada. When works for you? Type something like “tomorrow afternoon”, or pick a time below.',
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
    await waitFor(() => expect(canvas.getByRole('list', { name: 'Times on Fri 9 Oct' })).toBeVisible());
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
    // A pressed time sends, and focus goes to the field for the next answer.
    await userEvent.click(canvas.getByRole('button', { name: '9:00 AM, Mon 12 Oct, 30 minutes' }));
    await waitFor(() => expect(field).toHaveFocus());
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
  play: async ({ canvas, canvasElement, args }) => {
    // Only the last reply's buttons are live: the greeting's times are gone.
    await expect(canvas.queryByRole('list', { name: 'Times on Fri 9 Oct' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, book it' }));
    await expect(args.onSend).toHaveBeenCalledWith('Yes, book it');
    // The pointer leaves the chip for the empty page, so the shot never catches its hover.
    await userEvent.hover(canvasElement);
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
    await waitFor(() => expect(canvas.getByRole('progressbar')).toBeVisible());
    await expect(canvas.getByRole('log')).toHaveTextContent('One moment');
    await expect(canvas.queryByRole('list', { name: 'Times on Fri 9 Oct' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

/** A turn failed: the reason, with Try again. */
export const Failed: Story = {
  args: { error: { message: 'You’re offline. Check your connection and try again.', onRetry: fn() } },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'tomorrow' }]} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.error?.onRetry).toHaveBeenCalledOnce();
  },
};

/** Too many at once: a pause, said as a warning, with Try again. */
export const Paused: Story = {
  args: {
    error: { message: 'That was a lot at once. Give it a few seconds and try again.', onRetry: fn(), isPause: true },
  },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'tomorrow' }]} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** The chat can't go on (too long): Start over clears it. */
export const StartOver: Story = {
  args: { error: { message: 'This chat is too long to go on.', onRestart: fn() } },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'tomorrow' }]} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Start over' }));
    await expect(args.error?.onRestart).toHaveBeenCalledOnce();
  },
};

/** The page's times are loading: a skeleton, and Send waits. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('log')).toHaveTextContent('Loading times');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

/** Nothing open: the greeting says so, with no times or suggestions. */
export const NoTimes: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[{ id: 'greet', role: 'assistant', text: 'Ada has nothing open right now. Check back soon.' }]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('list')).toBeNull();
    await expect(canvas.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  },
};

/** Booked: the last reply stays, and the field and buttons are done. */
export const Done: Story = {
  args: { isDone: true, doneNote: 'Booked. Opening your booking.' },
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
