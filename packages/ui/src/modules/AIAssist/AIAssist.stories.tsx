import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within, type Mock } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { AIAssist, type AIAssistProps } from './AIAssist.tsx';

const SUMMARY =
  'Acme Corp is a London logistics software company with about 1,240 people. They are Qualified: Sam ran a 45 minute ' +
  'demo on Tuesday, and Priya is preparing pricing for a one-depot pilot in Leeds.';

/** An answer the story writes piece by piece: `push` hands the panel a piece, `end` finishes it, `fail` breaks it. */
function channel() {
  const queue: string[] = [];
  const state = {
    isEnded: false,
    failure: undefined as Error | undefined,
    wake: undefined as (() => void) | undefined,
  };
  const nudge = () => {
    const wake = state.wake;
    state.wake = undefined;
    wake?.();
  };
  const pieces: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (state.failure !== undefined) throw state.failure;
        if (state.isEnded) return;
        await new Promise<void>((resolve) => {
          state.wake = resolve;
        });
      }
    },
  };
  return {
    pieces,
    push: (...more: string[]) => {
      queue.push(...more);
      nudge();
    },
    end: () => {
      state.isEnded = true;
      nudge();
    },
    fail: () => {
      state.failure = new Error('The model went away.');
      nudge();
    },
  };
}

const meta = {
  title: 'Modules/AIAssist',
  component: AIAssist,
  args: {
    context: 'Acme Corp',
    suggestions: ['Summarise this company', 'What changed this week?', 'Who should I talk to next?'],
    onAsk: fn(() => Promise.resolve(SUMMARY)),
    onSaveNote: fn(),
  },
  render: (args) => (
    <Stage width="dialog">
      <AIAssist {...args} />
    </Stage>
  ),
} satisfies Meta<typeof AIAssist>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The story's `onAsk`, as the mock `fn()` made it, so a play function can hand it an answer to write. */
function mockOf(onAsk: AIAssistProps['onAsk']): Mock<AIAssistProps['onAsk']> {
  return onAsk as Mock<AIAssistProps['onAsk']>;
}

/** The answer region, once a question is asked. */
function answerOf(canvasElement: HTMLElement): HTMLElement {
  const answer = canvasElement.querySelector<HTMLElement>('[role="region"] [aria-busy]');
  if (answer === null) throw new Error('no answer yet');
  return answer;
}

/** What the one status region says now. */
function said(canvasElement: HTMLElement): string {
  return canvasElement.querySelector('[role="status"]:not(:empty)')?.textContent ?? '';
}

/**
 * Before the first question: the start line, the suggestions as chips, the prompt with how to use it, and Ask off
 * until something is typed. The conversation scrolls from the keyboard.
 */
export const Start: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByRole('region', { name: 'Conversation' })).toHaveAttribute('tabindex', '0');
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveAccessibleDescription(
      'Enter to ask, Shift+Enter for a new line',
    );
    await expect(canvas.getByText('What do you want to know about Acme Corp?')).toBeVisible();
    const chips = within(canvas.getByRole('group', { name: 'Suggested questions' })).getAllByRole('button');
    await expect(chips.map((chip) => chip.textContent)).toEqual([
      'Summarise this company',
      'What changed this week?',
      'Who should I talk to next?',
    ]);
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveAttribute(
      'placeholder',
      'Ask about Acme Corp…',
    );
    await expect(canvas.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'New question' })).toBeNull();
  },
};

/** Thinking: the question, one status line (said once to screen readers), and Stop in Ask's place. */
export const Thinking: Story = {
  args: { onAsk: fn(() => new Promise<string>(() => undefined)) },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    await expect(args.onAsk).toHaveBeenCalledWith('Summarise this company', expect.any(AbortSignal));
    // The chip went with the start; focus moved on to the prompt rather than to the page.
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveFocus();
    await expect(canvas.getByText('Summarise this company', { selector: 'p' })).toHaveTextContent(
      'You asked: Summarise this company',
    );
    await expect(said(canvasElement)).toBe('Working on an answer');
    await expect(canvas.getByText('Reading the timeline')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Ask' })).toBeNull();
    await expect(canvas.queryByRole('group', { name: 'Suggested questions' })).toBeNull();
  },
};

/**
 * A whole answer: typed, Enter asks, the words show a few at a time, then Copy and Save as note. The prompt empties
 * as it asks, and Save as note hands over the whole answer.
 */
export const Answered: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const prompt = canvas.getByRole('textbox', { name: 'Ask a question' });
    await userEvent.click(prompt);
    await userEvent.keyboard('Summarise this company{Enter}');
    await expect(prompt).toHaveValue('');
    await expect(args.onAsk).toHaveBeenCalledWith('Summarise this company', expect.any(AbortSignal));
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent(SUMMARY), { timeout: 4000 });
    await expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false');
    await expect(said(canvasElement)).toBe('Answer ready');
    await settleAnimations();
    await expect(canvas.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Save as note' }));
    await expect(args.onSaveNote).toHaveBeenCalledWith(SUMMARY);
    // Done, so a new question can start over.
    await userEvent.click(canvas.getByRole('button', { name: 'New question' }));
    await expect(canvas.getByRole('group', { name: 'Suggested questions' })).toBeInTheDocument();
    await expect(prompt).toHaveFocus();
  },
};

/** Shift+Enter breaks the line; Enter asks the whole question, line breaks and all. */
export const MultilineQuestion: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Ask a question' }));
    await userEvent.keyboard('Who signs?{Shift>}{Enter}{/Shift}And when?');
    await expect(args.onAsk).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await expect(args.onAsk).toHaveBeenCalledWith('Who signs?\nAnd when?', expect.any(AbortSignal));
  },
};

/** An answer written piece by piece: drawn as it arrives, busy for screen readers until it is whole. */
export const Streaming: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const answer = channel();
    mockOf(args.onAsk).mockImplementation(() => answer.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'What changed this week?' }));
    answer.push('Stage moved ', 'from Lead ', 'to Qualified.');
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent('Stage moved from Lead to Qualified.'));
    await expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy' })).toBeNull();
    // Stop has focus as the answer ends on its own: focus moves to the prompt, not to the page.
    canvas.getByRole('button', { name: 'Stop' }).focus();
    answer.push(' A demo is booked for Thursday.');
    answer.end();
    await waitFor(() => expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false'));
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveFocus();
    await expect(answerOf(canvasElement)).toHaveTextContent(
      'Stage moved from Lead to Qualified. A demo is booked for Thursday.',
    );
    await expect(canvas.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  },
};

/** Stop ends an answer where it got to: the words so far stay, marked Stopped, and the question's signal aborts. */
export const Stopped: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const answer = channel();
    mockOf(args.onAsk).mockImplementation(() => answer.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'Who should I talk to next?' }));
    answer.push('Priya Raman is the champion, ');
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent('Priya Raman is the champion,'));
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }));
    const signal = mockOf(args.onAsk).mock.calls[0]?.[1];
    await expect(signal?.aborted).toBe(true);
    // What arrives after Stop is never drawn.
    answer.push('and Maria Bell signs.');
    await expect(answerOf(canvasElement)).toHaveTextContent('Priya Raman is the champion, Stopped.');
    await expect(answerOf(canvasElement)).not.toHaveTextContent('Maria Bell');
    await expect(canvas.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveFocus();
    await expect(said(canvasElement)).toBe('Stopped.');
  },
};

/** An answer that didn't come: one line says so, and Try again asks the same question again. */
export const Failed: Story = {
  args: { onAsk: fn(() => Promise.reject(new Error('The model went away.'))) },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    await expect(await canvas.findByText('Couldn’t get an answer. Try again.')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy' })).toBeNull();
    await expect(canvas.getByRole('alert')).toHaveTextContent('Couldn’t get an answer. Try again.');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.getByRole('textbox', { name: 'Ask a question' })).toHaveFocus();
    await expect(args.onAsk).toHaveBeenCalledTimes(2);
    await expect(args.onAsk).toHaveBeenLastCalledWith('Summarise this company', expect.any(AbortSignal));
  },
};

/** A stream that breaks partway fails the same way, rather than passing a half answer off as whole. */
export const StreamBroken: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const answer = channel();
    mockOf(args.onAsk).mockImplementation(() => answer.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    answer.push('Acme Corp is ');
    answer.fail();
    await expect(await canvas.findByText('Couldn’t get an answer. Try again.')).toBeInTheDocument();
  },
};

/** Markup in an answer is drawn as the characters it is: never an element, never a script (AC-7317). */
export const TextOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    onAsk: fn(() => Promise.resolve('Try <img src=x onerror="alert(1)"> and <script>alert(2)</script> <b>bold</b>')),
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    await waitFor(() => expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false'), { timeout: 4000 });
    const answer = answerOf(canvasElement);
    await expect(answer).toHaveTextContent(
      'Try <img src=x onerror="alert(1)"> and <script>alert(2)</script> <b>bold</b>',
    );
    await expect(answer.querySelector('img, script, b')).toBeNull();
  },
};

/**
 * A long stream (spec 0073, gate 3): 2,000 pieces arriving faster than the screen paints are drawn a frame at a time,
 * and the answer's nodes stay a handful of spans plus one text node per closed block, never one per word or piece.
 */
export const LongStream: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="dialog" height="grid">
      <AIAssist {...args} />
    </Stage>
  ),
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const answer = channel();
    mockOf(args.onAsk).mockImplementation(() => answer.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    const piece = 'the depot pilot moves to Leeds next quarter, ';
    answer.push(...Array.from({ length: 2000 }, () => piece));
    answer.end();
    await waitFor(() => expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false'), { timeout: 8000 });
    const region = answerOf(canvasElement);
    await expect(region.textContent.length).toBe(piece.length * 2000);
    // About 90 kB of text: one text node per closed block (at most a thousand characters each), the open block, and
    // no element per word or per piece.
    await expect(region.querySelectorAll('*').length).toBe(0);
    await expect(region.childNodes.length).toBeLessThanOrEqual(Math.ceil((piece.length * 2000) / 900) + 2);
  },
};

/** No suggestions: the start line alone, and the prompt. */
export const NoSuggestions: Story = {
  parameters: { crm: { screenshot: false } },
  args: { suggestions: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('What do you want to know about Acme Corp?')).toBeInTheDocument();
    await expect(canvas.queryByRole('group', { name: 'Suggested questions' })).toBeNull();
  },
};

/** Ask AI off here (AI is off for the workspace): the prompt, Ask and the suggestions are off, and the reason shows. */
export const Disabled: Story = {
  args: { disabledReason: 'Ask AI is off for this workspace. An admin can turn it on in Settings.' },
  play: async ({ args, canvas, userEvent }) => {
    const prompt = canvas.getByRole('textbox', { name: 'Ask a question' });
    await expect(prompt).toBeDisabled();
    await expect(prompt).toHaveAccessibleDescription(
      'Ask AI is off for this workspace. An admin can turn it on in Settings.',
    );
    await expect(canvas.getByRole('button', { name: 'Ask' })).toBeDisabled();
    const chip = canvas.getByRole('button', { name: 'Summarise this company' });
    await expect(chip).toBeDisabled();
    await userEvent.click(chip);
    await expect(args.onAsk).not.toHaveBeenCalled();
  },
};
