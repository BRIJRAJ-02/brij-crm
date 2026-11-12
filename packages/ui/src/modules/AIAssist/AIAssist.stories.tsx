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

/** Waits for `count` frames to be drawn. */
async function frames(count: number): Promise<void> {
  for (let drawn = 0; drawn < count; drawn += 1) {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
}

/** Waits `ms` on the page's clock. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The conversation's scroller, and how far its end is below what shows. */
function conversationOf(canvasElement: HTMLElement) {
  const scroller = canvasElement.querySelector<HTMLElement>('[role="region"][aria-label="Conversation"]');
  if (scroller === null) throw new Error('no conversation');
  return { scroller, belowView: () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight };
}

/**
 * Counts what React draws, by name, while `during` runs. React's development build marks the components it renders
 * on the Performance panel's Components track (React 19.2 and later): through `console.timeStamp(name, …)`, or,
 * when the props it was drawn with changed, `performance.measure('\u200b' + name, …)`. A component React skips is
 * never marked; one drawn too quickly for the clock to time may go unmarked, so a count is a floor of the real
 * renders, safe for "at most" checks.
 */
async function countRenders(during: () => Promise<void>): Promise<ReadonlyMap<string, number>> {
  /* eslint-disable no-console -- it listens to React's own marks, passing each one on unchanged, and puts it back */
  const counts = new Map<string, number>();
  const count = (label: unknown) => {
    if (typeof label === 'string') {
      const name = label.replace(/^\u200b/u, '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  };
  const stampOwn = Object.getOwnPropertyDescriptor(console, 'timeStamp');
  const measureOwn = Object.getOwnPropertyDescriptor(performance, 'measure');
  const stamp = console.timeStamp.bind(console);
  const measure = performance.measure.bind(performance);
  console.timeStamp = (label?: string, ...rest: unknown[]) => {
    count(label);
    (stamp as (...args: unknown[]) => void)(label, ...rest);
  };
  performance.measure = (name: string, ...rest: unknown[]) => {
    count(name);
    return (measure as (...args: unknown[]) => PerformanceMeasure)(name, ...rest);
  };
  try {
    await during();
  } finally {
    // Back as they were: the console's own method, and the page's measure from its prototype.
    if (stampOwn === undefined) Reflect.deleteProperty(console, 'timeStamp');
    else Object.defineProperty(console, 'timeStamp', stampOwn);
    if (measureOwn === undefined) Reflect.deleteProperty(performance, 'measure');
    else Object.defineProperty(performance, 'measure', measureOwn);
  }
  /* eslint-enable no-console */
  return counts;
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
    // What arrives after Stop is never drawn, however many frames later.
    answer.push('and Maria Bell signs.');
    await frames(3);
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
 * A long stream (spec 0073, gate 3): 2,000 pieces arriving in a hundred bursts, several between two frames, are drawn
 * at most once a frame; each closed block is drawn once, never again as the answer grows; and the answer's nodes
 * stay one text node per closed block, never one per word or piece.
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
    let drawnFrames = 0;
    let answerDraws = 0;
    // Each time the conversation's DOM changes is one draw of it: a new piece replaces the fading one.
    const draws = new MutationObserver(() => {
      answerDraws += 1;
    });
    const renders = await countRenders(async () => {
      draws.observe(conversationOf(canvasElement).scroller, { childList: true, subtree: true, characterData: true });
      let isCounting = true;
      const tick = () => {
        if (!isCounting) return;
        drawnFrames += 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // A burst every few milliseconds: about four between two frames.
      for (let burst = 0; burst < 100; burst += 1) {
        answer.push(...Array.from({ length: 20 }, () => piece));
        await wait(0);
      }
      answer.end();
      await waitFor(() => expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false'), { timeout: 8000 });
      isCounting = false;
      draws.disconnect();
    });
    const region = answerOf(canvasElement);
    await expect(region.textContent.length).toBe(piece.length * 2000);
    // About 90 kB of text: one text node per closed block (at most a thousand characters each), the open block, and
    // no element per word or per piece.
    await expect(region.querySelectorAll('*').length).toBe(0);
    await expect(region.childNodes.length).toBeLessThanOrEqual(Math.ceil((piece.length * 2000) / 900) + 2);
    // Once a frame: a hundred bursts arrived, and the answer was drawn no more often than frames went by (three to
    // spare: the thinking line giving way to the first words, the last piece, and the settle as it ends).
    await expect(answerDraws).toBeGreaterThan(1);
    await expect(answerDraws).toBeLessThanOrEqual(drawnFrames + 3);
    // React's marks were there to count (React may leave out a mark for a draw too quick to time, never add one).
    await expect([...renders.values()].reduce((sum, drawn) => sum + drawn, 0)).toBeGreaterThan(0);
    // Each closed block drawn at most once, as it closed: never again while the rest of the answer arrived.
    await expect(renders.get('Block') ?? 0).toBeLessThanOrEqual(region.childNodes.length);
  },
};

/**
 * Stop, then a new question at once: the stopped answer's stream, which ignores its signal and sends one more
 * piece, ends without touching the new answer's frame, so the new words show while the new answer pauses.
 */
export const AskedAgainAfterStop: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const first = channel();
    const second = channel();
    mockOf(args.onAsk)
      .mockImplementationOnce(() => first.pieces)
      .mockImplementationOnce(() => second.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'Who should I talk to next?' }));
    first.push('Priya Raman is the champion, ');
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent('Priya Raman is the champion,'));
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }));
    await userEvent.keyboard('Who signs?{Enter}');
    await expect(args.onAsk).toHaveBeenCalledTimes(2);
    // The new answer's words, then the stopped stream's late piece, in one go: the new words wait for a frame, and
    // the old stream ends before that frame comes.
    second.push('Maria Bell signs.');
    first.push('and Maria Bell signs.');
    // The new answer then pauses: its words show anyway, in its own frame.
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent('Maria Bell signs.'), { timeout: 1000 });
    await expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'true');
    await expect(answerOf(canvasElement)).not.toHaveTextContent('Priya');
  },
};

/**
 * A long answer handed over whole fills the panel and keeps following it: each step adds several lines at once,
 * and the newest stay in view to the end. Scrolled up to read, the next answer is left where the person put it.
 */
export const FollowsLongAnswer: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="dialog" height="grid">
      <AIAssist {...args} />
    </Stage>
  ),
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const long = Array.from({ length: 3000 }, (_, at) => `word${String(at)}`).join(' ');
    mockOf(args.onAsk).mockImplementationOnce(() => Promise.resolve(long));
    const { scroller, belowView } = conversationOf(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Summarise this company' }));
    await waitFor(() => expect(answerOf(canvasElement)).toHaveAttribute('aria-busy', 'false'), { timeout: 8000 });
    await frames(2);
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight * 3);
    await expect(belowView()).toBeLessThan(48);
    // A streamed answer, read from the top while it arrives: it stays where the person scrolled.
    const answer = channel();
    mockOf(args.onAsk).mockImplementationOnce(() => answer.pieces);
    await userEvent.click(canvas.getByRole('button', { name: 'New question' }));
    await userEvent.keyboard('What changed this week?{Enter}');
    answer.push(long);
    await waitFor(() => expect(answerOf(canvasElement)).toHaveTextContent('word2999'));
    await frames(2);
    await expect(belowView()).toBeLessThan(48);
    scroller.scrollTop = 0;
    await frames(2);
    answer.push(` ${long}`);
    await frames(3);
    await expect(scroller.scrollTop).toBe(0);
    answer.end();
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
