import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
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

/** A refused code. */
export const Invalid: Story = {
  render: () => (
    <Stage>
      <Controlled error="That code has expired. Enter the new one from your app." />
    </Stage>
  ),
};
