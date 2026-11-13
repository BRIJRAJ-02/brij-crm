import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { useToasts } from '../../provider/context.ts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FloatingBar } from './FloatingBar.tsx';

const meta = {
  title: 'Molecules/FloatingBar',
  component: FloatingBar,
  args: {
    children: (
      <>
        <span>12 selected</span>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
      </>
    ),
  },
  render: (args) => (
    <Stage>
      <FloatingBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof FloatingBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shown: the raised bar with its row of content. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  },
};

/** In a page's footer: centred in it, and only the bar takes the pointer. */
export const Footer: Story = {
  args: { placement: 'footer' },
  render: (args) => (
    <Stage width="fill">
      <FloatingBar {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>('[data-placement="footer"]');
    await expect(frame).not.toBeNull();
    await expect(getComputedStyle(frame ?? canvasElement).pointerEvents).toBe('none');
    await expect(canvas.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  },
};

/** Leaving: it sinks out, inert, then says it has gone. */
export const Leaving: Story = {
  parameters: { crm: { screenshot: false } },
  args: { isLeaving: true, onLeft: fn() },
  play: async ({ args, canvasElement }) => {
    await expect(canvasElement.querySelector('[inert]')).not.toBeNull();
    await waitFor(() => expect(args.onLeft).toHaveBeenCalledTimes(1));
  },
};

/** Opened and closed from the keyboard: no motion either way, and it says it has gone in the next frame. */
export const LeavingAtOnce: Story = {
  parameters: { crm: { screenshot: false } },
  args: { isLeaving: true, isInstant: true, onLeft: fn() },
  play: async ({ args, canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>('[data-instant]');
    await expect(surface).not.toBeNull();
    await expect(getComputedStyle(surface ?? canvasElement).transitionProperty).toBe('none');
    // Well before the exit's fallback wait (400 ms) would have run out.
    await waitFor(() => expect(args.onLeft).toHaveBeenCalledTimes(1), { timeout: 200 });
  },
};

/** A floating bar whose Delete raises a toast, as a table's bulk bar does. */
function BarWithToast() {
  const toasts = useToasts();
  const [count, setCount] = useState(12);
  return (
    <Stage height="page">
      <FloatingBar placement="floating">
        <span>{count} selected</span>
        <Button
          variant="danger"
          icon="trash"
          onPress={() => {
            setCount((was) => was - 1);
            toasts.toast({ tone: 'success', message: 'Deleted' });
          }}
        >
          Delete
        </Button>
      </FloatingBar>
    </Stage>
  );
}

/**
 * A toast raised from a floating bar rises above it, so the bar's buttons stay in reach for the next press (a bulk
 * Delete sat under a toast at the bottom right, 13 November 2026).
 */
export const WithToast: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <BarWithToast />,
  play: async ({ canvasElement }) => {
    const remove = within(canvasElement).getByRole('button', { name: 'Delete' });
    await userEvent.click(remove);
    const toast = await waitFor(() => {
      const found = document.querySelector('[data-toast-region] [role="alertdialog"]');
      if (found === null) throw new Error('no toast');
      return found;
    });
    await settleAnimations();
    await waitFor(async () => {
      const a = toast.getBoundingClientRect();
      const b = remove.getBoundingClientRect();
      await expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false);
    });
    // The next press reaches the bar, not the toast.
    await userEvent.click(remove);
    await expect(within(canvasElement).getByText('10 selected')).toBeInTheDocument();
  },
};
