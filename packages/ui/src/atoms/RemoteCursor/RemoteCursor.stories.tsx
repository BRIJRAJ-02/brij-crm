import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RemoteCursor } from './RemoteCursor.tsx';

const meta = {
  title: 'Atoms/RemoteCursor',
  component: RemoteCursor,
  args: { name: 'Maya', hue: 'purple' },
} satisfies Meta<typeof RemoteCursor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two collaborators in one line of a note. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <span>
        Kickoff moved to Thursday
        <RemoteCursor name="Maya" hue="purple" />. Jonas will send the agenda
        <RemoteCursor name="Jonas" hue="lime" /> before then.
      </span>
    </Stage>
  ),
};

/** Where each pointer is drawn: its element, its arrow and its name pill. */
function pointerParts(canvasElement: HTMLElement, name: string) {
  const pill = [...canvasElement.querySelectorAll<HTMLElement>('[data-hue] > span')].find(
    (span) => span.textContent === name,
  );
  const pointer = pill?.parentElement;
  const arrow = pointer?.firstElementChild;
  if (pill === undefined || pointer === null || pointer === undefined || !(arrow instanceof HTMLElement)) {
    throw new Error(`no pointer for ${name}`);
  }
  return { pointer, arrow, pill };
}

/**
 * Pointers on a shared canvas: one moving with its name, one idle with its name folded away. A new point glides
 * from the last (a transition on `translate` alone, so no layout), and idle folds the pill and dims the arrow.
 */
export const Pointers: Story = {
  render: function Pointers() {
    const [x, setX] = useState(40);
    return (
      <Stage height="grid">
        <RemoteCursor variant="pointer" name="Maya" hue="purple" x={x} y={30} />
        <RemoteCursor variant="pointer" name="Jonas" hue="lime" x={180} y={90} isIdle />
        <Button
          onPress={() => {
            setX(160);
          }}
        >
          Move
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const pointers = canvasElement.querySelectorAll('[data-hue][aria-hidden="true"]');
    await expect(pointers).toHaveLength(2);
    await expect(pointers[1]).toHaveAttribute('data-idle');
    // Hidden from screen readers: the page's presence group says who is here.
    await expect(canvas.queryByText('Maya')).not.toBeNull();
    const maya = pointerParts(canvasElement, 'Maya');
    await expect(maya.pointer.getAttribute('style')).toContain('--cursor-x: 40px');
    // Idle: the pill folded away, the arrow dimmed; the moving one shows both in full.
    const jonas = pointerParts(canvasElement, 'Jonas');
    await expect(getComputedStyle(jonas.pill).opacity).toBe('0');
    await expect(Number(getComputedStyle(jonas.arrow).opacity)).toBeLessThan(1);
    await expect(getComputedStyle(maya.pill).opacity).toBe('1');
    await expect(getComputedStyle(maya.arrow).opacity).toBe('1');
    // A new point glides: a transition on translate starts from the old point, and nothing else moves. Under
    // reduced motion (RemoteCursor.browser.test.tsx runs this story so) it jumps, and idle keeps only the fade.
    await userEvent.click(canvas.getByRole('button', { name: 'Move' }));
    await expect(maya.pointer.getAttribute('style')).toContain('--cursor-x: 160px');
    const glides = maya.pointer.getAnimations().filter((animation) => animation instanceof CSSTransition);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await expect(glides).toEqual([]);
      await expect(getComputedStyle(maya.pointer).translate).toBe('160px 30px');
      await expect(getComputedStyle(jonas.pill).scale).toBe('none');
      return;
    }
    await expect(glides.map((glide) => glide.transitionProperty)).toEqual(['translate']);
    const [glide] = glides;
    await expect(Number(glide?.effect?.getComputedTiming().duration)).toBeGreaterThan(0);
    await expect(getComputedStyle(jonas.pill).scale).not.toBe('none');
  },
};
