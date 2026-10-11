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

function Controlled({ onComplete, error }: { readonly onComplete?: (code: string) => void; readonly error?: string }) {
  const [code, setCode] = useState('48');
  return (
    <CodeInput
      label="Code from your authenticator app"
      value={code}
      onChange={setCode}
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
