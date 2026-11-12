import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Reveal } from './Reveal.tsx';

const meta = {
  title: 'Atoms/Reveal',
  component: Reveal,
  args: { children: 'Anish Gupta' },
} satisfies Meta<typeof Reveal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A headline, its line and a row, each one stagger after the one before (texts reveal). */
export const Run: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <div>
        <Reveal order={1}>Anish Gupta</Reveal>
        <Reveal order={2}>Cofounder at Timefix</Reveal>
        <Reveal order={3}>Book a call</Reveal>
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Cofounder at Timefix')).toHaveAttribute('data-order', '2');
  },
};

/** A word that stays in its line. */
export const Inline: Story = {
  args: { display: 'inline', order: 2, children: 'Booked' },
};

/** `drop`: a row arriving in a list opens from no height and rises, with no blur; rows there on load stay still. */
export const Drop: Story = {
  render: function Drop() {
    const [rows, setRows] = useState<readonly string[]>(['Call Northwind', 'Send the proposal']);
    return (
      <Stage direction="column" width="narrow-fill">
        <Button onPress={() => setRows((was) => [`Follow up ${String(was.length + 1)}`, ...was])}>Add a task</Button>
        <div>
          {rows.map((row, index) => (
            <Reveal key={row} variant="drop" animate={index < rows.length - 2}>
              {row}
            </Reveal>
          ))}
        </div>
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-still]')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Add a task' }));
    await settleAnimations();
    await expect(canvas.getByText('Follow up 3')).toBeVisible();
    // Once in, nothing clips it: a focus ring inside is never cut.
    await waitFor(() => expect(canvasElement.querySelector('[data-opening]')).toBeNull());
    for (const element of canvasElement.querySelectorAll('*')) {
      await expect(getComputedStyle(element).filter).toBe('none');
    }
  },
};
