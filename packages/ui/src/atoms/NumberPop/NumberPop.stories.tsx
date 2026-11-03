import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NumberPop } from './NumberPop.tsx';

const meta = {
  title: 'Atoms/NumberPop',
  component: NumberPop,
  args: { value: '£45' },
} satisfies Meta<typeof NumberPop>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first value is simply there. */
export const Still: Story = {};

/** Each press adds one: the shared start holds still and the changed digits pop in. */
export const Counting: Story = {
  parameters: { crm: { preview: true } },
  render: function Counting() {
    const [count, setCount] = useState(10);
    return (
      <Stage>
        <NumberPop value={`${String(count)} going`} />
        <Button onPress={() => setCount((n) => n + 1)}>Add one</Button>
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add one' }));
    // 10 → 11: the leading 1 holds still, the 1 after it pops, and the words keep their place.
    await expect(canvas.getByText('11 going')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-same]').length).toBe(1);
  },
};
