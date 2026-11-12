import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
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

/** Pointers on a shared canvas: one moving with its name, one idle with its name folded away. */
export const Pointers: Story = {
  render: () => (
    <Stage height="grid">
      <RemoteCursor variant="pointer" name="Maya" hue="purple" x={40} y={30} />
      <RemoteCursor variant="pointer" name="Jonas" hue="lime" x={180} y={90} isIdle />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const pointers = canvasElement.querySelectorAll('[data-hue][aria-hidden="true"]');
    await expect(pointers).toHaveLength(2);
    await expect(pointers[1]).toHaveAttribute('data-idle');
    // Hidden from screen readers: the page's presence group says who is here.
    await expect(canvas.queryByText('Maya')).not.toBeNull();
    await expect(pointers[0]?.getAttribute('style')).toContain('--cursor-x: 40px');
  },
};
