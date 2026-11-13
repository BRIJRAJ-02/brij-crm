import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Reveal } from './Reveal.tsx';
import { RevealDrop } from './RevealDrop.tsx';

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

/** RevealDrop: a row arriving in a list opens from no height and rises, with no blur; rows there on load stay still. */
export const Drop: Story = {
  render: function Drop() {
    const [rows, setRows] = useState<readonly string[]>(['Call Northwind', 'Send the proposal']);
    return (
      <Stage direction="column" width="narrow-fill">
        <Button onPress={() => setRows((was) => [`Follow up ${String(was.length + 1)}`, ...was])}>Add a task</Button>
        <div>
          {rows.map((row, index) => (
            <RevealDrop key={row} animate={index < rows.length - 2}>
              {row}
            </RevealDrop>
          ))}
        </div>
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-still]')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Add a task' }));
    // No blur at any frame: the new row's own animations, read from their keyframes rather than the settled end,
    // open its height and rise it, and not one keyframe sets a filter.
    const arriving = canvas.getByText('Follow up 3').closest('[data-opening]');
    if (arriving === null) throw new Error('the new row is not opening');
    const played = arriving.getAnimations({ subtree: true }) as CSSAnimation[];
    await expect(played.map((animation) => animation.animationName).sort()).toEqual([
      expect.stringMatching(/drop-open/),
      expect.stringMatching(/drop-rise/),
    ]);
    for (const animation of played) {
      const keyframes = animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [];
      await expect(keyframes.length).toBeGreaterThan(0);
      for (const keyframe of keyframes) await expect(keyframe).not.toHaveProperty('filter');
    }
    await settleAnimations();
    await expect(canvas.getByText('Follow up 3')).toBeVisible();
    // Once in, nothing clips it: a focus ring inside is never cut.
    await waitFor(() => expect(canvasElement.querySelector('[data-opening]')).toBeNull());
    for (const element of canvasElement.querySelectorAll('*')) {
      await expect(getComputedStyle(element).filter).toBe('none');
    }
  },
};
