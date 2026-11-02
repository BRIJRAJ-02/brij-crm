import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button } from '../Button/Button.tsx';
import { RollingNumber } from './RollingNumber.tsx';

const meta = {
  title: 'Atoms/RollingNumber',
  component: RollingNumber,
  args: { children: '1,284' },
} satisfies Meta<typeof RollingNumber>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Steady: between rolls it is one piece of text, as any other count is. */
export const Default: Story = {};

/** A count beside the thing that changes it: adding one rolls the last digit only. */
export const Rolls: Story = {
  // Mid roll the characters are drawn one by one, and a paused animation sits at its first frame, so a shot of
  // this story would catch invisible digits. The steady story is the one that is shot.
  parameters: { crm: { preview: true, screenshot: false } },
  render: function Rolls() {
    const [count, setCount] = useState(1284);
    return (
      <Stage>
        <RollingNumber>{String(count)}</RollingNumber>
        <Button
          onPress={() => {
            setCount((was) => was + 1);
          }}
        >
          Add one
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add one' }));
    await waitFor(async () => {
      await expect(canvas.getByText('1285')).toBeInTheDocument();
    });
  },
};

/** A count that gains a digit: every place after the change rolls, the ones before hold still. */
export const GainsADigit: Story = {
  parameters: { crm: { screenshot: false } },
  render: function GainsADigit() {
    const [count, setCount] = useState(99);
    return (
      <Stage>
        <RollingNumber>{String(count)}</RollingNumber>
        <Button
          onPress={() => {
            setCount((was) => was + 1);
          }}
        >
          Add one
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add one' }));
    await waitFor(async () => {
      await expect(canvas.getByText('100')).toBeInTheDocument();
    });
  },
};
