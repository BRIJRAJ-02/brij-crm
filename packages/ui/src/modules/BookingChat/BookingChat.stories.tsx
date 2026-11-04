import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
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
    text: 'Hi, I’m Ada. When suits you for a 30 min Intro call?',
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
  args: { lines: [], host: { name: 'Ada Lovelace', label: 'Ada' }, onSend: fn(), onPickTime: fn() },
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
    // The answered offers stay as the record: the picked time marked, the rest no longer take a press.
    await expect(canvas.getByRole('button', { name: '9:30 AM, Fri 9 Oct, 30 minutes, picked' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await userEvent.click(canvas.getByRole('button', { name: '9:00 AM, Mon 12 Oct, 30 minutes' }));
    await expect(args.onPickTime).toHaveBeenCalledTimes(1);
  },
};

/** A few turns: the visitor's lines at the end edge, and the read back with its two answers. */
export const ReadBack: Story = {
  render: function Render(args) {
    const [lines] = useState<readonly BookingChatLine[]>(() => [
      greeting(),
      { id: 'v1', role: 'visitor', text: 'tomorrow at 3pm' },
      { id: 'a1', role: 'assistant', text: 'Great, tomorrow at 3:00 PM it is. What’s your name and email?' },
      { id: 'v2', role: 'visitor', text: 'Grace Hopper, grace@example.com' },
      {
        id: 'a2',
        role: 'assistant',
        text: 'Tomorrow at 3:00 PM, 30 min, for Grace Hopper (grace@example.com). Shall I book it?',
        suggestions: ['Yes, book it', 'Something else'],
        confirm: 'Yes, book it',
        card: {
          weekday: 'Fri',
          day: '9',
          month: 'Oct',
          title: 'Intro call with Ada Lovelace',
          when: 'Friday, 9 October 2026 · 3:00 – 3:30 PM',
          who: 'Grace Hopper · grace@example.com',
        },
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

/** A turn is out: the host typing (three dots in their bubble), and the field holds. */
export const Waiting: Story = {
  args: { isWaiting: true },
  render: (args) => (
    <Stage width="fill">
      <BookingChat {...args} lines={[greeting(), { id: 'v1', role: 'visitor', text: 'next tuesday afternoon' }]} />
    </Stage>
  ),
  play: async ({ canvas }) => {
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
    // The notice drops in with its height, held at its first frame while stories pause animations.
    await settleAnimations();
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

/**
 * The page's times are loading: the chat's own shape (BookingChatGhost), the greeting's bubble, a day's times and
 * the prompt box, where the chat puts them, not two bars in an empty card (4 November 2026).
 */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect(canvas.queryByRole('textbox')).toBeNull();
    // The bubble, the day's label, six times and the prompt box.
    await expect(
      canvasElement.querySelectorAll('[aria-busy="true"] [aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(9);
  },
};

/** After a time is held, the prompt box asks for exactly what the chat waits on (the reply's `prompt`), not "When". */
export const AsksForDetails: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[
          greeting(),
          { id: 'v1', role: 'visitor', text: 'Fri 9 Oct at 9:30 AM' },
          {
            id: 'a1',
            role: 'assistant',
            text: 'Great, Fri 9 Oct at 9:30 AM it is. What’s your name and email?',
            prompt: 'Your name and email',
            answer: 'name',
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // The box is named by the question it answers, and fills in a name.
    const field = canvas.getByRole('textbox', { name: 'Your name and email' });
    await expect(field).toHaveAttribute('placeholder', 'Your name and email');
    await expect(field).toHaveAttribute('autocomplete', 'name');
    // Send is always there, quiet until there is something to send, then the accent.
    const send = canvas.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await userEvent.type(field, 'Grace Hopper, grace@example.com');
    await expect(send).toBeEnabled();
    await expect(send).toHaveAttribute('data-variant', 'primary');
  },
};

/** Nothing open: the greeting says so, with no times or suggestions. */
export const NoTimes: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[{ id: 'greet', role: 'assistant', text: 'I’m fully booked right now. Check back soon.' }]}
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
            text: 'You’re booked. See you tomorrow at 3:00 PM. Details are on their way to grace@example.com.',
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

/** Chat parity (4 Nov 2026): a page with several lengths shows them as chips under the greeting, picked to its default. */
export const Lengths: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[
          {
            ...greeting(),
            choice: {
              label: 'Meeting length',
              options: [
                { id: '15', label: '15 min' },
                { id: '30', label: '30 min' },
                { id: '60', label: '60 min' },
              ],
              selected: '30',
            },
          },
        ]}
      />
    </Stage>
  ),
  args: { onChoose: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '60 min' }));
    await expect(args.onChoose).toHaveBeenCalledWith('60');
  },
};

/** Once the time, name and email are in, the page's own "anything else" row: a guest, a note, an optional question. */
export const Extras: Story = {
  render: (args) => (
    <Stage width="fill">
      <BookingChat
        {...args}
        lines={[
          greeting(),
          { id: 'v1', role: 'visitor', text: 'Fri at 9:30, Grace Hopper, grace@example.com' },
          {
            id: 'p1',
            role: 'assistant',
            text: 'Anything else before I book it?',
            suggestions: ['Add a guest', 'Add a note', 'Your role', 'That’s all'],
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add a guest' }));
    await expect(args.onSend).toHaveBeenCalledWith('Add a guest');
  },
};
