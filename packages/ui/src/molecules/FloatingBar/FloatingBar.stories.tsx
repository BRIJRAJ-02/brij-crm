import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
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
