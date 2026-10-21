import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CodeInput } from './CodeInput.tsx';

const meta = {
  title: 'Molecules/CodeInput',
  component: CodeInput,
  args: { label: 'Code from your authenticator app', onComplete: fn() },
} satisfies Meta<typeof CodeInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({
  onComplete,
  error,
  size,
  start = '48',
}: {
  readonly onComplete?: (code: string) => void;
  readonly error?: string;
  readonly size?: 'md' | 'lg';
  readonly start?: string;
}) {
  const [code, setCode] = useState(start);
  return (
    <CodeInput
      label="Code from your authenticator app"
      value={code}
      onChange={setCode}
      {...(size === undefined ? {} : { size })}
      {...(onComplete === undefined ? {} : { onComplete })}
      {...(error === undefined ? {} : { error })}
    />
  );
}

/** Typing fills the boxes; the sixth digit completes it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Controlled {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Code from your authenticator app' }));
    await userEvent.keyboard('{End}1593');
    await expect(args.onComplete).toHaveBeenCalledWith('481593');
  },
};

/**
 * Focused, part filled: the next box (the third) takes the accent border and the faint halo, with a caret bar
 * where the next digit goes. Leaving the field takes the mark away.
 */
export const Focused: Story = {
  render: () => (
    <Stage>
      <Controlled />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Code from your authenticator app' });
    input.focus();
    const boxes = () =>
      [...canvasElement.querySelectorAll('[aria-hidden="true"]')].filter((box) => box.textContent.length <= 1);
    await waitFor(() => expect(canvasElement.querySelector('[data-focused] [data-next]')).not.toBeNull());
    const next = canvasElement.querySelector('[data-focused] [data-next]');
    await expect(boxes().indexOf(next as Element)).toBe(2);
    await expect(next).not.toHaveAttribute('data-filled');
    await userEvent.tab();
    await waitFor(() => expect(canvasElement.querySelector('[data-focused]')).toBeNull());
    input.focus();
  },
};

/** A refused code. */
export const Invalid: Story = {
  render: () => (
    <Stage>
      <Controlled error="That code has expired. Enter the new one from your app." />
    </Stage>
  ),
};

/** Large: the boxes share the row and stand taller, three and three, on a page whose task is the code. */
export const Large: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Controlled size="lg" {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('textbox', { name: 'Code from your authenticator app' })).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-half]')).toHaveLength(1);
  },
};

/** A pasted code with a space in it fills all six boxes and completes it: the separator is dropped, never the digits after it. */
export const PastedWithSpace: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Controlled size="lg" start="" {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Code from your authenticator app' }));
    await userEvent.paste('481 593');
    await expect(args.onComplete).toHaveBeenCalledWith('481593');
  },
};

/** The label for screen readers only, when a sentence above the boxes says what they are for. */
export const LabelHidden: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <CodeInput label="Code" isLabelHidden size="lg" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Code' })).toBeInTheDocument();
    await expect(canvas.queryByText('Code')).toBeNull();
  },
};

/** A key pressed in full boxes changes nothing and sends nothing again: a code is sent once. */
export const KeyInFullBoxes: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Controlled size="lg" start="48159" {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Code from your authenticator app' }));
    await userEvent.keyboard('{End}3');
    await expect(args.onComplete).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('7 ');
    await expect(args.onComplete).toHaveBeenCalledTimes(1);
  },
};

/** A pasted sentence with the code in it gives the code alone, and sends it; a paste replaces what the boxes held. */
export const PastedSentence: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Controlled size="lg" start="12" {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Code from your authenticator app' });
    await userEvent.click(input);
    await userEvent.paste('Enter this code to sign in. It works for 10 minutes. 481593');
    await expect(args.onComplete).toHaveBeenCalledTimes(1);
    await expect(args.onComplete).toHaveBeenCalledWith('481593');
    await expect(input).toHaveValue('481593');
  },
};

/** Stray digits around a code (two codes in one paste) fill the boxes for the person to see, and send nothing. */
export const PastedNoise: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Controlled size="lg" start="" {...(args.onComplete === undefined ? {} : { onComplete: args.onComplete })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Code from your authenticator app' }));
    await userEvent.paste('Codes 111111 and 222222');
    await expect(args.onComplete).not.toHaveBeenCalled();
  },
};
